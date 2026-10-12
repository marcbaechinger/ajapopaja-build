# Design Document: Exposing local git repositories on a Linux box (`dd_git_hosting.md`)

## 1. Purpose & Context

Ajapopaja Build now supports **remote git repositories** for pipelines: a pipeline
can declare a `repo_uri`, and the app (running in Docker) clones the repository
into a dedicated remote workspace root instead of relying on a host directory
mount. This decouples the Docker image from the host filesystem.

For that feature to be useful, the repositories must be reachable from the
container over a network protocol. This document surveys the options for exposing
local git repositories on a Linux box, weighs them for **ease of installation
and configuration**, and proposes a recommended setup.

### Requirements

- The Docker container must be able to **clone** a repository over the network
  using a `repo_uri` (e.g. `https://host/org/repo.git`).
- Ideally support **push** as well, so CoderBot's pull-request workflow can
  operate against a real remote.
- Minimal moving parts; easy to install, configure, and maintain on a single
  Linux host.
- Reasonable security (at least optional authentication).

---

## 2. Options at a glance

| Option | Protocol | Install effort | Auth | Push | Web UI | Best for |
|--------|----------|----------------|------|------|--------|----------|
| Local path / volume mount | filesystem | none | n/a | yes | no | quick dev, single host |
| Bare repo over SSH | `ssh://` / `git@host:` | low | SSH keys | yes | no | minimal self-hosted server |
| `git daemon` | `git://` | very low | none | no | no | read-only sharing |
| **Gitea** | `http(s)://` | low | built-in | yes | yes | **recommended** |
| Gogs | `http(s)://` | low | built-in | yes | yes | lighter Gitea alternative |
| GitLab CE | `http(s)://` | high | built-in | yes | yes | full CI/CD, teams |
| cgit / gitweb | `http(s)://` | medium | none | no | yes | read-only web browsing |

---

## 3. Detailed options

### 3.1 Local path / volume mount (no server)

The repository stays on the host filesystem and is mounted into the container
(e.g. `-v /home:/home`). This is the **current** Ajapopaja Build approach.

- **Pros:** zero install, zero config, works offline.
- **Cons:** couples the image to the host filesystem; not a "server"; no remote
  access from other machines; defeats the purpose of the `repo_uri` feature.
- **Use for:** quick local development only.

### 3.2 Bare repository over SSH

Create a bare repo and serve it over the system's SSH daemon:

```bash
mkdir -p /srv/git && cd /srv/git
git init --bare my-app.git
# clone from another machine / the container:
git clone ssh://user@host/srv/git/my-app.git
```

- **Pros:** minimal software (just `openssh-server`); supports push; uses
  existing OS accounts.
- **Cons:** the container needs an SSH key and the host needs the matching
  public key; no web UI; per-user key management.
- **Use for:** a lightweight, no-frills self-hosted server.

### 3.3 `git daemon`

Git ships a read-only daemon:

```bash
git daemon --reuseaddr --base-path=/srv/git --export-all --verbose
```

- **Pros:** almost zero config; no auth to set up.
- **Cons:** **read-only** (no push); **no authentication** (anyone who can reach
  the port can clone); not suitable for private repos.
- **Use for:** quick read-only sharing on a trusted network.

### 3.4 Gitea (recommended)

