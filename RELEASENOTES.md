# Release Notes

## 0.4.2 – Android support, build artifacts, PiView themes, and UI polish

This release adds first-class Android builds and build-artifact delivery,
introduces a full theming system for PiView, and aligns the app's dark/light
mode across every component.

### 🤖 Android build support

* **Android toolchain in the container** – the image now ships JDK 17 and the
  Android SDK command-line tools with accepted licenses. Agents build Android
  projects using the repository's Gradle wrapper; the Android Gradle Plugin
  downloads the project-specific platform and build-tools on demand (see
  [`howtos/android_builds.md`](howtos/android_builds.md)).

### 📦 Build artifact management and delivery

* **Build artifacts are first-class** – a new build-artifact data model, REST
  API and download-token auth let pipelines expose their `build_commands` output
  (e.g. an Android APK) for download.
* **Build in the UI** – the pipeline view gains a **Build** button and an
  artifact status/download row; build completion is broadcast over WebSocket.
* **Agent-accessible** – a `get_build_artifact` MCP tool and
  `get-artifact`/`download-artifact` CLI commands let agents and the bundled
  skill fetch and deliver artifacts to the host.

### 🎨 PiView themes and app theme alignment

* **PiView theme system** – PiView colors moved into a dedicated `--piview-*`
  token layer with a theme registry, variant/theme options and `setTheme()`.
  New `batch-terminal` and `interactive-chat` themes ship alongside
  `batch-paper` and `interactive-focus` presets, backed by a conformance suite
  (structure/markup freeze, contrast, reduced motion).
* **Theme sets** – `ThemeSet` types, a registry and a `ThemeManager` store
  provide harmonized palettes (interactive → app, batch → interactive), with
  light variants for the default interactive and batch themes and an
  alternative theme set. A theme-set picker in the dashboard persists the
  selection.
* **Dark/light mode alignment** – the app theme is aligned with PiView, and
  dark/light mode is improved across all components, including AA-contrast fixes
  for light-mode PiView status/thinking roles and a broadened contrast matrix.

### ✨ UI cleanups and improvements

* **Decluttered dashboard** – the redundant “Logged In” label and the Search
  button in the dashboard header are gone; the profile badge and theme-set
  picker are reordered.
* **Simpler, roomier views** – `HistoryView` is simplified with aligned line-item
  fonts, the `DiffDialog` is wider, and the backlog sidebar layout is improved.
* **Model selector for interactive sessions** – the “Start interactive session”
  screen now lets you choose the model.

### 🔧 Fixes

* Copy-to-clipboard now works on insecure origins (e.g. `http://ajapopaja`).
* Fixed input-field focus in the backlog section.
* The batch-session verification info now includes the model.
* Fixed a cross-pipeline `BUILD_RUN_COMPLETED` broadcast.
* Removed the legacy `backend/mcp/src/scripts/mcp_client.py` duplicate.

## 0.4.1 – GitHub pull‑request support

* **Remote GitHub repositories can now open pull requests** – the remote PR
  submission flow was Gitea‑specific: it used `{host}/api/v1` with `token`
  auth, so a GitHub `repo_uri` pushed the feature branch but never opened a PR.
  A new `GitHubClient` targets `https://api.github.com` with `Bearer` auth (for
  fine‑grained personal access tokens), so accepting a change on a GitHub
  remote now opens a real pull request. Requires `REMOTE_PR_MODE=gitea_pr` and
  a token with `Contents` and `Pull requests` write access.
* **No webhook for internet-hosted repos** – the Gitea PR-state webhook is no
  longer registered for repos on the public internet (e.g. `github.com`), since
  our internal server is unreachable from there; manual sync is used instead.
* **Manual sync works for GitHub** – the “Sync” button now reconciles remote PR
  state for GitHub repos (using the GitHub client), so a user can manually
  reconcile PR acceptance/rejection when a webhook cannot deliver. The manual
  sync action is also available from the Commits tab.

## 0.4.0 – IDE‑style workspace, remote repositories, interactive sessions, and richer agent tooling

