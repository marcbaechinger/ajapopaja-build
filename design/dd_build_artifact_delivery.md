# Design Document: Build Artifact Delivery to the Host (`dd_build_artifact_delivery.md`)

## 1. Overview

The `ajapopaja-build` container can now build Android projects and produce an
APK (see `design/backend/dd_android_build_support.md` and
`howtos/android_builds.md`). What is still missing is a convenient, supported
way to get that artifact *out of the container* and into a host-side process —
typically installing it onto a device or emulator connected to `adb`.

Today the operator does this by hand:

```bash
docker cp ajapopaja-build:/data/ajapopaja/remote_workspaces/android-test/app/build/outputs/apk/debug/app-debug.apk ~/apks/
adb install ~/apks/app-debug.apk
```

This document defines a **generic, single-file artifact delivery mechanism**
that lets an actor on the host (a human in the web UI, or a Pi coding agent on
the host machine) do three things without `docker cp`:

1. **Query** the current build artifact and its identity metadata (file
   timestamp, size, content hash, source version/commit) so the actor can
   cheaply decide whether an update is available.
2. **Download** the artifact over HTTP.
3. **Integrate** it into a host-side process — for Android, install it onto an
   emulator/device with `adb`.

While the motivating artifact is an APK, the API is deliberately **generic**: it
treats the build output as a *single file* (an APK, a ZIP packaging several
files, a binary, a container image, etc.). If a build produces more than one
file, the build process is expected to package them (e.g. into a ZIP) so a single
file is still delivered.

## 2. Goals & Non-Goals

### 2.1 Goals

- Define a **single-file build artifact** concept that a Pipeline can declare
  (its output path) and that is stored/edited in the database like the existing
  per-pipeline `build_commands`.
- Provide a **generic REST API** to query artifact metadata and download the
  artifact file.
- Provide **MCP tools** so a host-side Pi agent can query/download the artifact
  using the same mechanism the interactive in-container agent already uses for
  task management.
- Provide a **host-side skill** that teaches a Pi agent the artifact workflow,
  including an Android-specific section for `adb` install.
- Provide a **"Build" action in `PipelineDetailView`** that triggers the
  pipeline's configured `build_commands` and, after the build, surfaces the
  resulting artifact.

### 2.2 Non-Goals

- Multi-file artifact bundles, dependency trees, or incremental/partial
  downloads. We assume exactly one file per artifact declaration.
- Artifact signing, app-store publishing, or distribution to devices over the
  network (only local `adb` install is covered).
- Running builds *from the host*. Building stays in the container; the host
  actor only queries/downloads/installs the result.
- A general-purpose object store or artifact retention/history service. We
  deliver the artifact that is currently present in the pipeline workspace.

## 3. Current State

Relevant building blocks already exist:

| Component | Today | Relevant to this design |
|-----------|-------|-------------------------|
| `Pipeline.build_commands` | Stored as a list of argv lists, edited in `PipelineEditDialog` | The build we want to trigger and whose output is the artifact |
| `POST /api/pipelines/{id}/run/build` | Dispatches `build_commands` via `CommandRunner` and returns a `run_id` | Build trigger for the web UI; result delivery is currently incomplete (no WS push) |
| `api.assistant.tools.run_build` | Same build dispatch as an assistant tool | Confirms the command runner is reusable |
| `CommandRunner` (`api/assistant/tools/command_runner.py`) | Async argv runner with a `register_on_complete` callback | Reuse for build completion notification |
| File browser (`core/services/file_browser.py`, `api/routes/file_browser.py`) | Safe path resolution, `FileEntry` metadata, raw-file download with short-lived tokens | Reuse `resolve_file`/`FileResponse`/token pattern for artifact download |
| MCP server (`backend/mcp`) + `ajapopaja` skill + `mcp_client.py` | Task-management tools and a self-contained CLI | Extend for artifact query/download |

## 4. Requirements

### 4.1 Functional requirements

