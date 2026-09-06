# Release Notes

## 0.3.0 – Autonomous coding agents and pull‑request workflow

This release turns Ajapopaja Build from a task pipeline into a platform that can
research a design, write and review the code, and submit the finished change for
human approval – all automatically.

### 🧑‍💻 CoderBot – end‑to‑end autonomous coding

* **CoderBot** implements tasks described in design documents from start to
  finish. It runs in an isolated sandbox, clones the workspace repository onto a
  feature branch, and drives the **Pi** coding agent (in headless RPC mode) to
  analyse the design, write the code, and run verification. Progress is streamed
  to the UI in real time over WebSockets.

### 🔀 Pull‑request workflow

* **A pull request for every change** – CoderBot packages each implementation as
a PR (feature branch, patch, summary) stored in MongoDB.
* **Human review in the SPA** – review the change in the dashboard and
  **accept** (optionally committing it to the branch on accept) or **reject** it.
* **Failure‑handling strategies** for PR acceptance keep rejected work recoverable.

### 🤖 More autonomous agents

* **ArchitectureBot** – a single click in the UI drafts a design document for a
task, following a standardized Markdown format.
* **ReviewBot** – an automated technical review of implemented tasks that combines
the spec, design document, and git diff into a structured Markdown review you
can view or delete.
* **BotManager** – a central orchestrator now queues and serializes every bot, so
only one LLM session runs at a time and a failing session never blocks the next.
* **DocBot** improvements – sandboxed execution, a manual trigger in the UI,
lifecycle events, a persistent preview cache, and a more flexible Markdown
workflow.

### 🔌 MCP & Pi integration

* **A complete `pi` skill** ships with an `mcp_client.py` CLI (search, list, get
task details, fetch the next task, update design docs, complete tasks).
* **Commit‑hash validation** on task completion keeps the pipeline state honest.

### 🔒 Security & reliability

* **Authentication enforced across the API** – task, git‑status, pull‑request,
CoderBot, and DocBot endpoints are now protected.
* **Centralized git utilities**, sandbox **path validation**, and **Markdown
sanitization** for design documents.
* **JSONL conversation logging** and structured **execution reports** for audit
and replay.
* **Editor / Neovim integration** – an editor‑command endpoint can open diffs (via
DiffviewOpen) in a running Neovim instance.

### 🎨 Frontend overhaul

* **Centralized Data Manager** with `localStorage` persistence across reloads.
* Revamped pipeline header with a clickable **git‑status badge** and layout
switching (multi‑column / two‑column).
* **Quickfix button** for implemented tasks, a **history** view, an improved
**SearchDialog**, dark/light mode polish, and a **streaming logs** viewer.

### 🧪 Testing

* Broad new coverage on both sides – backend routing, bot sessions, BotManager,
MCP helpers, and frontend views, components, and dialogs.

Below is the list of all commits that make up this release.

### Commits

Last commit: b4ae381

#### feature
* 27aed5c [feature] Implement CoderBot autonomous agent and PR system

