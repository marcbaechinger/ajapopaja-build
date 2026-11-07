# Design Proposal: Autonomous Self-Documentation Agent (`DocBot`)

## 1. Goal

The `DocBot` is an autonomous AI agent that maintains the project's architectural
and design documentation. It analyzes completed tasks and their corresponding git
commits to determine whether significant design changes or new principles should
be reflected in the reference documentation.

DocBot does **not** modify the pipeline workspace directly and does **not** use a
bot-specific staging/commit flow. When documentation changes are required, it
creates a normal `PullRequest` of kind `documentation`, which is reviewed,
accepted, or rejected through the standard pull-request section.

## 2. Architecture

### 2.1 Component Overview

The feature is implemented in the `backend/api/src/api/docbot/` module.

- **`DocBotManager`**: Queues a documentation session for a manually selected
  task. DocBot is not triggered automatically by `complete_task`; a user or API
  caller must invoke the trigger endpoint.
- **`DocBotSession`**: Manages the autonomous interaction loop with the configured
  LLM. Unlike the human-facing `AssistantSession`, it does not require approval
  for individual tool calls. It works in a sandbox clone and finalizes by either
  producing a documentation `PullRequest` or reporting that no update is needed.
- **`DocBotRegistry`**: A specialized registry containing the tools relevant to
  documentation.
- **Tools**:
  - Standard read-only tools: `read_source_file`, `list_project_structure`,
    `git_show_commit`, and `grep` from
    `backend/api/src/api/assistant/tools/`.
  - Documentation-specific tools in `backend/api/src/api/docbot/tools.py`:
    - `list_ref_docs()`: Lists reference documentation files under the
      pipeline's configured documentation root (default `design/`), including
      subdirectories.
    - `read_ref_doc(filename)`: Reads a documentation file. Paths are relative
      to the documentation root; a leading `design/` prefix is stripped.
    - `update_ref_doc(filename, content, reason)`: Creates or replaces a
      documentation file.
    - `update_markdown_section(filename, markdown_heading,
      markdown_section, reason)`: Replaces one section of an existing document.
    - `document_update_completed(reason)`: Terminal tool called after one or more
      successful update tool calls. It finalizes the session and supplies the
      summary used for the pull request.
    - `no_doc_update_needed(reason)`: Terminal tool used when the change is
      already documented or has no documentation impact.

The terminal tools are therefore `document_update_completed` and
`no_doc_update_needed`. The update tools themselves do not end the session.

### 2.2 Trigger Preconditions

The canonical trigger is manual:

- **Endpoint**: `POST /pipelines/{pipeline_id}/docbot/trigger/{task_id}`.
- **UI**: The DocBot button is offered for tasks in either `IMPLEMENTED` or
  `SUBMITTED` state.

Before a session is queued, the backend verifies that:

1. The pipeline exists and has a workspace path.
2. The task exists and belongs to that pipeline.
3. The task status is `IMPLEMENTED` or `SUBMITTED`.
4. The task has an implementation `commit_hash` (DocBot requires a completed
   implementation to analyze).
5. The commit is **reachable** from the pipeline workspace. If the commit is not
   present, the request fails with `409 Conflict` and asks the caller to sync
   the repository and retry. A missing task commit fails with `400 Bad Request`.

Only after these checks succeed is the task enqueued via
`DocBotManager.process_completed_task`.

### 2.3 Data Flow

1. **Manual trigger**: The trigger endpoint validates the preconditions above.
2. **Context injection**: `DocBotSession.get_initial_prompt()` gathers task
   details (`spec`, `design_doc`, `completion_info`) and the implementation diff
   from `git show <commit_hash>`. It also verifies that the commit can still be
   resolved from the pipeline workspace.
3. **Sandbox start**: DocBot runs in a sandbox clone of the pipeline workspace.
   Each run gets a unique branch:
   `docbot/<task_id>/<8-character-random-suffix>`.
4. **Autonomous loop**:
   - The session sends the context and system instruction to the configured LLM.
   - The LLM researches using the read-only and documentation tools.
   - If the model responds with text instead of a tool call, the session follows
     up with a prompt to continue and finalize through a terminal tool.
5. **Finalization**:
   - `no_doc_update_needed` records `status: "no_update_needed"` and no pull
     request is created.
   - `document_update_completed` records `status: "update_needed"` after one or
     more documentation files or sections were updated.
