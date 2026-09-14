# Design Doc: `/test` Slash Command & `run_tests` Assistant Tool

## Status
Proposed

## Goal
1. Add a `/test` slash command to the **AssistantPanel** that pastes the prompt
   *"Run the tests for pipeline PIPELINE_ID"* into the assistant input.
2. Add a backend tool function `run_tests` (in
   `backend/api/src/api/assistant/tools/pipeline_tools.py`) that checks whether a
   given pipeline has test commands defined and, if so, executes that test suite.
3. Run the test suite **asynchronously** so the tool call does not block the
   event-loop thread while tests execute (tests may run for a long time), and
   deliver the result back as the tool response when the run finishes.

## Background / Existing machinery

### Per-pipeline test commands
- The `Pipeline` model (`backend/core/src/core/models/models.py:110`) already
  stores `test_commands: Optional[List[List[str]]]` — a JSON list of argv lists,
  e.g. `[["sh", "-c", "cd backend && uv run pytest"]]`. It is validated by the
  model field validator `validate_test_commands` and by
  `core/queries/pipeline.py::_validate_test_commands`.
- `core/queries/pipeline.py::get_pipeline_by_id` already resolves a pipeline and
  raises `EntityNotFoundError` when it is missing.
- The CoderBot already runs these commands after implementation; see
  `backend/api/src/api/coderbot/session.py`:
  - `get_resolved_verification_commands()` resolves the argv list with priority
    per-pipeline `test_commands` → `CODERBOT_TEST_COMMANDS_JSON` → defaults.
  - `_run_verification_command()` spawns each argv list with
    `asyncio.create_subprocess_exec` (own process group, `start_new_session`),
    a timeout from `config.CODERBOT_VERIFICATION_TIMEOUT` (default `300`), merges
    stdout/stderr, and returns `{cmd, exit_code, output_tail}`.
  - `_terminate_proc_tree()` kills the whole process group on timeout.
- `backend/core/src/core/utils/git_utils.py::get_pipeline_and_repo()` returns the
  `Pipeline` and its resolved workspace `git.Repo` (clones remote repos on first
  use). The workspace absolute path is available via `pipeline.workspace_abs_path`.

### Assistant tool framework
- Tools are registered via `@register_tool(...)` in
  `backend/api/src/api/assistant/decorators.py`, which stores them in the central
  `api.bot.tool_registry.registry`.
- `tool_type="read_only"` tools are executed immediately; `tool_type="write_access"`
  tools require explicit user confirmation (`tool_request`) before execution (see
  `backend/api/src/api/assistant/session.py::_run_llm_loop` and `confirm_tool`).
- Currently tools call `pipeline_tools.py` functions like `list_pipelines` and
  `get_pipeline_details`, which use `core.queries.pipeline`.

### Frontend slash-command UI
- `frontend/src/ui/components/AssistantPanel.ts`:
  - `PIPELINE_TEMPLATE_COMMANDS` maps a slash command string to a prompt template;
    the token `PIPELINE_ID` is substituted with the current pipeline id from the
    URL.
  - `SLASH_COMMAND_INDEX` lists every command (and its description) shown by
    typing `/` or `//`.
  - `handleSlashCommand()` applies template commands by pasting the template into
    the input.

## Proposed Implementation

### 1. Frontend — add `/test` slash command
In `frontend/src/ui/components/AssistantPanel.ts`:

- Add to `PIPELINE_TEMPLATE_COMMANDS`:
  ```ts
  '/test': 'Run the tests for pipeline PIPELINE_ID',
  ```
- Add to `SLASH_COMMAND_INDEX` (alphabetically after `/summary`):
  ```ts
  { command: '/test', description: 'Run the test suite for the pipeline' },
  ```

Because it is a template command (not an action command like `/clear`), the
existing `handleSlashCommand()` path automatically pastes the prompt with the
pipeline id substituted and places the cursor at the end; no other frontend logic
changes are required.

### 2. Backend — `run_tests` tool in `pipeline_tools.py`
Add a new registered tool:

```python
@register_tool(tool_type=WRITE_ACCESS, is_available=...)  # see §3
async def run_tests(pipeline_id: str) -> Dict[str, Any]:
```