This release rebuilds the dashboard around an IDE‑style workspace, adds
first‑class support for remote git repositories, turns the live CoderBot log
(PiView) into a first‑class part of the UI, and equips the Assistant with slash
commands and a much broader tool set.

### 🧭 Frontend redesign – an IDE‑style workspace

* **PipelineDetailView rebuilt as an IDE‑style layout** – a left sidebar holds the
  **backlog**, the currently selected task and the quick‑add panel, the centre
  column shows the open task sequence, and the right sidebar hosts the live
  CoderBot view together with the history feed.
* **Backlog and task views** – `BacklogView` renders `CREATED`/`PROPOSED` tasks
  with inline workflow actions, and a dedicated `TaskView` inspects the selected
  task without leaving the pipeline.
* **Dashboard redesign** – the dashboard is composed of `PipelineItemView` cards,
  sorted by status and recency, with a cleaner pipeline panel.
* **Centralized frontend state** – `DataManager`, `AppContext`, `ActionRegistry`,
  `Navigator` and `KeybindingManager` provide a single source of truth for domain
  and UI state, with preferences persisted through `LocalStorageManager`.
* **Richer task cards** – inline title editing, collapsible specification and
  status history, Markdown‑rendered implementation and pull‑request summaries, a
  relocated commit‑hash pill, and HTML‑injection protection.
* **Statistics** – the stats dialog/`PipelineStatsView` was refactored and now
  reports the total processing time and tracks deleted tasks.

### 🌐 Remote git repositories (Gitea, GitHub, …)

* **Pipelines can point at a remote repository** through a new `repo_uri`; the app
  clones it into a dedicated remote workspace instead of relying on a host
  directory mount.
* **Authenticated push on pull‑request acceptance** – accepting a PR now pushes
  the commit to the remote `origin`. Credentials are injected through a git
  **credential helper** instead of a tokenised URL, and the pipeline token is
  never exposed in the UI.
* **Gitea pull‑request workflow** – real pull requests can be opened against a
  remote host. Pull requests gain a **subject**, PR titles are derived from the
  commit message, and the summary is read back from Gitea.
* **Hardening** – `repo_uri` and pipeline creation are validated, pushing to an
  unborn repository, duplicate commits and null PR URLs are handled, and the flow
  is covered by integration tests and security/environment documentation.

### 📺 PiView – live CoderBot activity log

* **Standalone component** embedded in the `ExecutionEngineView` and the CoderBot
  dialog, with a live session status, an elapsed‑time indicator, and empty /
  session‑ended states.
* **Scannable long sessions** – auto‑collapsing `thinking` blocks, collapsible
  `tool` and `verification` blocks, an error‑visibility toggle, next/previous
  error navigation, and in‑log find/search.
* **Copy and share** – copy individual blocks or the whole log, format entries as
  Markdown, and open the log in a dialog.
* **Slash commands and shortcuts** – a growing set of PiView slash commands
  (e.g. `/test`, `/gd` to drop the top commit, `/i` to improve a prompt) and
  remappable keyboard shortcuts surfaced in button tooltips.
* **Performance** – a stateful session and animation‑frame‑coalesced
  reconciliation keep the log smooth even for very long runs.

### 📜 History view

* The pipeline history is now a **compact, paged “History Feed”** (page size 10)
  shown at the bottom of the right sidebar, below PiView.
* Settled tasks are listed newest‑first with a commit‑hash button and paging
  controls.
* The `HistoryDialog` is now based on the **git repository status** instead of the
  task list and also shows `SUBMITTED` tasks.

### 🤖 Assistant slash commands and tools

* **Slash commands** in the AssistantPanel (e.g. `/test`, `/git pull`).
* **`/test` and the `run_tests` tool** execute a pipeline’s configured test
  commands asynchronously and report the result back to the assistant.
* **Build commands** – pipelines can now store `build_commands`, editable in a
  new **Build** tab of the pipeline editor, with a matching `run_build`
  assistant tool and `POST /pipelines/{id}/run/build` endpoint.
