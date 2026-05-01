# Release Notes

## 0.2.0 – Major improvements and new features

* **DocBot Self‑Documentation Agent** – a fully autonomous agent that can generate design documents, code comments, and documentation on the fly.  
* **MCP security & JWT authentication** – the MCP backend now optionally enforces JWT auth with configurable paths and retries.  
* **Enhanced MCP tooling** – added `search_tasks`, `get_task_details`, and improved tool‑registry filtering.  
* **Frontend polish** – improved contrast in dark mode, horizontal scroll for wide tables, and better task ID visibility.  
* **Backend resilience** – graceful degradation when Ollama is unavailable, more robust logging, and retry logic for external services.  
* **Design doc updates** – several design documents moved/updated to reflect the new architecture.  

Below is the list of all commits that make up this release.

### Commits

Last commit: 640cc7b

#### bugfix

* 633842d Restore DocBot tool registration and correct database name
* 65e33c9 Fix empty diff for untracked files in DocBot UI
* 6a94f50 Fix MCP path doubling and add auth failure logging

#### assistant

* 5b27f91 Make read-only tool use visible to the user

#### backend

* 14fd6df Add input validation to MCP tools and include pipeline_id in task details
* 285a017 Make Neovim socket path configurable via NVIM_SOCKET environment variable
* 33040e3 Bring back mongoDb health check
* 3497491 Add search_tasks tool to MCP server
* 355488c Improve DocBot logging for tool calls and decisions
* 3762c2b Make MCP authentication opt-in via configuration
* 4087e87 Secure MCP calls with JWT authentication middleware
* 4311e38 Improve DocBot autonomy, tool robustness and fix docstring parsing
* 44c1236 Make DocBot tools more flexible and add logging
* 4624a1f Trigger DocBot in MCP complete_task tool
* 4e25caa Bind pipeline_id to DocBotSession for more robust tool calls
* 8115d76 Add autonomous self-documentation agent (DocBot)
* 8738fc9 Extract MCP tool functions into separate module
* 9e0ec13 Add design doc for mxp security
* a2e7f12 Add get_task_details tool to MCP server
* b752116 Improve Ollama availability check with retries and caching
* bb20c7f Sanitize tool registry by filtering tools based on availability (e.g. nvim)
* dfaff22 Secure MCP with JWT middleware and fix path doubling
* e11523e Implement graceful degradation when Ollama is unavailable

#### frontend

* 699ae85 Fix wide tables in AssistantPanel with horizontal scroll wrapper
* efd7eda Display Task ID and add copy button in TaskItem

#### cleanup

* 604207c Fix formatting and long lines in docbot module
* deb3856 Implement lazy database initialization

#### design

* 1b48135 Add Tool Registry Availability to architecture document
* 27e902a Move design docs
* 3203e02 Add design doc of autonomous DocBot
* b4a4bf1 Move design docs

#### feature

* 255fb7a Implement DocBot inline diff preview and review

#### test

* 249b44e Verify that search_tasks excludes deleted tasks
* 414c765 Create unit tests for MCP tool functions

#### scripts

* 1658659 Add McpHttpClikent for triggering MCP calls from the CLI

#### doc

* 640cc7b Update project structure doc with ruff formatting commands
* a8a7b74 Update dd_autonomous_docbot.md

## 0.1.0 – Initial release

Lst commit: 83a0dbe

This is the initial version published on GitHub.