#### backend
* 176bf57 [backend] Move DOC_ROOT to Pipeline model and allow overrides in frontend
* 1023f47 [backend] Minor test improvements
* b7a50de [backend] Verify PR patch is not an empty string
* 1701daf [backend] Add pre-commit to dev dependencies
* afdd946 [backend] Fix test for git status endpoint after requiring authentication
* e8e6b37 [backen] Requre authentication for git status endpoint
* 9b6a5a5 [backend] Secure pull_request router with authentication
* 59fbc39 [backend] Secure CoderBot router with authentication
* 573fb64 [backend] Refactor DocBot to work in a sandbox and share infrastructure
* 399d775 [backend] Modified the exception handler in `run()` to log full stack traces
* 8f9a16d [backend] Run ruff format and fix before PR commit
* 2c14c3d [backend] Set Task.commit_hash when accepting Pull Request
* 93eef87 [backend] Fix trailing new line difference of git patch
* 7285293 [backend] Add extensive CoderBot logging and EOF handshake
* 54dff65 [backend] Fix Pi subprocess hang by merging stderr into stdout
* 392c979 [backend] Ensure full consumption of Pi RPC stream
* 39f106e [backend] Use git diff for clean, reliable patch generation
* 4a7892e [backend] Use raw string slicing for byte-perfect patch generation
* 196448c [backend] Fix patch corruption by preserving line endings
* d6c0f3d [backend] Fix PR patch generation and add logging
* 40e136e [backend] Increase Pi RPC stream buffer limit
* 82cd8f5 [backend] Implement structured logging for Pi CoderBot sessions
* 9f3de58 [backend] Fix test warnings and initialization errors
* 5f5d2d4 [backend] Rewrite CoderBot to use Pi via RPC
* 819822e [backend] Deduplicate CoderBot tools
* b5d97b8 [backend] Support multiple file extension formats in grep tool
* 387546e [backend] Consolidate file reading tools in BaseBotSession
* 38305b4 [backend] Implement unique log filenames for bot sessions
* 12e17df [backend] Switch conversation logging to efficient JSONL format
* 77c944f [backend] Fix null success values and improve tool argument logging in BaseBotSession
* 895ac20 [backend] Refine execution report to show iterations usage
* efb4e8e [backend] Implement shared execution report for ArchBot and ReviewBot
* 11c59fa [backend] Make BaseBotSession configurable by subclasses
* 7ef452d [backend] Implement conversation logging in BaseBotSession
* dcc29a0 [backend] Consolidate bot tools into shared utilities
* 2b001c3 [backend] Implement robust sandbox cleanup on failure
* 72217a7 [backend] Add dynamic default-branch detection to SandboxGitHelper
* bf160b5 [backend] Strengthen Sandbox Path Validation
* 8968c63 [backend] Fix duplicate heading logic in update_markdown_section
* 51cc7e9 [backend] Add logging and robust git handling to editor commands
* e507ccb [backend] Add docstrings and type hints to editor command endpoints and helpers
* 167b9fe [backend] Implement persistent cache for DocBot previews
* afafb93 [backend] Add Markdown validation and sanitization for design documents
* b062cc5 [backend] Fix ArchBot tool broadcast and test failure
* 214581c [backend][frontend] Implement ArchitectureBot
* 5d96143 [backend] Refactor update_markdown_section to use MarkdownEditor class
* 3d12444 [backend] Implement flexible DocBot workflow and update_markdown_section tool
* 144bacf [backend] Make Router depend on get_current_user to protect all endpoints
* 577fe23 [backend] Add safety checks to nvim_show_diff
* 321219c [backend] Refactor nvim_show_diff to use DiffviewOpen
* 493330d [backend] Implement diff_view_open editor command
* 524c4a9 [backend] Create editor command endpoint and router
* 3c80f42 [backend] Validate review_md payload in ReviewBot save_review tool
* 6eb99a8 [backend] Register ReviewBot tools on package import
* 8ff6115 [backend] Emit TASK_UPDATED after technical review deletion
* 821ab47 [backend] Extracts BotManager to handle any bots
* 73de3ec [backend] Fix type hinting and dictionary construction in AssistantSession
* 2da1781 [backend] Move base_session to separate bit directory
* 04da899 [backend] Allow recursive read/write in design directory for DocBot
* 3e5aa9b [backend] Improve BaseBotSession robustness against LLM parsing errors
* bc03660 [backend] Secure DocBot API endpoints
* e366d03 [backend] Extract BaseBotSession and refactor DocBotSession
* b335a0b [backend] Add test for DocBot

#### frontend
* 876a65a [frontend] Add test for `EditorClient`
* dd33a04 [frontend] Add test for `ReviewBotClient`
* 8291212 [frontend] Add test file for `DocBotClient`
* d1393a7 [frontend] Implement CoderBot real-time activity log
* fe67a0e [frontend] Add unit test file for `TaskStatusCounter`
* 505531d [frontend] Add unit test file for `TaskColumn`
* d17215f [frontend] Create a test for 'PullRequestSection'
* 2c3607c [frontend] Replace direct PR actions with Review flow
* 74fbc65 [frontend] Integrate CoderBot and PullRequest review flow
* 70829d3 [frontend] Add prefix validation and trimming to LocalStorageManager
* 349dcbf [frontend] Implement LocalStorageManager and refactor SPA for consistent persistence
* 87e1aba [frontend] Persist review notifications in localStorage
* dd8b58c [frontend] Remove making title editable when clicking on title
* a4a7864 [frontend] Refactor inline SVGs to use Icon component
* 8cd52be [frontend] Refactor TaskItem into sub-components
* 8fe219a [frontend] Make ReviewDialog use the ConfirmationDialog instead of the native confirm
* 6e3bd8e [frontend] Allow marked dialogs to be opened inside another dialog
* 4daa0ec [frontend] Minor improvements
* c402bd8 [frontend] Support multiple completed reviews in UI
* e75bbfe [frontend] Fix bug where DocBot review badge was not dislayed after doc changes
* 4b09291 [frontend] Resolve duplicate DocBot task
* a968339 [frontend] Fix DocBot completion state and add Git status debounce design doc
* e2f4685 [frontend] Throttle Git status refresh calls in PipelineDetailView
* 4bdf07d [frontend] Update task in UI when ArchBot completes
* 782fbb2 [frontend] Fix TypeScript strict mode errors in DataManager
* 15cf1b5 [frontend] Implement Centralized Data Manager
* ad616e8 [frontend] Move column layout switch to header
* 0f0c920 [frontend] Add history button to header
* ae90dae [frontend] Implement ButtonComponent and refactor HeaderDialogButtons
* 60db5d8 [frontend] Refactor PipelineHeaderView and extract subcomponents
* 79c128c [frontend] Redesign and declutter PipelineHeaderView
* bc06f3b [frontend] Auto-expand spec field when saving in edit mode
* ee2e9ea [frontend] Add two-column layout option to PipelineDetailView
* 3c30371 [frontend] Sanitize ReviewDialog Markdown output using DOMPurify
* cdedf80 [frontend] Refactor ReviewDialog footer to a data-driven component
* b4a0f1c [frontend] Minor layout fix for rendered markdown tables
* 0694af4 [frontend] Improve Markdown table rendering in ReviewDialog
* 981321c [frontend] Add quick prompt buttons to ReviewDialog
* 416c943 [frontend] Fix ReviewBotClient initialization and resolve TS build errors
* 78e210c [frontend] Refactor ReviewBot to use dedicated authenticated ReviewBotClient
* b8259e7 [frontend] Minor layout improvements
* f86cd73 [frontend] Move edit pipeline panel into a dialog
* 15c4d38 [frontend] Use git icon in git status badge
* 6a882dd [frontend] Make git status badge update on click
* 5ec25a9 [frontend] Add git status badge to pipeline header
* 12b0962 [frontend] Minor layout fix
* 272423a [frontend] Fix toggle_task_collapse in SearchDialog
* 6276c4f [frontend] Fix TaskItem actions in SearchDialog
* a23c620 [frontend] Minor layout improvement of DocBot badges in header
* 0d25c31 [frontend] Fix header layout and DocBotBanner style
* 19f30b8 [frontend] Add dark/light mode support to DocBotDialog
* 72a7002 [frontend] Hide order label in TaskItem when implemented
* 9467fab [frontend] Add quickfix button for implemented tasks
* a2d543a [frontend] Minot UI improvement
* 505d1d3 [frontend] Extract PipelineHeaderView from PipelineDetailView
* 0a66cf0 [frontend] Extract DocBotClient and refactor DocBotDialog

