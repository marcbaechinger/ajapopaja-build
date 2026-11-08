---
name: ajapopaja
description: Search, manage, and complete tasks using the Ajapopaja Build MCP server. Use this skill to create tasks, find next tasks, search tasks by keywords/status, view task details, update design documents, mark tasks as complete, and create a pull request for your committed work.
---

# Ajapopaja Task Management

This skill provides a CLI interface to interact with the Ajapopaja Build MCP server for task management. It is **self-contained**: the `mcp_client.py` helper script lives in this same directory, so the whole `ajapopaja/` folder can be copied to any skill location (a user's skill directory, a shared location, etc.) and still work.

## Setup

The helper script is bundled in this directory. Run it with `python3` (it requires the `httpx` package):

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} <command> ...
```

If `httpx` is not installed, install it once:

```bash
pip install httpx
```

The Ajapopaja API listens on `$PORT` inside the container, which defaults to `8081`. The examples below use `http://localhost:${PORT:-8081}`; substitute the real port if `PORT` is set to something else.

### Authentication

If the MCP server requires authentication (i.e. `MCP_AUTHENTICATION_ENABLED` is `true`), pass a bearer token with `--auth-token` so every RPC request includes an `Authorization: Bearer …` header:

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} --auth-token <token> <command> ...
```

Alternatively, set the `MCP_AUTH_TOKEN` environment variable instead of passing `--auth-token`:

```bash
export MCP_AUTH_TOKEN=<token>
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} <command> ...
```

If the server has authentication disabled (the default), the token is optional and can be omitted.

## Create a Task

Create a task directly in a pipeline through the MCP server. The task appears in
the pipeline view **live** (the server broadcasts a `TASK_CREATED` WebSocket
message), so no manual refresh is needed.

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} \
    create-task <pipeline_id> \
    --title "Add dark mode" \
    --spec "Markdown specification…" \
    --design-doc "# Design\n…" \
    --description "Short description" \
    --want-design-doc \
    --status scheduled \
    --order 10
```

Only `pipeline_id` and `--title` are required. Optional flags:

- `--spec` – Markdown specification.
- `--design-doc` – Markdown design document.
- `--description` – Short task description.
- `--want-design-doc` – Require an approved design document before implementation.
- `--status` – Initial status, default `created` (valid values include `created` and `scheduled`).
- `--order` – Priority/position; lower values sort first.

Tasks created with the default `created` status land in the backlog; use
`--status scheduled` to make them immediately available to `get-task`.

## Main Workflow

The core loop for working on tasks is:

1. **Get the next task** – pick up the next available `scheduled` task for a pipeline.
2. **Implement the task** – read the task details and implement it in the workspace.
3. **Propose a commit message** – propose a commit message for the commit that implements the task.
4. **Mark the task as completed** – record the commit and completion summary.

### 1. Get the Next Task

Fetch the next available `scheduled` task for a pipeline and move it to `inprogress`:

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} get-task <pipeline_id>
```

### 2. Implement the Task

Retrieve the full task details (specification, design document, and history) to understand what to build:

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} get-task-details <task_id>
```

If the task requires a design document (`want_design_doc` is True), provide one before implementing. This moves the task to `proposed` status:

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} update-design-doc <task_id> --design-doc "# Design Doc Content" --version <v>
```

Then implement the task in the workspace.

### 3. Propose a Commit Message

After implementing, propose a commit message for the commit that captures the change. The message should summarize what was implemented and reference the task.

### 4. Mark the Task as Completed

Commit the change, then mark the task as `implemented` with the commit hash and a completion summary:

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} complete-task <task_id> --commit <hash> --info "summary" --version <v>
```

## Create a Pull Request

Use this when you are working interactively in a remote pipeline repository and
want your committed work opened as a Gitea pull request.

1. **Commit your work on a branch.** The tool refuses to run with a dirty
   working tree, so stage and commit everything first. If you committed directly
   onto the default branch, don't worry: the tool creates a `pi/<task_id>` (or
   `pi/<short-sha>`) branch at HEAD for you, without switching your working tree.
2. **Run `create-pull-request`.** The server pushes the branch (using the
   pipeline's own git credentials — you never hold a Gitea token) and opens the
   pull request against the default branch:

   ```bash
   python3 ./mcp_client.py --url http://localhost:${PORT:-8081} \
       create-pull-request <pipeline_id> \
       --title "Add feature X" \
       --body "Markdown description"
   ```

3. **Optionally link a task.** Pass `--task <task_id>` to record the commit and
   PR URL on the task and mark it `submitted` (when the task's current status
   allows that transition):

   ```bash
   python3 ./mcp_client.py --url http://localhost:${PORT:-8081} \
       create-pull-request <pipeline_id> \
       --title "Add feature X" --body "…" --task <task_id>
   ```

The command prints the created PR URL, branch, base branch and commit hash.

## Auxiliary Actions

The following actions support the main workflow but are not part of the core loop.

### List Available Tools

Check what the MCP server currently supports.

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} list
```

### Search for Tasks

Search tasks by keywords, status, or pipeline.

```bash
# Search by keyword
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} search-tasks --keywords "search term"

# Filter by status
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} search-tasks --statuses scheduled inprogress

# Paginated search
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} search-tasks --limit 5 --page 0
```

### Get Task Status

Check the current status and verification results for a task.

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} get-task-status <task_id>
```

### Update Task Specification

Update the specification for a task.

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} update-task-spec <task_id> --spec "new spec" --version <v>
```

## Troubleshooting

- If you get a `307 Redirect` or `405 Method Not Allowed`, ensure the URL ends with `/mcp/` or use the `--url http://localhost:${PORT:-8081}` default which handles it.
- Ensure the FastAPI server is running on the specified port (default `8081`, configurable via `$PORT`).

