# Design Document: Authenticating git operations for pull-request acceptance (`dd_git_authentication.md`)

## 1. Purpose & Context

Ajapopaja Build supports **remote git repositories** for pipelines via a
`repo_uri`. Cloning (read) works today — verified against a GitHub repo and a
Gitea-style host. However, when a pull request is **accepted** in
`backend/api/src/api/routes/pull_request.py`, the flow currently only applies the
patch and commits **locally**:

```
apply_patch() -> format_workspace() -> commit_changes()   # local commit only
```

For a remote pipeline the accepted change must also be **pushed** to the remote
`origin`, and pushing requires **write authentication**. This document surveys
the common authentication approaches for the git hosts we care about (GitHub,
Gitea, GitLab) and proposes a solution that is easy to install and configure.

### Requirements

- The container must be able to **push** to the remote `origin` when a PR is
  accepted.
- Credentials must be **injectable** into the Docker image without being baked
  into the code or the image.
- Support the common hosts: GitHub, Gitea, GitLab (via HTTPS + token).
- Reasonable security: least-privilege tokens, no secrets in source control.

---

## 2. Where authentication is needed

| Operation | Direction | Auth needed |
|-----------|-----------|-------------|
| Clone (`ensure_repo_cloned`) | read | optional (public repos) |
| Fetch / pull (sync) | read | optional |
| **Push on PR accept** | **write** | **required** |

The push is the new operation. It happens in `accept_pull_request()` after
`commit_changes()`, only for pipelines that have a `repo_uri`.

---

## 3. Authentication approaches

### 3.1 HTTPS + Personal Access Token (PAT)

The most common and simplest approach. A token is used in place of a password
over HTTPS.

- **GitHub:** create a fine-grained or classic PAT with `Contents: write`
  (repo) scope.
- **Gitea:** create a token in *Settings → Applications*.
- **GitLab:** create a PAT with `write_repository` scope.

The token can be supplied in the clone/push URL:

```
https://<user>:<token>@github.com/org/repo.git
```

or via a **credential helper** / `~/.netrc` so it never appears in the URL.

- **Pros:** works over HTTP(S); no SSH key management in the container; easy to
  rotate; per-user and per-scope.
- **Cons:** token is a secret that must be stored and injected carefully.

### 3.2 SSH deploy key

Generate an SSH keypair and register the **public** key as a **deploy key** on
the repository (or as a user key on the account). Mount the **private** key into
the container and configure git to use it.

- **GitHub:** *Settings → Deploy keys* (read/write).
- **Gitea:** *Settings → Deploy keys*.
- **GitLab:** *Settings → Repository → Deploy keys*.

The container uses `GIT_SSH_COMMAND` or an `~/.ssh/config` entry:

```
GIT_SSH_COMMAND="ssh -i /run/secrets/git_deploy_key -o StrictHostKeyChecking=no"
```

- **Pros:** no token in URLs; deploy keys are scoped to a single repo; no
  password.
- **Cons:** more setup; the private key must be mounted and kept secret; SSH
  host-key verification must be handled.

### 3.3 Git credential helper / netrc

Store credentials in `~/.netrc` or configure a credential helper so git supplies
them automatically on push:

```
machine github.com
login <user>
password <token>
```

- **Pros:** keeps the token out of the URL and out of logs.
- **Cons:** still requires mounting the credential file; helper config.

### 3.4 GitHub App (fine-grained)

For organizations or fine-grained, short-lived permissions. More complex to set
up (app registration, installation, token exchange). Overkill for a single-host
deployment.

---

## 4. Recommended solution

**Use HTTPS + a Personal Access Token, with a global default and an optional
per-pipeline override.** This is the easiest to install and configure, and it
works uniformly across GitHub, Gitea, and GitLab.

### 4.1 Credential scopes

Credentials can be supplied at two levels:

1. **Per server (global default)** — one token in the env file, used for all
   pipelines. Simplest; correct when all repos live on the same host/account.
2. **Per pipeline (override)** — each `Pipeline` can store its own
   `repo_username` / `repo_token`. Used for least-privilege or when pipelines
   span different hosts/accounts.