6. **Pull-request creation**: When updates exist, DocBot commits the sandbox
   changes, captures the patch, and inserts a `PullRequest` with:
   - `kind = PullRequestKind.DOCUMENTATION` (`documentation`);
   - a unique `branch_name` (the sandbox branch above);
   - a non-empty `subject` derived from the first non-empty summary line,
     prefixed with `DocBot:` when needed, with a stable fallback and a 200
     character limit;
   - `author = "docbot"`, the documentation `summary`, the `patch`, and
     `status = OPEN`.

   An empty patch is not turned into a pull request. A failure while creating
   the PR is reported as `status: "pr_creation_failed"` with the reason. The
   sandbox is cleaned up after the PR is created or after the failure is
   recorded.
7. **Notification**: A successful creation broadcasts `PULL_REQUEST_CREATED`;
   `DOCBOT_COMPLETED` is broadcast in all finalization cases.

### 2.4 PullRequest Fields

DocBot uses two fields that distinguish documentation pull requests from
implementation pull requests:

- **`PullRequest.kind`**: `IMPLEMENTATION` (the default, also assumed for legacy
  documents without the field) or `DOCUMENTATION`. Kind-aware acceptance,
  chaining, cleanup, and remote reconciliation use this field.
- **`PullRequest.commit_hash`**: The commit produced when a pull request is
  accepted or submitted locally. It is empty while the PR is `OPEN`, is stored on
  the PR rather than replacing implementation metadata, and may remain empty for
  a documentation PR reconciled from a remote merge.

### 2.5 Lifecycle Events and UI Feedback

DocBot emits lifecycle events consumed by the front-end:

- **`DOCBOT_STARTED`**: Broadcast when the session begins. The payload contains
  `pipeline_id` and `task_id`. The header shows a compact "DocBot is analyzing..."
  banner.
- **`DOCBOT_COMPLETED`**: Broadcast after the session finishes. The payload
  contains `pipeline_id`, `task_id`, and a `result` object.

The UI reacts as follows:

1. `result.status === "no_update_needed"`: The banner shows a neutral completion
   state with the reason and can be dismissed.
2. `result.status === "update_needed"`: The banner points the user to the
   standard pull-request section, where the documentation PR is reviewed like
   any other PR. There is no DocBot-specific diff dialog or separate commit step.
3. `result.status === "pr_creation_failed"`: The banner shows an error state with
   the failure reason and can be dismissed.
4. `PULL_REQUEST_CREATED` refreshes the pull-request section so the new
   documentation PR appears immediately.

## 3. Implementation Details

### 3.1 `DocBotSession`

`DocBotSession` subclasses `BaseBotSession` and supplies the documentation
system instruction, tool registry, terminal-tool detection, default feedback,
lifecycle events, and the PR-creation hook. The base class handles the chat loop,
tool execution, history, and sandbox lifecycle.

```python
class DocBotSession(BaseBotSession):
    def get_system_instruction(self) -> str: ...
    def get_tools(self) -> List[ToolDefinition]: ...
    def is_terminal_tool(self, tool_name: str) -> bool:
        return tool_name in ["document_update_completed", "no_doc_update_needed"]

    def get_sandbox_branch_name(self) -> str:
        return f"{self.bot_type}/{self.task_id}/{uuid.uuid4().hex[:8]}"
```

The sandbox branch is deliberately unique per run. DocBot may run more than once
for the same task; a deterministic branch could otherwise be deleted when one PR
completes while another run still needs it.

### 3.2 System Instruction

> "You are a Documentation Architect. Your task is to analyze a completed
> software change and decide if the project's reference documentation
> (architecture, design principles, API contracts) needs to be updated. You have
> access to the source code, git history, and the current reference documentation.
> Follow these steps:
>
> 1. Review the task spec, implementation summary, and the git diff.
> 2. Explore the codebase and existing documentation to understand the impact.
> 3. If the change introduces new design patterns, modifies core architecture, or
>    changes public-facing API contracts, update the relevant documentation with
>    `update_ref_doc` or `update_markdown_section`.
> 4. When all updates are complete, call `document_update_completed`.
> 5. If the change is purely an implementation detail or is already covered by
>    existing documentation, call `no_doc_update_needed`. Do not ask for
>    permission. Act autonomously."

### 3.3 Documentation Storage

Documentation is stored under the pipeline's configurable documentation root,
which defaults to `design/`. DocBot changes are made in its sandbox and reach the
repository only through the resulting documentation pull request.

## 4. Manual Trigger Endpoint

- **Endpoint**: `POST /pipelines/{pipeline_id}/docbot/trigger/{task_id}`
- **Parameters**:
  - `pipeline_id`: Identifier of the pipeline to which the task belongs.
  - `task_id`: Identifier of the completed task.
- **Preconditions**: The task belongs to the pipeline, is in `IMPLEMENTED` or
  `SUBMITTED` state, has a `commit_hash`, and that commit is reachable from the
  pipeline workspace.