## Artifacts

A pipeline can declare **one** build artifact (a single file produced by its
build, e.g. an APK or a ZIP). Query it, download it when it changed, then hand
it to a host-side process. The artifact API is generic: it always delivers one
file, so if a build produces several outputs the build command must package
them (for example into a ZIP) first.

### 1. Check for an update

Fetch the artifact metadata (existence, size, modification time, source version
and SHA-256) plus a short-lived download token:

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} get-artifact <pipeline_id>
```

Use `--json` for compact, script-friendly output.

Keep a fingerprint of the artifact you last downloaded or installed in your
session notes or a small local JSON file:

```json
{
  "pipeline_id": "…",
  "sha256": "…",
  "size": 4821376,
  "modified_at": "…",
  "version": "a1b2c3d4…",
  "local_path": "app-debug.apk"
}
```

On each poll compare the new metadata with that fingerprint:

- `size` and `modified_at` are the cheap first check (if both are unchanged,
  the file probably did not change).
- `sha256` is the **authoritative** equality check — download only when it
  differs.
- `version` is the workspace `HEAD` commit at query time: useful provenance,
  but not proof that the file was built from exactly that commit.

If `exists` is `false` (or the artifact is not configured), there is nothing to
fetch yet: ask the user to run the build in the web UI first and then poll again.

### 2. Download when newer

The metadata above already mints the download token; `download-artifact`
fetches fresh metadata and streams the bytes to a local file:

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} \
    download-artifact <pipeline_id> --output ./app-debug.apk
```

Without `--output`/`-o` the artifact's own filename is used in the current
directory. The download is a plain HTTP `GET` against the API, so it works from
the host without a user login.

**curl fallback.** If you prefer `curl`, mint the token and download directly:

```bash
TOKEN=$(python3 ./mcp_client.py --url http://localhost:${PORT:-8081} \
    get-artifact <pipeline_id> --json | jq -r .download_token)
curl -fL "http://localhost:${PORT:-8081}/api/pipelines/<pipeline_id>/artifact/download?token=$TOKEN" \
    -o app-debug.apk
```

### 3. Integrate

Give the downloaded file to the host-side process that needs it: install it on
a device, upload it, unpack it, run it, and so on. Only re-integrate after the
fingerprint actually changed. Android is one integration; see below.

### Installing Android APKs

To install the downloaded artifact on a device or emulator attached to the
host:

1. **Confirm a device/emulator is attached:**

   ```bash
   adb devices
   ```

   The list must contain a device in the `device` state (not `offline` or
   `unauthorized`).

2. **Download the APK** with `download-artifact` (or the `curl` fallback):

   ```bash
   python3 ./mcp_client.py --url http://localhost:${PORT:-8081} \
       download-artifact <pipeline_id> --output ./app-debug.apk
   ```

3. **Install it, replacing any existing version:**

   ```bash
   adb install -r ./app-debug.apk
   ```

4. **Optional: launch the app.** Pass the package and activity from the
   repository (the artifact API does not know them):

   ```bash
   adb shell am start -n <package>/<activity>
   ```

5. **If `adb install` reports `INSTALL_FAILED_UPDATE_INCOMPATIBLE`** (typically
   a signature mismatch between a debug and a release build), uninstall the
   existing package first and then install again:

   ```bash
   adb uninstall <package>
   adb install ./app-debug.apk
   ```

## Building Android Projects

The container ships JDK 17 and the Android command-line tools, with
`JAVA_HOME`, `ANDROID_HOME` and `ANDROID_SDK_ROOT` already configured. Use the
project's Gradle wrapper to build:

```bash
./gradlew assembleDebug
```

Guidance:

- **Do not rely on `local.properties`.** It is machine-specific. If a checked-out
  repository contains one, remove it (or make sure its `sdk.dir` points at
  `$ANDROID_HOME`). Never commit a new `local.properties`; the image's
  `ANDROID_HOME`/`ANDROID_SDK_ROOT` is all AGP needs. Add it to `.gitignore` if
  the project does not already ignore it.
- The Android SDK licenses are accepted in the image. The command-line tools are
  installed, but project-specific platforms and build-tools are not. AGP downloads
  the versions required by the project on the first build, so that build needs
  network access to Google's Maven/SDK repositories (`maven.google.com`,
  `dl.google.com`) and to `services.gradle.org` for the Gradle distribution.
- Kotlin is resolved through the Kotlin Gradle plugin from Maven; no separate
  Kotlin compiler is required.
- Build artifacts such as `app/build/outputs/apk/debug/app-debug.apk` remain in
  the workspace. To get one onto a host-side device/emulator, use the
  Artifacts workflow above (query → download → `adb install`); no `docker cp`
  is needed.
- The NDK and CMake are not pre-installed. For native projects, install the
  required versions on demand with `sdkmanager --install "ndk;<version>"`.

## Running a Dev Server

A dev server started in the container is only reachable from the host if it:

1. **Binds to `0.0.0.0`, not `127.0.0.1`/`localhost`.** Binding to loopback
   makes the server reachable only from inside the container.
2. **Binds to `$DEV_SERVER_PORT`, not a hard-coded / framework-default port.**
   That port is the one published to the host (and it is the same number inside
   and outside the container). For pipeline dev-server commands it is also
   exported as `$PORT`.

Most tools let you set host and port explicitly:

```bash
# Python (uv) server
uv run <app> --host 0.0.0.0 --port $DEV_SERVER_PORT

# Node / npm dev server
npm run dev -- --host 0.0.0.0 --port $DEV_SERVER_PORT
```

Do not hard-code a port; always read `$DEV_SERVER_PORT` so the command works in
both production and staging (they publish different ports).
