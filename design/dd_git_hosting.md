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
the task stays in `PULL_REQUEST_AVAILABLE` until the change is merged externally.

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

## 6. Decision summary

| Concern | Choice |
|---------|--------|
| Primary host | **Gitea** (Docker or single binary) |
| Protocol | HTTP(S) clone/push |
| Auth | Gitea built-in users + personal access tokens |
| Dev-only quick option | Bare repo over SSH (or `git daemon` for read-only) |
| Not recommended | GitLab CE (too heavy), cgit/gitweb alone (read-only) |
