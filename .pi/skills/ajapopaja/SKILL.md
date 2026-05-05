---
name: ajapopaja
description: Search, manage, and complete tasks using the Ajapopaja Build MCP server. Use this skill to find next tasks, search tasks by keywords/status, view task details, update design documents, and mark tasks as complete.
---

# Ajapopaja Task Management

This skill provides a CLI interface to interact with the Ajapopaja Build MCP server for task management.

## Available Actions

The skill uses the `mcp_client.py` script located in `backend/mcp/src/scripts/mcp_client.py`.

### 1. List Available Tools
Check what the MCP server currently supports.
```bash
python3 backend/mcp/src/scripts/mcp_client.py --url http://localhost:8000 list
```

### 2. Search for Tasks
Search tasks by keywords, status, or pipeline.
```bash
# Search by keyword
python3 backend/mcp/src/scripts/mcp_client.py --url http://localhost:8000 search-tasks --keywords "search term"

# Filter by status
python3 backend/mcp/src/scripts/mcp_client.py --url http://localhost:8000 search-tasks --statuses scheduled inprogress

# Paginated search
python3 backend/mcp/src/scripts/mcp_client.py --url http://localhost:8000 search-tasks --limit 5 --page 0
```

### 3. Get Task Status
Check the current status and verification results for a task.
```bash
python3 backend/mcp/src/scripts/mcp_client.py --url http://localhost:8000 get-task-status <task_id>
```

### 4. Get Task Details
Retrieve full details, including specification, design document, and history.
```bash
python3 backend/mcp/src/scripts/mcp_client.py --url http://localhost:8000 get-task-details <task_id>
```

### 5. Fetch Next Task
Pick up the next available `scheduled` task for a pipeline and move it to `inprogress`.
```bash
python3 backend/mcp/src/scripts/mcp_client.py --url http://localhost:8000 get-task <pipeline_id>
```

### 6. Update Task Design Document
Provide a design document for a task that requires one (`want_design_doc` is True). This moves the task to `proposed` status.
```bash
python3 backend/mcp/src/scripts/mcp_client.py --url http://localhost:8000 update-design-doc <task_id> --design-doc "# Design Doc Content" --version <v>
```

### 7. Complete a Task
Mark a task as `implemented`.
```bash
python3 backend/mcp/src/scripts/mcp_client.py --url http://localhost:8000 complete-task <task_id> --commit <hash> --info "summary" --version <v>
```

## Troubleshooting
- If you get a `307 Redirect` or `405 Method Not Allowed`, ensure the URL ends with `/mcp/` or use the `--url http://localhost:8000` default which handles it.
- Ensure the FastAPI server is running on the specified port (default 8000).