| # | Requirement |
|---|-------------|
| R1 | A Pipeline can declare a single build artifact (a repo-relative output path) alongside its `build_commands`. |
| R2 | An API can report the artifact's identity metadata: existence, size, last-modified time, a source version (git commit) and a content hash (SHA-256). |
| R3 | An API can stream the artifact file to the caller as a single downloadable file. |
| R4 | The web UI shows a "Build" action when `build_commands` are configured, and a download/status affordance when an artifact is configured. |
| R5 | A host-side Pi agent can query, download and (for Android) install the artifact via MCP tools + a skill. |
| R6 | The mechanism works for any single-file artifact, not only APKs. |
| R7 | Downloading is authenticated and does not leak arbitrary workspace files. |

### 4.2 Non-functional requirements

- **Generic**: no Android-specific logic in the core artifact API; Android is
  confined to the skill.
- **Secure by default**: reuse the existing path-traversal protection and
  short-lived-token patterns; never expose absolute filesystem paths.
- **Efficient monitoring**: the metadata query must be cheap enough to poll; the
  caller can compare a small fingerprint instead of re-downloading.
- **Composable with existing pieces**: reuse `FileBrowserService`,
  `CommandRunner`, the MCP server and the `ajapopaja` skill rather than
  inventing parallel machinery.
- **Idempotent**: repeated queries/downloads are safe.

## 5. Core Concepts

### 5.1 Build artifact declaration (`BuildArtifactSpec`)

A Pipeline may declare **one** artifact. It is configuration, not a stored file:

```python
class BuildArtifactSpec(BaseModel):
    path: str                      # repo-relative path to the single output file
    label: Optional[str] = None    # e.g. "Debug APK"
    description: Optional[str] = None
    media_type: Optional[str] = None  # optional Content-Type override
```

`path` is validated with the same rules as file-browser paths
(`sanitize_relative_path`, reject absolute paths and `..`, reject `.git`).

### 5.2 Artifact identity / fingerprint (`BuildArtifactInfo`)

The *state* of the artifact is computed at query time by stat'ing the file in
the pipeline workspace (never persisted). The response carries:

| Field | Meaning | Used for |
|-------|---------|----------|
| `path` | configured repo-relative path | addressing |
| `exists` | whether the file currently exists | did the build produce it? |
| `size` | bytes | cheap change hint |
| `modified_at` | file mtime (the build timestamp) | cheap change hint |
| `version` | workspace `HEAD` commit hash when the repo is git | human-readable source provenance |
| `sha256` | content hash | authoritative equality check |
| `media_type` | inferred or overridden Content-Type | download headers |
| `build_commands_configured` | whether a build can be triggered | UI + agent decisions |

**Update-detection guidance:** an agent stores the fingerprint of the artifact
it last installed (`sha256` + `size` + `modified_at` + `version`). On each poll
it compares: `size`/`modified_at` are the cheap first check, `sha256` is the
authoritative equality key, and `version` is the human-readable commit. This
avoids re-downloading and re-installing an unchanged APK.

`version` is the workspace's current `HEAD`, not a build-embedded version. It is
a *source* provenance signal, not proof that the file was built from exactly
that commit; for exactness use `sha256`. (See §16 for a future build-record
provenance extension.)

## 6. End-to-End Target Flow

```text
Web UI                                    Container                    Host Pi agent
--------                                   ---------                    -------------
PipelineDetailView "Build"
   |  POST /run/build
   +------------------------------------->  CommandRunner runs
   |                                            build_commands
   |  WS BUILD_RUN_COMPLETED  <------------------+
   v
GET /artifact  --> shows size/time/version/download

                                            REST/MCP
get_build_artifact(pipeline_id)
   <-------------  {path, size, modified_at,      <-----------------+
                    version, sha256,                        compare with
                    download_token}                         last-installed
                                                                  fingerprint
download token --> GET /artifact/download?token=...
   <-------------  (binary stream)  <--------------------------- save to disk
                                                            adb install -r <apk>
```