[Gitea](https://gitea.com) is a lightweight, self-hosted git service. It is a
single Go binary (or a small Docker image) with a web UI, built-in
authentication, and HTTP(S) clone/push.

- **Pros:**
  - **Very easy to install** — one binary or one Docker container.
  - Web-based setup wizard; configuration via a single `app.ini`.
  - HTTP(S) clone URLs that the Docker container can use **without SSH keys**.
  - Built-in user auth, organizations, and repo import from existing local repos.
  - Low resource usage (runs comfortably on a small VPS / old box).
- **Cons:** one more service to run; needs a reverse proxy for HTTPS (optional).
- **Use for:** the best all-round self-hosted option.

### 3.5 Gogs

A lighter fork that Gitea was forked from. Similar features, smaller community
and slower development. Choose Gitea over Gogs today.

### 3.6 GitLab CE

Full-featured (CI/CD, issue tracking, etc.) but **heavy** — requires significant
RAM and a database. Overkill for exposing a handful of local repos.

### 3.7 cgit / gitweb

Read-only web viewers for browsing repos over HTTP. No push, no auth. Useful as a
companion to a bare-repo server, not as a primary solution.

---

## 4. Recommendation

**Use Gitea** as the primary git host, installed via **Docker** (or the single
binary) on the Linux box.

### Why Gitea

1. **Ease of installation** — a single Docker container or one binary; no
   database to manage (SQLite by default).
2. **Ease of configuration** — a web-based setup wizard and a single `app.ini`.
3. **HTTP(S) clone URLs** — the Ajapopaja Build container can clone via
   `https://host/org/repo.git` with **no SSH key management** in the container.
4. **Push support** — CoderBot's pull-request workflow can push branches to a
   real remote.
5. **Import existing repos** — Gitea can import your existing local repositories
   so nothing is lost.

### Recommended setup (Docker)

```bash
# 1. Run Gitea
docker run -d --name gitea \
  -p 3000:3000 -p 22:22 \
  -v /srv/gitea/data:/data \
  -e USER_UID=1000 -e USER_GID=1000 \
  --restart unless-stopped \
  gitea/gitea:latest

# 2. Open http://<host>:3000 and complete the setup wizard
#    (set the SSH port to 22, HTTP port to 3000, SQLite database).

# 3. Create a repository (or import an existing local repo) and note its
#    clone URL, e.g. https://<host>/<user>/my-app.git
```

Then in Ajapopaja Build, create a pipeline with:

```
Repo URI: https://<user>:<token>@<host>/<user>/my-app.git
```

(Use a personal access token for authenticated clones; or expose Gitea behind a
reverse proxy with TLS and use `https://<host>/<user>/my-app.git`.)

### Minimal dev alternative (no Docker)

If you want the absolute simplest self-hosted server without a web UI:

```bash
# Bare repo over SSH
sudo apt install openssh-server
mkdir -p /srv/git && cd /srv/git
git init --bare my-app.git
# Container clones via: ssh://user@host/srv/git/my-app.git
```

---

## 5. Integration with Ajapopaja Build

- The `repo_uri` field on a pipeline accepts any cloneable URL.
- On first access, `ensure_repo_cloned()` clones the repo into
  `REMOTE_WORKSPACES_ROOT` and keeps it in sync with `origin` (`fetch` +
  `pull --ff-only`).
- For **Gitea over HTTP(S)**, no SSH keys are needed in the container — the
  clone URL (optionally with a token) is all that is required.
- For **SSH bare repos**, the container must have an SSH key whose public key is
  added to the host (or to Gitea's SSH keys).

---

## 5.1 Remote Pull-Request submission modes

Ajapopaja supports two ways to deliver accepted changes to a **remote** pipeline
(one that declares a `repo_uri`). The behavior is selected globally via the
`REMOTE_PR_MODE` setting in `backend/core/src/core/config.py` (env var
`REMOTE_PR_MODE`). Local pipelines (no `repo_uri`) always use `direct`.

| Mode | Behavior | Use when |
|------|----------|----------|
| `direct` (default) | Apply patch, commit, push `HEAD` to `origin`'s default branch | You want Ajapopaja to merge the change immediately |
| `gitea_pr` | Push a dedicated feature branch and create a **Gitea pull request** via the REST API | You want a code-review window before merging in the Gitea UI |

In `gitea_pr` mode the pull request is **not** merged by Ajapopaja; it is created
and left for external review/merging in the Gitea web UI. The Gitea PR URL is
persisted on the `PullRequest` row (`remote_pr_url`) and surfaced in the UI, and
the task transitions to `SUBMITTED` (recording `commit_hash` and `review_md`) to
await that external review; Ajapopaja does not watch for the merge.

### Submission Flow & Commit History

In `gitea_pr` mode, `_submit_as_gitea_pr` coordinates both git operations and Gitea API calls:

1. **Feature branch push (`git_utils.push_branch_with_auth`)**: Pushes the feature branch (`pr.branch_name`) containing the commit to the remote Git server. This step is strictly required because Gitea's REST API cannot create a pull request if the head branch does not already exist on the remote forge (returns HTTP 422 `ref does not exist`).
2. **Pull request creation (`GiteaClient.create_pull_request`)**: Calls Gitea's REST API (`POST /api/v1/repos/{owner}/{repo}/pulls`) to register the PR from `pr.branch_name` to the default branch (`base`). It does not push code; it only creates the review entity.
3. **Workspace restoration**: Restores the local workspace to the default branch (`base`) after submission so the local working copy remains clean while awaiting external review.

#### Why two commits appear after merging on Gitea

When the pull request is merged in the Gitea web UI, Gitea's default merge method is **"Create Merge Commit" (`merge`)**:
- A Git merge commit joins the base branch and the feature branch with two parent commits.
- Because no other commits intervened on base, the tree of the merge commit is identical to the feature commit.
- In Gitea's commit log for `main`, both the feature commit (`pr.branch_name`) and the merge commit (`Merge pull request '...' (#N) from ... into main`) appear.
- **Configuring single-commit history**: If a single linear commit is desired on the remote repository without an additional merge commit, the repository settings in Gitea should be configured to allow **Rebase (fast-forward)** or **Squash and merge**.

### Required token scope

For the PR flow the Gitea access token must have **repo write** scope (it needs
to push a branch and create a PR). The token is resolved the same way as git push
credentials: the pipeline's `repo_token` first, then `GIT_PUSH_TOKEN`.

Set this in the environment, e.g.:

```env
REMOTE_PR_MODE=gitea_pr
GIT_PUSH_TOKEN=<gitea-personal-access-token-with-repo-write>
```

Only HTTPS `repo_uri`s are supported for PR creation (SCP/SSH-style URIs resolve
the host over `https://` for the API call).

---

## 5.2 Security

- **Prefer HTTPS over SSH** for simplicity; use Gitea's built-in authentication
  and personal access tokens for private repos.
- **Least privilege:** scope tokens to the repository (e.g. GitHub
  `Contents: write`, Gitea repo write) rather than a full-account token.
- **Never bake credentials into the image.** Inject via environment variables
  (`GIT_PUSH_USERNAME` / `GIT_PUSH_TOKEN`) or Docker secrets.
- **Rotate tokens** periodically; a single env-file change redeploys the new
  credential.
- For SSH, use a **deploy key** scoped to one repo and mount the private key as
  a secret.

---

## 5.3 Interactive pull requests via the MCP tool

Besides the batch flow above, an **interactive** Pi session (the stateful chat
attached to a pipeline's clone) can create a Gitea pull request itself through
the existing MCP channel. The bundled `ajapopaja` skill exposes a
`create_pull_request` tool and a matching `create-pull-request` CLI command:

```bash
python3 ./mcp_client.py --url http://localhost:${PORT:-8081} \
    create-pull-request <pipeline_id> \
    --title "Add feature X" --body "…" [--task <task_id>]
```

The MCP server runs in the same Python process as the backend, so the tool can
call the database, `git_utils` and `GiteaClient` directly and resolve the same
credentials as the batch flow (`pipeline.repo_token` → `GIT_PUSH_TOKEN`). **The
Gitea token never enters the Pi process**; Pi only holds the optional MCP bearer
token (`MCP_AUTH_TOKEN`).

Behaviour:

1. The pipeline must be remote (`repo_uri` set).
2. The repository is opened **read-only** (no `ensure_repo_cloned`, so a live
   interactive checkout is never reset).
3. The working tree must be clean; the commit at HEAD is what gets reviewed.
4. The head branch is the current branch, or — when the agent committed straight
   onto the default branch — a new `pi/<task_id>` (or `pi/<short-sha>`) branch is
   created at HEAD *without* checking it out.
5. The branch is pushed with `push_branch_with_auth` and the PR is opened with
   `GiteaClient.create_pull_request` (shared helper
   `api/git_hosting/pull_requests.py::create_pipeline_pull_request`).
6. When `--task` is supplied the commit hash and PR URL are recorded on the task
   and it is moved to `SUBMITTED` when that transition is legal (from
   `PULL_REQUEST_AVAILABLE`); otherwise the status is left unchanged while the
   PR and the recorded hashes are still persisted.

Only PR creation is automated here; merging/accepting still happens in the
Gitea UI or through the batch `accept_pull_request` route.

---

## 5.4 Reconciling remote PR state back into Ajapopaja

`gitea_pr` mode leaves the local `PullRequest`/`Task` in `SUBMITTED` awaiting
external review. A **webhook** (primary) and an optional **polling** reconciler
(fallback) observe the remote outcome and mirror it back:

| Remote event | Local PR | Local task |
|---|---|---|
| PR **merged** (push to the base branch) | `ACCEPTED` | `IMPLEMENTED`, `commit_hash` = merge result |
| PR **closed without merge** (remote reject) | `REJECTED` | `CREATED` (mirrors the local reject) |

### Receiver endpoint

`POST /api/git_hosting/pipelines/{pipeline_id}/pr-state` (no user JWT; HMAC
protected). It accepts Gitea's native `push` or `pull_request` payloads, or a
minimal normalised body `{ "repo": "owner/name", "branch": "main",
"commit_hash": "<sha>", "state": "merged" | "closed" }`. The endpoint
**fetches the pipeline clone's remote-tracking refs and verifies any reported
commit is present and reachable before mirroring** state, so a stale or forged
payload cannot flip a task. Non-actionable events return `202
{"status":"ignored"}`; `sync_failed` / `commit_not_found` also return
`202` with the reason, while `mirrored` returns `200`.

#### Deferred pull during active coding sessions

Interactive Pi/CoderBot sessions are active very often, and the only step of the
reconciliation that can disturb one is the working-tree update. The receiver
therefore **always applies the DB mirror and broadcasts `TASK_STATUS_UPDATED`**
and only gates the working-tree pull on the session being idle:

1. `fetch_pipeline_repo()` clones if needed and runs `origin.fetch()`; it never
touches the working tree or the checked-out branch, so it is safe during a
session.
2. The reported `merged` commit is verified against the fetched `origin/<branch>`
   (unchanged semantics). If the fetch failed while a session is active the
   HMAC-authenticated payload is trusted and mirrored without verification.
3. `pull_pipeline_repo()` (`git pull --ff-only origin <branch>`) runs only when
   no session is active, the event matched at least one still-`SUBMITTED` PR
   (``affected_task_ids`` is non-empty) and the event targets the clone's
   checked-out branch. A push to a feature branch (for example the branch
   Ajapopaja itself pushes when a PR is accepted) matches no local PR, so it
   neither prompts nor pulls — the `push` webhook it triggers is a no-op for the
   clone. The branch check is read-only and best-effort: when it cannot be
   determined the historical pull behaviour is preserved.

**Decision (gate):** the strict ``affected_task_ids`` check is used rather than
an additional "is the clone behind ``origin/<branch>``?" test. The clone-behind
check cannot be combined with the requirement that a remotely *rejected* PR
still prompts (a reject produces no new commit), and — because the pull stays
deferred after the first event of a merge — it would re-prompt on the merge's
second event. The strict gate makes the prompt mean "a transition reconciled
local state", which is the intended semantics.

When the pull is skipped because a session is active, a `confirmation`/`actions` notification with a
`pull_remote` **"Pull now"** action is delivered, keyed by a stable id
(`pull_remote:<pipeline_id>`) so re-delivered events do not stack prompts.
Confirming runs `git_utils.pull`; dismissing is a no-op and the clone is
reconciled by the next webhook, the on-demand sync or the poller. The `200`
`mirrored` body carries `pull_deferred: true` so callers can tell that the DB is
current while the clone lags. `busy` is no longer returned by the receiver.

### Webhook registration

On remote-pipeline creation Ajapopaja calls `GiteaClient.ensure_pr_state_webhook`
(best-effort) to register a repository webhook subscribed to **both** `push` and
`pull_request` events, with a per-pipeline target URL embedding the pipeline ID.

### Polling fallback

Set `GITEA_PR_POLL_ENABLED=true` to have Ajapopaja periodically read every
`SUBMITTED` PR's remote state via `GiteaClient.get_pull_request` and feed the
same reconciler. Interval is `GITEA_PR_POLL_INTERVAL` (seconds, default `60`).

### Configuration

| Env var | Default | Meaning |
|---|---|---|
| `AJAPOPAJA_PUBLIC_URL` | `""` | Public base URL used to build the webhook target |
| `GITEA_WEBHOOK_SECRET` | `""` | HMAC shared secret for webhook signature verification |
| `GITEA_PR_POLL_ENABLED` | `false` | Enable the polling reconciler |
| `GITEA_PR_POLL_INTERVAL` | `60` | Poll interval in seconds |



| Concern | Choice |
|---------|--------|
| Primary host | **Gitea** (Docker or single binary) |
| Protocol | HTTP(S) clone/push |
| Auth | Gitea built-in users + personal access tokens |
| Dev-only quick option | Bare repo over SSH (or `git daemon` for read-only) |
| Not recommended | GitLab CE (too heavy), cgit/gitweb alone (read-only) |