#### coderbot
* a1f7545 [coderbot] Refactor 'accept_pull_request'
* 6944640 [coderbot] Update task properly when applying PR
* b7e9d11 [coderbot] Sanitize task_id
* 46d7580 [coderbot] Keep logfile open and close in finally
* f92f8f6 [coderbot] Minor change of prompt for Pi

#### archbot
* 57a3658 [archbot] Minor update of system instructions to mention design docs
* dc064dd [archbot] Emit websocket message fo bot ending once only
* 546b8f4 [archbot] Handle bot_completed event in session
* 53216bb [archbot] Return defensive copy of tools list

#### mcp
* 2d7cfdd [mcp] Complete the mcp script and add a pi skill for it
* 9838387 [mcp] Add commit hash validation to complete_task tool

#### bot
* 2608633 [bot] Ensure terminal status is set before tool execution
* fa6f4db [bot] Fix base bot session tests
* cd05a76 [bot] Implement turn-warning injection in BaseBotSession
* 2fbe1ef [bot] Override get_default_feedback in DocBotSession
* 9573391 [bot] Inject user message when end of turns is near
* f930df7 [bot] Clean up, add more test and add a manual to build bots
* 6227c8d [bot] Improve ReviewBot system instructions with design documentation awareness
* 5ec92b0 [bot] Implement ReviewBot for technical task reviews

#### docbot
* 5a4aa73 [docbot] Reuse workflow description used in multiple places
* 9b684dc [docbot] Add lifecycle events and improve UI feedback

#### fullstack
* 921817c [fullstack] Fix missing review_md in ReviewDialog
* 0e6ae89 [fullstack] Add manual trigger for DocBot via UI

#### bugfix
* 1fabe45 [bugfix] Use --no-verify for all programmatic git commits
* 60ae8b9 [bugfix] Fix TypeError in DataManager listener during task removal
* 281f362 [bugfix] Fix JSON serialization error in BaseBotSession

#### fix
* 03231f9 [fix] Resolve CoderBotSession test flakiness and race conditions
* 76bb345 [fix] Add missing PullRequest retrieval by ID
* b960ed4 [fix] Update tests and git_tools after consolidation

#### cleanup
* ef0f9a0 [cleanup] Externalized the hardcoded `DOC_DIR` constant to a configuration setting
* fa06f09 [cleanup] Finalize Gemini/Vibe removal and generalize LogViewerDialog
* 5608198 [cleanup] Fix Markdown formatting in execution report
* 45acd89 [cleanup] Fix ruff formatting warnings
* 8bbcdfb [cleanup] Fix formatting issues
* ea6a461 [cleanup] Centralize git interactions into core.utils.git_utils