* **New tools** – read GitHub issues and pull requests, pull from the remote,
  update a task spec (`update_task_spec`), delete a task, and open a task diff
  using `DiffView`.
* **AI improve buttons** and AssistantPanel usability improvements.
* **Configurable models** – the model used by each bot and by the Assistant can
  now be configured independently (DeepSeek is the default coding model).

### ✨ One‑shot AI prompts

* A general **one‑shot prompt infrastructure**: server‑side prompt templates with
  context data providers and hooks, an `OnePromptRunner` backed by Ollama, and
  WebSocket streaming back to the UI.
* The first consumer is an **“Elaborate” button** on the task specification that
  expands a rough dot list into a complete spec, which is reviewed and accepted
  in place.

### 📐 Design‑document iteration

* **Iterate on a design document** – ArchBot can refine an existing
  `Task.design_doc`, creating a new version each time and keeping the design
  history.
* An **“Update design”** action in the task view starts an iteration and keeps the
  previous versions in the design history.

### 🧰 Task ordering and workflow

* `Task.order` semantics are documented and applied consistently to the backlog
  and the execution queue, and the order is now editable directly in the UI.
* Workflow actions were added to backlog tasks, and completed/submitted tasks are
  handled like settled work throughout the UI.

### 🖥️ Dev server management

* Pipelines can start and stop their configured `serve_commands` through a new
  process manager, with a **Start dev server** button in the pipeline editor.
* Docker now publishes the user dev‑server port **1224**, so a started server is
  reachable from the host.
* **Dev server on a pull‑request branch** – the dev server can run against a
  PR branch, with branch info shown in the dialog and a **back to default
  branch** button.

### 🔌 MCP & Pi skill

* The shipped **Pi skill is now self‑contained**: it bundles `mcp_client.py` and
  works from any location.
* New `update_task_spec` MCP/CLI command, a configurable MCP endpoint, and a
  cleaner `mcp_client` interface.
* **Per‑session Pi skills** – the bundled skill library is baked into the image
  and staged per session type, so the interactive coding session exposes the
  `ajapopaja` skill while batch CoderBot sessions expose none by default. Models
  stay global; skills are configurable via `INTERACTIVE_SKILLS` and
  `CODERBOT_SKILLS`.
* **Pi agent upgrades** – Pi coding agent **1.5.0** on Node.js 24, a bundled
  `code‑review` skill, and additional models (deepseek‑pro, gpt‑oss:120,
  qwen3‑coder).

### 🔒 Security & reliability

* Credential‑helper based git push, validated remote URIs, and no secrets exposed
  to the frontend.
* Consistent CoderBot state transitions and history, batched history‑replay
  notifications to fix reload freezes, and fixes for stale queue rows and task
  removal.
* Correct MongoDB port handling in continuous integration.

### 🧪 Testing & tooling

* An idempotent **test‑database seeding script** (`scripts/setup_test_db.py`) with
  sample task data.
* Broad new test coverage, including integration tests for the remote‑pipeline
  flow, and pipeline‑specific verification commands (`CommandRunner`, lint).
* **Faster backend tests** – the suite runs in parallel with `pytest‑xdist` and
  uses an in‑memory MongoDB, and wall‑clock `asyncio.sleep` delays are removed.

### 💬 Interactive session manager

* **No more surprise logouts when running staging side by side** – the refresh
  cookie name is no longer hard-coded to `refresh_token`. It is read from
  `REFRESH_COOKIE_NAME` (defaulting to a name derived from `DATABASE_NAME`), so
  production and staging on the same host stop overwriting each other's
  HttpOnly refresh cookie. Because the cookie name changes, every browser does
  one re-login after upgrading. The access token is now refreshed proactively
  and only once per burst of concurrent `401`s, and the WebSocket
  re-authenticates after a refused handshake.