## 7. Design Approach

### 7.1 Dedicated artifact API (MCP metadata + REST download)

Add a dedicated `/artifact` REST surface and two MCP tools. Metadata is served
as JSON; the binary is streamed over HTTP with a short-lived, pipeline-bound
download token minted by the MCP tool (or by a JWT-authenticated REST call for
the web UI).

- **Pros**: single obvious entry point; agent-friendly; clean separation of
  metadata (JSON) and bytes (stream); no large base64 payloads; works without a
  shared filesystem mount.
- **Cons**: a little new endpoint/tool code (though it reuses existing helpers).

## 8. Data Model Changes

`backend/core/src/core/models/models.py`:

1. Add `BuildArtifactSpec` (a Pydantic `BaseModel`, as in §5.1).
2. Add `build_artifact: Optional[BuildArtifactSpec] = None` to `Pipeline`, with
   a `@field_validator("build_artifact")` that sanitizes the path (reuse
   `sanitize_relative_path`) and rejects `.git`.
3. Add `BuildArtifactInfo` (a `BaseModel`, as in §5.2) for API responses. It
   also carries the optional download fields:
   - `download_url: Optional[str]` (relative path for the agent to resolve)
   - `download_token: Optional[str]`
   - `expires_in: Optional[int]`

The artifact is intentionally *declared*, not a persisted `Document`. There is
no separate MongoDB collection in the MVP: metadata is always computed live so
the response can never be stale.

## 9. REST API Design

New router `backend/api/src/api/routes/artifact.py`, prefix
`/api/pipelines/{pipeline_id}/artifact` (included in `api/main.py`).

### 9.1 Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/artifact` | JWT (`get_current_user`) | Return `BuildArtifactInfo` (metadata only) |
| `POST` | `/artifact/token` | JWT (`get_current_user`) | Mint a short-lived download token (web UI) |
| `GET` | `/artifact/download?token=…` | artifact token | Stream the artifact file |

### 9.2 `GET /artifact`

Response (`BuildArtifactInfo`), e.g.:

```json
{
  "pipeline_id": "…",
  "configured": true,
  "build_commands_configured": true,
  "path": "app/build/outputs/apk/debug/app-debug.apk",
  "label": "Debug APK",
  "media_type": "application/vnd.android.package-archive",
  "exists": true,
  "size": 4821376,
  "modified_at": "2026-11-08T13:02:11Z",
  "version": "a1b2c3d4e5f6…",
  "sha256": "…"
}
```

When the pipeline has no `build_artifact`, `configured` is `false` and the file
fields are `null`. When the file is missing, `exists` is `false` (the UI/agent
can prompt "build first").

### 9.3 Download token

A dedicated short-lived token, distinct from the user JWT and the raw-file
token, with scope `artifact:download` and claims `{pipeline_id, path, exp, jti}`.
It is **pipeline- and path-bound**: the download endpoint only ever serves the
file at `pipeline.build_artifact.path`, so a token cannot be repurposed to read
an arbitrary workspace file.