Behavior:
- Load the pipeline with `core.queries.pipeline.get_pipeline_by_id(pipeline_id)`
  (raises `EntityNotFoundError` if unknown).
- Check whether test commands are configured. For a pipeline, tests are considered
  defined when `pipeline.test_commands` is a non-empty list of argv lists. If no
  commands are defined, return immediately:
  ```python
  {"status": "no_tests", "message": "Pipeline ... has no test commands defined."}
  ```
- Resolve the workspace working directory by reusing
  `core.utils.git_utils.get_pipeline_and_repo` (or `git_utils.get_repo_for_pipeline`),
  giving us the `Pipeline`/`git.Repo` and a resolved `workspace_path`. Tests are run
  against the pipeline workspace (not a task sandbox).
- Schedule the actual execution as a background `asyncio` task and return
  immediately (see §3) so the tool call responds without blocking.

### 3. Async execution without blocking
The core requirement: the tool call response must be returned promptly, and the
test result must be delivered as the tool response when the run completes.

Re-use the proven CoderBot subprocess pattern (`_run_verification_command`), but
extract it to a shared helper so it can be used by the assistant tool without
duplication:

- New module (or additions to `git_tools.py`/a small new
  `tools/test_runner.py`): `async run_pipeline_tests(pipeline, workspace_path)`
  that loops over the resolved argv lists, spawns each with
  `asyncio.create_subprocess_exec(..., cwd=workspace_path, stdout=PIPE,
  stderr=STDOUT, start_new_session=True)`, applies
  `config.CODERBOT_VERIFICATION_TIMEOUT`, collects `{cmd, exit_code, output_tail}`,
  and terminates runaway process groups. It returns an aggregate
  `{"commands": [...], "passed": bool}`.

Delivery mechanism (proposed):
- The `run_tests` tool builds a small `run_id`, schedules the runner:
  ```python
  asyncio.create_task(TestRunner.dispatch(run_id, commands, workspace_path))
  ```
- `TestRunner` keeps an `on_complete` callback registry. The `AssistantSession`
  registers a completion handler that, on completion, appends a `role="tool"`
  `ChatMessage` whose `content` is the serialized test result, then resumes the LLM
  loop (`_run_llm_loop()`). This makes the result "sent back as the tool response"
  as soon as tests finish, without blocking `run_tests` itself.
- Until the command completes, `run_tests` returns immediately:
  ```python
  {"status": "started", "run_id": run_id,
   "message": "Test run started; result will be reported when complete."}
  ```
  which is delivered to the UI as the tool's immediate result.

This keeps the tool non-blocking: `asyncio.create_task` yields control, the tool
return value is small/fast, and the event loop stays responsive while the subprocess
runs in its own async task.

### 4. Tool type / confirmation
`run_tests` executes arbitrary project commands against the pipeline workspace, so
it must **not** be `read_only`. Register it as `WRITE_ACCESS` so the existing
`tool_request` → `Confirm & Execute` gate protects the user before any commands run.
This aligns with existing write tools such as `git_pull`.

## Files touched
- `frontend/src/ui/components/AssistantPanel.ts` — add `/test` template + index entry.
- `backend/api/src/api/assistant/tools/pipeline_tools.py` — add `run_tests`.
- `backend/api/src/api/assistant/` (new helper module, e.g. `tools/test_runner.py`
  and/or session wiring) — async runner + completion delivery.
- `backend/api/src/api/assistant/session.py` — register completion callback that
  writes the tool result and resumes the LLM loop.

## Testing
- Backend: extend `backend/tests/bots/test_assistant_tools.py` with a `run_tests`
  test that (a) returns a `no_tests` message when a pipeline has no `test_commands`,
  and (b) executes a configured command against a fixture workspace and reports the
  result asynchronously.
- Frontend: rely on existing slash-command tests/behaviour; verify `/test` is listed
  in the index and substitutes `PIPELINE_ID`.
- Run the full monorepo suite (`sh -c cd backend && uv run pytest` and
  `sh -c cd frontend && CI=true npm run test`) before finishing.