#### test
* ff91ca9 [test] Fix bot and git helper tests after sandbox refactor
* a239fff [test] Add LogViewerDialog component with streaming logs - 27 passing tests
* 7cd58e3 [test] Improve fallback storage test in LocalStorageManager
* 1fb609d [test] Add exhaustive path validation tests for CoderBot tools
* a877200 [test] Add comprehensive edge-case tests for editor commands
* 9d61c56 [test] Add robust test strategy and implementation for DataManager
* d1cf757 [test] Fix AttributeError in archbot tools tests
* 149266c [test] Fix delete cascade and git tools unit tests
* 2948c16 [test] Fix test regressions after git centralization
* f816e8a [test] Update PipelineHeaderView tests for new banner style
* 7cc3147 [test] Fix DeprecationWarning in route tests
* 0c20a7c [test] Fix test collection by ensuring unique filenames
* b9f5c94 [test] Add thorough tests for all API routes
* 7dcb9e1 [test] Reorganize backend tests into subdirectories
* f1407a8 [test] Improve model tests
* c7d217c [test] Add thorough tests for BaseBotSession
* f741363 [test] Add tests for BotManager
* 10a36e6 [test] Add thorough tests for DashboardView
* ca39340 [test] Add thorough tests for TaskClient
* 0ee6fb0 [test] Add thorough tests for AuthService
* 34a73bf [test] Add thorough tests for RegisterView
* b285bfe [test] Add thorough tests for LoginView
* 3237bcf [test] Add thorough tests for DocBotDialog
* a0b42bf [test] Add thorough tests for DesignDocDiffDialog
* 4c8b3bb [test] Add tests for SearchDialog
* dae507e [test] Add more frontend tests

#### design
* d51b1d0 [design] Create subdirectories for better organization
* 3366376 [design] Add ArchitectureBot design document
* e7f9963 [design] Design doc formatting

#### doc
* b3e4257 [doc] Update bots/dd_coderbot.md
* d9b2c78 [doc] Update bots/dd_coderbot.md
* 6761f68 [doc] Update bots/dd_conversation_logging.md
* b8d7d92 [doc] Update bots/dd_base_bot_session.md
* f0a22aa [doc] Update dd_local_storage_manager.md
* 49cb574 [doc] Update section '## 5. Security Considerations' in implemented/dd_markdown_design_doc.md
* a8e813a [doc] Update implemented/dd_data_manager.md
* 00d7e5b [doc] Update dd_backend_api.md
* 8a17bc3 [doc] Update implemented/dd_reviewbot.md
* 1c00560 [doc] Update dd_architecture.md
* ed6dcc1 [doc] Update implemented/dd_search_dialog.md
* ca3038a [doc] Update implemented/dd_quickfix_button.md
* aebf5c0 [doc] Remove redundant design doc
* 2e49eb6 [doc] Update implemented/dd_autonomous_docbot.md
* c8b8c9b [doc] Update implemented/dd_autonomous_docbot.md
* 500e388 [doc] Update implemented/dd_bot_manager.md
* bfacfa6 [doc] Update implemented/dd_autonomous_docbot.md
* 89f6e72 [doc] Update dd_spa_architecture.md
* 117b934 [doc] Update dd_base_bot_session.md
* abb0214 [doc] Update RELEASENOTES.md for 0.2.0

#### executor
* ea906da [executor] Remove GeminiExecutor and VibeExecutor

#### misc
* b4ae381 Update Dockerfile, build and deploy scripts to support pi coding agent
* 4133512 Fix frontend build
* a159261 Add pi model to app config
* bb1ccce Plump model of CoderBot through manager to session
* 874ec7b Fix coderbot test case
* bcb2bbe Add 'pi' to health check
* 9c767f8 Use deepseek4 flash for pi coding agent
* bf66f80 Create a test for PipelineClient
* b47918f Convert to bytes before sending to vim
* ddca3a2 [backend/frontend] Add Stop button to CoderBotDialog
* e6eae72 [backend/frontend] Add failure handling strategies to PR acceptance
* 2d34e49 [backend/frontend] Implement Commit on Accept for Pull Requests

## 0.2.0 – Major improvements and new features

* **DocBot Self‑Documentation Agent** – a fully autonomous agent that can generate design documents, code comments, and documentation on the fly.  
* **MCP security & JWT authentication** – the MCP backend now optionally enforces JWT auth with configurable paths and retries.  
* **Enhanced MCP tooling** – added `search_tasks`, `get_task_details`, and improved tool‑registry filtering.  
* **Frontend polish** – improved contrast in dark mode, horizontal scroll for wide tables, and better task ID visibility.  
* **Backend resilience** – graceful degradation when Ollama is unavailable, more robust logging, and retry logic for external services.  
* **Design doc updates** – several design documents moved/updated to reflect the new architecture.  

Below is the list of all commits that make up this release.

### Commits

Last commit: 3976395

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