- Minted by the MCP tool (for agents) and by `POST /artifact/token` (for the
  web UI, behind the user's JWT).
- TTL mirrors `RAW_FILE_TOKEN_TTL_SECONDS` (60 s) unless a separate
  `ARTIFACT_TOKEN_TTL_SECONDS` knob is preferred.

### 9.4 `GET /artifact/download`

```python
claims = decode_artifact_token(token)
pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
# validate claims.pipeline_id and claims.path == pipeline.build_artifact.path
resolved, _clean = FileBrowserService.resolve_file(pipeline, pipeline.build_artifact.path)
return FileResponse(resolved, media_type=..., headers={
    "Content-Disposition": f"attachment; filename*=UTF-8''{quote(resolved.name)}",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
})
```

This mirrors the existing `read_raw_file` implementation and reuses
`guess_media_type` from `core/services/file_browser.py`.

## 10. MCP API Design

Extend `backend/mcp/src/ajapopaja_mcp/tools.py` and register the new tools in
`backend/mcp/src/ajapopaja_mcp/server.py`.

### 10.1 `get_build_artifact(pipeline_id)`

Returns the same `BuildArtifactInfo` as the REST metadata endpoint, **plus** a
minted download token and a relative download path:

```json
{
  "configured": true,
  "build_commands_configured": true,
  "path": "app/build/outputs/apk/debug/app-debug.apk",
  "exists": true,
  "size": 4821376,
  "modified_at": "…",
  "version": "a1b2c3d4…",
  "sha256": "…",
  "download_url": "/api/pipelines/{id}/artifact/download",
  "download_token": "<short-lived>",
  "expires_in": 60
}
```

The token is minted server-side, so the agent never needs a user JWT to
download. The `download_url` is returned *relative*; the skill/agent prepends the
base URL it already uses to reach the API/MCP server (or uses
`config.AJAPOPAJA_PUBLIC_URL` when configured).

### 10.2 `download_build_artifact(pipeline_id, destination)` — optional convenience

Because MCP tools run *inside the container*, an MCP tool cannot write the file
onto the host. Downloading must be an HTTP GET from the host side. Two
acceptable shapes:

- **(Recommended) skill-side download**: `get_build_artifact` returns the token;
  the bundled CLI/skill performs the `GET /artifact/download?token=…` itself and
  streams bytes to a local file (see §12). No `download_build_artifact` MCP tool
  is needed.
- **(Optional) server-side proxy**: add `download_build_artifact` that reads the
  file and returns base64. This is **not** recommended for large artifacts.

Decision: implement only `get_build_artifact` in MCP; keep byte transfer as a
direct REST download from the host.

### 10.3 (Future) `run_build(pipeline_id)`

The assistant already exposes `run_build`. Exposing a matching MCP tool would let
a host agent trigger a rebuild before querying. It is **not required** for the
MVP (building remains the in-container Android pipeline's job), but the tool
surface is symmetric and can be added later.

## 11. Build Trigger in `PipelineDetailView`

The `POST /run/build` endpoint already exists but its result is currently not
pushed to the UI (it returns a `run_id` and the completion is only wired for the
assistant). Complete the loop:

1. **Result delivery**: in `api/routes/pipeline.py`, register a
   `CommandRunner` completion handler for REST-initiated build runs that
   broadcasts a WebSocket message, e.g. `WSMessage(type="BUILD_RUN_COMPLETED",
   payload={run_id, passed, commands, error})`. (A `BUILD_RUN_STARTED` message is
   optional for immediate button feedback.)
2. **Frontend client**: add `PipelineClient.runBuild(id)` →
   `POST /pipelines/{id}/run/build`.
3. **Header action**: render a "Build" button in the pipeline header when
   `pipeline.build_commands` is non-empty. On click, call `runBuild`, disable the
   button ("Building…"), and re-enable on the WS completion event.
4. **Artifact status**: after completion (and on view load), call
   `GET /artifact` and render a compact artifact row: label/path, size,
   modified time, version/commit, and a "Download" button. The download button
   calls `POST /artifact/token` then opens
   `/artifact/download?token=…` in a new tab (or triggers a browser download).
   Reuse the existing `NotificationToast` for build success/failure.

MVP feedback is a completion toast; streaming live build output (reusing the
`ProcessIoView` pattern or a dedicated build WS channel) is a follow-up, since
`CommandRunner` currently returns only an output tail at completion.

Frontend files touched: `frontend/src/core/clients/PipelineClient.ts`,
`frontend/src/core/domain.ts` (map `build_artifact`),
`frontend/src/ui/components/pipeline/PipelineHeaderView.ts` (or a small
`ArtifactView`), and `PipelineDetailView.ts` (WS subscription + refresh).

## 12. Host-Side Skill

Extend the existing, self-contained `ajapopaja` skill
(`.pi/skills/ajapopaja/SKILL.md` + bundled `mcp_client.py`) with an **Artifacts**
section, and add two CLI subcommands. Keeping it in the same skill means a host
Pi agent already knows how to reach the server and authenticate; the skill
remains portable because everything is relative/bundled.

### 12.1 New CLI subcommands (in `mcp_client.py`)

- `get-artifact <pipeline_id>` — calls `get_build_artifact` and prints the
  metadata + token.
- `download-artifact <pipeline_id> --output <path>` — calls
  `get_build_artifact` for the token, then performs an `httpx` streaming `GET`
  on `{base}/api/pipelines/{id}/artifact/download?token=…` and writes the body
  to `<path>` (default: `<artifact-name>` in the current directory). Reuses the
  same `--url`/`--auth-token`/`MCP_AUTH_TOKEN` handling as the other commands.

A plain `curl` fallback is documented for agents that prefer it:

```bash
TOKEN=$(python3 ./mcp_client.py --url … get-artifact <pipeline_id> --json | jq -r .download_token)
curl -fL "http://ajapopaja/api/pipelines/<pipeline_id>/artifact/download?token=$TOKEN" -o app-debug.apk
```

### 12.2 Generic workflow documented in `SKILL.md`

1. **Check for an update** — `get-artifact <pipeline_id>`, compare `sha256` /
   `size` / `modified_at` / `version` against the last-installed fingerprint
   (the agent keeps this in its session notes or a small local JSON file).
2. **Download when newer** — `download-artifact <pipeline_id> --output …`.
3. **Integrate** — hand the file to the host-side process (install, upload,
   unpack, etc.). If the artifact does not exist, prompt the user to build it in
   the web UI first.

### 12.3 Android-specific section

Add an "Installing Android APKs" subsection that instructs the host agent:

1. Confirm a device/emulator is attached: `adb devices`.
2. Download the APK (the `download-artifact` command, or `curl`).
3. Install it, replacing any existing version: `adb install -r <apk>`.
4. Optional: launch the app via `adb shell am start -n <package>/<activity>`
   (the agent obtains these from the repo, not from the artifact API).
5. Guidance: if `adb install` reports `INSTALL_FAILED_UPDATE_INCOMPATIBLE`
   (e.g. a signature mismatch between a debug and a release build), uninstall
   first with `adb uninstall <package>` then `adb install <apk>`.

Optionally add an `install-apk <pipeline_id>` convenience subcommand that
downloads to a temp file and runs `adb install -r`, but the generic
download-then-integrate split keeps the core skill Android-free (R6).

## 13. Security & Authorization

- **Path safety**: reuse `FileBrowserService.resolve_file` /
  `sanitize_relative_path` / `.git` exclusion so `..`, absolute paths and
  symlink escapes are rejected.
- **No arbitrary reads**: the download endpoint serves only
  `pipeline.build_artifact.path`, and the token carries that path (defense in
  depth) and a short TTL.
- **Token confusion guard**: add a dedicated `decode_artifact_token` that checks
  `scope == "artifact:download"`; the central `decode_token` guard in `auth.py`
  continues to reject raw-file/artifact tokens as general access credentials.
- **No absolute paths leak**: download headers expose only the basename (same as
  the raw viewer).
- **MCP auth**: when `MCP_AUTHENTICATION_ENABLED` is on, the existing middleware
  protects `get_build_artifact`; the returned download token is short-lived and
  path-bound, so the subsequent download is safe even without a user JWT.

## 14. Provenance & Caching

- `modified_at` and `size` come from `os.stat` (cheap).
- `sha256` is computed by streaming the file once. For typical APKs/ZIPs this is
  negligible, but for very large artifacts or high-frequency polling the
  metadata endpoint may accept `?include_hash=false` and omit `sha256`, letting
  the agent use `size`+`modified_at` first and request the hash only when those
  change.
- `version` is `HEAD` of the workspace git repo (via `git_utils.get_repo`); it is
  `null` when the workspace is not a git repo.

## 15. Implementation Plan

1. **Model + query** — add `BuildArtifactSpec`/`BuildArtifactInfo` and the
   `Pipeline.build_artifact` field/validator; add a `core` service
   (e.g. `core/services/artifact.py`) that resolves the workspace, stats/hashes
   the file and derives `version`.
2. **Auth token** — add `create_artifact_token`/`decode_artifact_token` and the
   `artifact:download` scope in `api/auth.py`.
3. **REST router** — `api/routes/artifact.py` with the three endpoints, wired in
   `api/main.py`.
4. **MCP tool** — `get_build_artifact` in `ajapopaja_mcp/tools.py`, registered in
   `server.py`.
5. **Build completion WS** — register a completion handler in
   `api/routes/pipeline.py` `_run_pipeline_commands` that broadcasts
   `BUILD_RUN_COMPLETED`.
6. **Frontend** — `PipelineClient.runBuild`/`getArtifact`/`mintArtifactToken`;
   header Build button; artifact status/download row; WS handling in
   `PipelineDetailView`/`PipelineRealtimeController`; edit-dialog field for
   `build_artifact.path`.
7. **Skill** — add `get-artifact`/`download-artifact` to `mcp_client.py`; add
   the Artifacts + Android install sections to `.pi/skills/ajapopaja/SKILL.md`.
8. **Tests** — model validation, artifact service (exists/missing/non-git),
   token auth, REST download (stream + path-escape), MCP tool, frontend
   client/view tests, and skill CLI smoke tests.

## 16. Verification Plan

1. **Unit**: `BuildArtifactSpec` rejects absolute/`..`/`.git` paths; artifact
   service returns correct size/mtime/sha256/version for existing, missing and
   non-git workspaces.
2. **Auth**: download token is short-lived, pipeline/path-bound, and rejected by
   general JWT endpoints (and vice versa).
3. **REST e2e**: configure an artifact path; `GET /artifact` reports metadata;
   `GET /artifact/download?token=…` streams the exact bytes (compare hash); a
   tampered token or foreign pipeline id is rejected.
4. **MCP**: `get_build_artifact` returns metadata + a usable token; downloading
   with that token succeeds without a user login.
5. **UI**: a pipeline with `build_commands` shows the Build button; clicking it
   runs the build and surfaces completion; the artifact row appears and Download
   fetches the file.
6. **Host skill**: on a host with `adb`, run the documented Android flow end to
   end (query → download → `adb install -r`) against an emulator.
7. **Regression**: existing build/test/lint suites still pass (additive
   change).

## 17. Risks & Open Questions

- **`version` ≠ exact build commit**: `HEAD` can drift from the commit that
  actually produced the file (dirty tree, subsequent checkouts). Mitigation:
  treat `sha256` as authoritative; optionally record a `BuildRun` provenance
  (commit at dispatch time) in a future iteration.
- **Live build streaming**: `CommandRunner` returns only an output tail at
  completion; the MVP uses a completion toast. Streaming output is a follow-up.
- **Large artifacts**: `sha256` on every poll can be wasteful for very large
  files; `?include_hash=false` mitigates.
- **Token minting base URL**: MCP returns a *relative* download path; the skill
  must join it with its known base URL. `AJAPOPAJA_PUBLIC_URL` can supply the
  public base when the agent's own URL differs.
- **Multi-file builds**: out of scope by design; the build command must package
  multiple outputs into one file (ZIP). Document this in the skill.

## 18. Out of Scope (reaffirmed)

Release signing, store publishing, network device distribution, NDK builds, and
artifact retention/history are out of scope. This document only delivers the
*single current artifact* of a pipeline to a host actor and integrates it into
host-side processes (e.g. `adb` install).