- **Behavior**:
  1. Validates the pipeline, task, status, commit hash, and workspace.
  2. Verifies the commit with `repo.commit(task.commit_hash)`.
  3. Enqueues the task for DocBot processing via
     `DocBotManager.process_completed_task`.
  4. Returns `{"status": "success", "message": "DocBot triggered successfully."}`.
- **Errors**: A missing commit returns `400`; an unreachable commit returns
  `409`; missing pipeline/task/workspace returns `404`.
- **Security**: Requires authentication and appropriate permissions.

### 4.1 Front-End Integration

The SPA adds a small DocBot button next to the task ID in `TaskItem` for tasks in
`IMPLEMENTED` or `SUBMITTED` state. Clicking it calls
`DocBotClient.triggerDocBot(pipelineId, taskId)`, shows a loading indicator, and
reports success or failure with a toast. Bot state is driven by the lifecycle
events in section 2.5.

## 5. Review, Kind-Aware Acceptance, and Reconciliation

Acceptance and reconciliation are kind-aware for documentation PRs: they are
handled separately from the ordered implementation chain while still using the
same review and delivery routes.

### 5.1 Standard PR Section

Documentation PRs appear in the normal `PullRequestSection` alongside
implementation PRs. The user reviews the summary and patch, and uses the standard
Review, Iterate, Accept, and Reject actions. There are no DocBot-specific review,
commit, revert, or cancel endpoints or dialogs.

### 5.2 Kind-Aware Acceptance

Documentation PRs are outside the ordered implementation chain:

- They are never considered an older pending implementation PR and do not block
  acceptance ordering.
- They are never treated as a predecessor start point, and their acceptance does
  not follow a rejected implementation predecessor.
- In `gitea_pr` mode a documentation PR always branches from the clean default
  branch, never from an implementation PR's feature branch.

Acceptance applies the documentation patch and creates a commit in the pipeline
workspace exactly like an implementation PR. The resulting commit is stored on
`PullRequest.commit_hash`. The PR status follows the normal apply mode:
`OPEN -> ACCEPTED` for `merge`/`push`, or `OPEN -> SUBMITTED` with a remote PR URL
for `gitea_pr`. The task moves to the normal target status for that mode
(`IMPLEMENTED` or `SUBMITTED`).

### 5.3 Implementation Metadata Is Never Overwritten

A documentation PR belongs to the implementation task it documents, but it must
not replace that task's implementation metadata. When accepting or submitting a
documentation PR, DocBot leaves the task's existing `commit_hash`,
`completion_info`, and `review_md` unchanged. The documentation commit and remote
URL live on the `PullRequest`. Implementation PRs continue to copy their accepted
commit and summary onto the task.

### 5.4 Merge and Reject Semantics

| Action | Documentation PR | Task |
|--------|------------------|------|
| Local accept (`merge`/`push`) | `OPEN -> ACCEPTED`; `commit_hash` records the local acceptance commit | Moves to `IMPLEMENTED`; implementation metadata unchanged |
| Local accept (`gitea_pr`) | `OPEN -> SUBMITTED`; records the local acceptance commit and `remote_pr_url` | Moves to `SUBMITTED`; implementation metadata unchanged |
| Local reject | `OPEN -> REJECTED` | Unchanged: no return to backlog and no metadata reset |
| Remote PR merged | `SUBMITTED -> ACCEPTED` | Unchanged; the implementation commit/summary/review metadata stay intact |
| Remote PR closed without merge | `SUBMITTED -> REJECTED` | Unchanged; the completed implementation task stays completed |

Reconciliation is kind-aware: it matches the remote event to the correct local PR
by PR identity (remote URL/PR number and base branch) as well as branch name, so
a documentation PR cannot be confused with an implementation PR. Completing a
documentation PR runs the same cleanup as any other PR: its patch and
branch/worktree artefacts are released. Rejecting or remotely closing it never
discards the implementation task's work.

## 6. Testing Strategy

- **Mock LLM**: Simulate tool calls, text responses, terminal calls, and failures.
- **Tool validation**: Verify `update_ref_doc`, `update_markdown_section`,
  `read_ref_doc`, `document_update_completed`, and `no_doc_update_needed`.
- **Workflow tests**: Verify the final state is either a documentation PR or a
  no-update result.
- **PR creation tests**: Verify `kind=documentation`, a non-empty subject, the
  unique branch, author, patch, and `OPEN` status; verify that an empty patch is
  skipped and that PR-creation failures are reported.
- **Trigger tests**: Verify `IMPLEMENTED`/`SUBMITTED` acceptance and rejection of
  incomplete tasks, missing commits, and commits not reachable from the
  workspace.
- **Acceptance/reconciliation tests**: Verify documentation PRs ignore the
  implementation chain, preserve task implementation metadata on accept, reject,
  and remote merge/close, and clean up their artifacts.
