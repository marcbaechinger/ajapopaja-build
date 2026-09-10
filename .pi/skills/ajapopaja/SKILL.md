---
name: ajapopaja
description: Search, manage, and complete tasks using the Ajapopaja Build MCP server. Use this skill to find next tasks, search tasks by keywords/status, view task details, update design documents, and mark tasks as complete.
---

# Ajapopaja Task Management

This skill provides a CLI interface to interact with the Ajapopaja Build MCP server for task management. It is **self-contained**: the `mcp_client.py` helper script lives in this same directory, so the whole `ajapopaja/` folder can be copied to any skill location (a user's skill directory, a shared location, etc.) and still work.

## Setup

The helper script is bundled in this directory. Run it with `python3` (it requires the `httpx` package):

```bash
python3 ./mcp_client.py --url http://localhost:8000 <command> ...
```

If `httpx` is not installed, install it once:

```bash
pip install httpx
```

The default server URL is `http://localhost:8000`. Override it with `--url` if the server runs elsewhere.

## Main Workflow

The core loop for working on tasks is:

1. **Get the next task** – pick up the next available `scheduled` task for a pipeline.
2. **Implement the task** – read the task details and implement it in the workspace.
3. **Propose a commit message** – propose a commit message for the commit that implements the task.
4. **Mark the task as completed** – record the commit and completion summary.

### 1. Get the Next Task

Fetch the next available `scheduled` task for a pipeline and move it to `inprogress`:

```bash
python3 ./mcp_client.py --url http://localhost:8000 get-task <pipeline_id>
```

### 2. Implement the Task

Retrieve the full task details (specification, design document, and history) to understand what to build:

```bash
python3 ./mcp_client.py --url http://localhost:8000 get-task-details <task_id>
```

If the task requires a design document (`want_design_doc` is True), provide one before implementing. This moves the task to `proposed` status:

```bash
python3 ./mcp_client.py --url http://localhost:8000 update-design-doc <task_id> --design-doc "# Design Doc Content" --version <v>
```

Then implement the task in the workspace.

### 3. Propose a Commit Message

After implementing, propose a commit message for the commit that captures the change. The message should summarize what was implemented and reference the task.

### 4. Mark the Task as Completed

Commit the change, then mark the task as `implemented` with the commit hash and a completion summary:

```bash
python3 ./mcp_client.py --url http://localhost:8000 complete-task <task_id> --commit <hash> --info "summary" --version <v>
```

## Auxiliary Actions

The following actions support the main workflow but are not part of the core loop.

### List Available Tools
Check what the MCP server currently supports.
```bash
python3 ./mcp_client.py --url http://localhost:8000 list
```

### Search for Tasks
Search tasks by keywords, status, or pipeline.
```bash
# Search by keyword
python3 ./mcp_client.py --url http://localhost:8000 search-tasks --keywords "search term"

# Filter by status
python3 ./mcp_client.py --url http://localhost:8000 search-tasks --statuses scheduled inprogress

# Paginated search
python3 ./mcp_client.py --url http://localhost:8000 search-tasks --limit 5 --page 0
```

### Get Task Status
Check the current status and verification results for a task.
```bash
python3 ./mcp_client.py --url http://localhost:8000 get-task-status <task_id>
```

### Update Task Specification
Update the specification for a task.
```bash
python3 ./mcp_client.py --url http://localhost:8000 update-task-spec <task_id> --spec "new spec" --version <v>
```

## Troubleshooting
- If you get a `307 Redirect` or `405 Method Not Allowed`, ensure the URL ends with `/mcp/` or use the `--url http://localhost:8000` default which handles it.
- Ensure the FastAPI server is running on the specified port (default 8000).