Resolution order in `push_with_auth()`: **pipeline fields → global env → none**.

### 4.2 Configuration

Add global settings to `core/config.py` (env-overridable):

```python
GIT_PUSH_USERNAME = os.getenv("GIT_PUSH_USERNAME", "")
GIT_PUSH_TOKEN = os.getenv("GIT_PUSH_TOKEN", "")
```

These are forwarded to the container via the existing `env_file`
(`/etc/ajapopaja-build.env`), so **no code or image change is needed to supply
the global default** — just add them to the env file.

Add optional per-pipeline fields to the `Pipeline` model:

```python
repo_username: Optional[str] = None
repo_token: Optional[str] = None
```

These are set per pipeline (e.g. via the pipeline edit dialog) and take
precedence over the global env token.

### 4.3 Push with credentials

> **Note (updated):** the implementation deviates slightly from the original
> proposal below. Instead of rewriting the push URL, `push_with_auth()` and
> `push_branch_with_auth()` in `core/utils/git_utils.py` send an
> `Authorization: Basic` header through git's `http.extraHeader` config (injected
> via the `GIT_CONFIG_PARAMETERS` environment variable). The stored `repo_uri`
> stays clean and the token never appears in the URL. `_inject_credentials()` is
> still used, but only by `verify_remote_repo()` (`git ls-remote` reachability
> check), not by the push helpers.

A helper in `core/utils/git_utils.py` resolves credentials and pushes:

```python
def push_with_auth(repo: git.Repo, pipeline: Pipeline) -> None:
    """Push the current branch to origin, injecting credentials if configured."""
    if not pipeline.repo_uri:
        return
    username, token = _resolve_credentials(pipeline)  # pipeline -> global -> None
    if token:
        user = username or token  # fall back to the token when no user is given
        auth_pair = f"{user}:{token}".encode("utf-8")
        auth_header = (
            f"Authorization: Basic {base64.b64encode(auth_pair).decode('ascii')}"
        )
        env_config = f"'http.extraHeader={auth_header}'"
        with repo.git.custom_environment(GIT_CONFIG_PARAMETERS=env_config):
            repo.git.push("origin", "HEAD")
    else:
        repo.git.push("origin", "HEAD")
```

`push_branch_with_auth(repo, pipeline, branch)` is the equivalent for pushing a
named feature branch (used by the Gitea-PR submit flow); it targets
`refs/heads/{branch}:refs/heads/{branch}` so `origin`'s default branch is never
touched.

`_resolve_credentials()` returns the pipeline's `repo_username`/`repo_token` if
set, otherwise the global `GIT_PUSH_USERNAME`/`GIT_PUSH_TOKEN`. The credentials
are injected only for the push call and are **not persisted** in the repo
config or the stored `repo_uri`.

Deleting the remote feature branch on completion
(`GiteaClient.delete_branch`, §5.4 of [`dd_git_hosting.md`](dd_git_hosting.md))
uses the same resolved credentials as the push (pipeline fields → global env)
and therefore needs the same **repo write** token scope.

### 4.4 Wire into PR acceptance

In `accept_pull_request()` in `pull_request.py`, after `commit_changes()`:

```python
new_commit_hash = commit_changes(repo, pr, commit_message)
if pipeline.repo_uri:
    git_utils.push_with_auth(repo, pipeline)
```

When the remotely submitted PR later completes, the webhook/poller cleanup uses
the same credential resolution for `GiteaClient.delete_branch`; it is
best-effort and a 404 is treated as already deleted.

### 4.5 SSH alternative (optional, per repo) — NOT part of this implementation

> **Out of scope.** The SSH deploy-key approach is documented here only as a
> possible future direction. It is **not** part of the implementation proposed
> in this document.

For hosts where HTTPS tokens are not preferred, or for per-repo least-privilege
without storing tokens in the DB, an **SSH deploy key** (scoped to a single repo)
could be added later:

- Add `GIT_SSH_KEY` (path to a mounted private key) to config, or a per-pipeline
  `repo_ssh_key` field.
- In `push_with_auth`, if an SSH key is set, use
  `GIT_SSH_COMMAND="ssh -i <key> -o StrictHostKeyChecking=no"` and push over
  `ssh://`.