* **Coding Agent tab is always available** – the detached **Start Interactive
  Session** button above the content area is gone. The Coding Agent tab is now
  always shown; with no session attached it renders PiView's “No active
  session…” empty state carrying the **Start Interactive Session** button for
  remote pipelines (local pipelines show the empty state without it). The
  embedded view is kept mounted across tab switches and is scoped to its own
  pipeline, so another pipeline's running session never leaks its log into it.

* **Session manager drawer** – a global right‑hand panel (Sessions button in the
  dashboard and pipeline headers, `Ctrl/Cmd+J`) lists every durable Pi session
  grouped by status (Active, Paused, Completed, Failed, Discarded) with search,
  status filters and a batch‑session toggle. Selecting a paused session pauses
  the current one and resumes the target atomically.
* **Per‑pipeline resume** – pipeline detail views show an inline session list
  of paused/completed sessions; resuming one is a single click from that list.
  The Coding Agent tab's empty state offers **Start Interactive Session** for
  pipelines with no session.
* **Replay‑race fix** – resuming a session no longer loses its replayed history
  when a late `INTERACTIVE_STARTED` broadcast arrives.
* **Session rename** – `PATCH /api/coderbot/sessions/{uid}` updates a session
  label and broadcasts a `SESSION_UPDATED` websocket message.
* **Simpler interactive controls** – the interactive coding header no longer
  offers a redundant **Switch session** button (the global Sessions button,
  `Ctrl/Cmd+J` and the inline session list already cover switching) nor a
  **Stop Session** button. Pause and Stop were functionally identical: both end
  the Pi process and leave the durable session `PAUSED` and resumable. Only
  **Pause** remains; it is disabled while the session is inactive. The genuinely
  destructive **Discard** action (releases the retained workspace and Pi session
  file) stays behind its confirmation in the session manager / inline rows.
* **Sessions survive container restarts** – sessions are now persisted under a
  dedicated host path (`PI_SESSIONS_ROOT`, default `/data/ajapopaja/pi_sessions`)
  that is bind-mounted 1:1 into the container, instead of living in the
  container's writable layer. Interactive and batch sessions therefore survive
  `docker compose down`, image reloads and systemd restarts.

### 🐳 Docker & deployment

* **Single, self‑contained `.env`** – all host‑specific settings live in one
  `.env` file (template `.env.example`). Docker Compose reads it for `${VAR}`
  interpolation *and* forwards it as the container's runtime environment, so a
  local `docker compose up` works end‑to‑end without editing any script.
* **One source root, no home‑directory mounts** – the container no longer maps
  entire `/home` or `/Users` trees. A single optional `WORKSPACES_ROOT` mount
  exposes local repos; remote‑only deployments need none.
* **Isolated local / prod / staging instances** – the local template uses
  distinct ports, container name, database and data roots so all three can run
  side by side on one host.
* **Loopback‑bound ports** – published ports bind to `127.0.0.1` so nginx is the
  only entry point, and nginx now proxies WebSocket connections.
* **Friendly staging domains** – prod and staging are reachable via `/etc/hosts`
  names (`ajapopaja`, `ajapopaja.stage`).

### 📝 DocBot documentation PRs

* **Real Gitea documentation PRs** – DocBot now opens complete documentation
  pull requests (with a PR `kind`, subject and a unique branch) instead of the
  legacy preview/commit path, which is removed.
* **Kind‑aware acceptance** – documentation PRs no longer transition tasks or
  trigger implementation chaining/cleanup, keeping docs separate from code work.
* **Visible failures** – DocBot PR‑creation failures are surfaced in the session
  results rather than failing silently.

### 🔁 Pull‑request reconciliation & cleanup

* **Remote PR state reconciled locally** – Gitea PR merges/rejections flow back
  to the local PR/task via webhook and an on‑demand **Sync from Gitea** action.
* **Automatic branch/patch cleanup** – completed PRs release their feature
  branch and patch through a shared cleanup helper (both local accept and the
  Gitea hook path).
* **Reliability fixes** – merged/rejected PRs no longer stay stuck in
  `SUBMITTED`, rejected PRs no longer leak into new CoderBot branches, and
  chained PRs accept correctly in Gitea‑PR mode.

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