This keeps credentials out of the database entirely while still being per-repo.
**It is not implemented and is left as future work.**

### 4.6 UI requirements

The per-pipeline credential fields (`repo_username` / `repo_token`) and the
pipeline's repo configuration are edited in
`frontend/src/ui/components/PipelineEditDialog.ts`.

- **All properties editable** — the dialog should allow editing every pipeline
  property (name, status, doc_root, and the credential fields).
- **`workspace_path` and `repo_uri` are readonly** — once a pipeline is created,
  its workspace path and repo URI cannot be changed. They are set at creation
  time and displayed read-only in the edit dialog.

This keeps the pipeline's source-of-truth (where the repo lives) immutable after
creation, while still allowing operational properties and credentials to be
updated.

---

## 5. Security considerations

- **Never store tokens in code or the image.** Inject via environment variables
  or Docker secrets.
- **Least privilege:** use a token scoped to the repository (e.g. GitHub
  `Contents: write`, Gitea repo write) rather than a full-account token.
- **Per-pipeline tokens live in MongoDB.** If you store `repo_token` on a
  `Pipeline`, the database becomes a trust boundary — protect it accordingly.
  To keep credentials out of the DB entirely, use the global env token or an
  SSH deploy key instead.
- **Rotate tokens** periodically; a single env-file change (or pipeline edit)
  redeploys the new credential.
- **Do not log URLs containing credentials.** Redact the token in any log
  output.
- For SSH, use a **deploy key** scoped to one repo, and mount the private key as
  a secret (not baked into the image). *(SSH is not part of this implementation;
  see §4.5.)*

---

## 6. Integration with Ajapopaja Build

- `repo_uri` on the pipeline stays the **public** clone URL.
- Global credentials come from `GIT_PUSH_USERNAME` / `GIT_PUSH_TOKEN` (or
  `GIT_SSH_KEY`) in the env file, forwarded to the container via `env_file`.
- Per-pipeline credentials come from optional `repo_username` / `repo_token`
  fields on the `Pipeline` model, set via the pipeline edit dialog.
- `push_with_auth()` resolves credentials (pipeline → global → none) and
  injects them only for the push, keeping the stored `repo_uri` clean.
- The existing `ensure_repo_cloned()` (clone + fetch + pull) is otherwise
  unchanged; it works for public repos without credentials. Before fetching it
  reconciles the checkout's `origin` URL with `pipeline.repo_uri`, so a clone
  that was created on the host (e.g. with a `localhost` URL) or under an older
  `repo_uri` still syncs from inside the container once
  `REMOTE_WORKSPACES_ROOT` is bind-mounted.

### 6.1 Environment variables reference

| Variable | Purpose | Default |
|----------|---------|---------|
| `GIT_PUSH_USERNAME` | Global username for pushing to remote repos | *(empty)* |
| `GIT_PUSH_TOKEN` | Global token for pushing to remote repos | *(empty)* |
| `GIT_USER_NAME` | Commit identity name (author/committer) | `Ajapopaja Build` |
| `GIT_USER_EMAIL` | Commit identity email | `ajapopaja-build@localhost` |

Per-pipeline overrides are stored on the `Pipeline` model as `repo_username` /
`repo_token` and take precedence over the global env vars.

---

## 7. Decision summary

| Concern | Choice |
|---------|--------|
| Primary auth | **HTTPS + Personal Access Token** |
| Global default | `GIT_PUSH_USERNAME` / `GIT_PUSH_TOKEN` env vars via `env_file` |
| Per-pipeline override | `repo_username` / `repo_token` fields on `Pipeline` |
| Resolution order | pipeline fields → global env → none |
| Push mechanism | `push_with_auth()` / `push_branch_with_auth()` inject an `Authorization: Basic` header via `http.extraHeader` (`GIT_CONFIG_PARAMETERS`), keeping the URL clean |
| SSH alternative | **Not implemented** (future work) |
| Hosts supported | GitHub, Gitea, GitLab (HTTPS + token) |
| Not recommended | GitHub App (overkill), credentials baked into the image |
