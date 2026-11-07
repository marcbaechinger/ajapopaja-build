# Copyright 2026 Marc Baechinger
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import base64
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote, urlsplit, urlunsplit

import git
from beanie.operators import In

from api.git_hosting.gitea import GiteaClient
from core import config
from core.exceptions import EntityNotFoundError, ValidationError
from core.models.models import (
    Pipeline,
    PiSession,
    PullRequest,
    PullRequestKind,
    PullRequestStatus,
    RepoBootstrapStatus,
)
from core.queries import pi_session as pi_session_queries
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from core.utils.path_utils import (
    get_workspace_path,
    repo_name_from_uri,
    safe_join,
)

logger = logging.getLogger(__name__)


def get_repo(workspace_abs_path: str) -> git.Repo:
    """Returns a git.Repo instance for the given absolute path."""
    return git.Repo(workspace_abs_path)


def _sync_origin_url(repo: git.Repo, repo_uri: str) -> None:
    """Point the repository's ``origin`` remote at the pipeline's ``repo_uri``.

    The checkout may have been created earlier, possibly on the host before
    ``REMOTE_WORKSPACES_ROOT`` was bind-mounted into the container, so its
    stored ``origin`` URL can reference a host-specific location (for example
    ``http://localhost:3000/...``) that is unreachable from inside the
    container. ``pipeline.repo_uri`` is the source of truth, so reconcile the
    remote before any fetch/pull. An existing ``origin`` is updated in place;
    a missing one is created.
    """
    try:
        origin = repo.remotes.origin
    except (AttributeError, IndexError):
        logger.info("Adding missing origin remote %s", repo_uri)
        repo.create_remote("origin", repo_uri)
        return
    if origin.url != repo_uri:
        logger.info(
            "Updating origin URL for %s from %s to %s",
            repo.working_tree_dir,
            origin.url,
            repo_uri,
        )
        origin.set_url(repo_uri)


async def ensure_repo_cloned(pipeline: Pipeline) -> None:
    """
    Ensure the pipeline's remote repo is cloned and in sync with origin.

    For local pipelines (no repo_uri) this is a no-op. For remote pipelines it
    clones the repo into REMOTE_WORKSPACES_ROOT on first use, then fetches and
    fast-forwards to keep it in sync with origin.

    The remote's URL is reconciled with ``pipeline.repo_uri`` before fetching so
    a checkout that was created elsewhere (e.g. on the host with a
    ``localhost`` URL) still syncs from inside the container.
    """
    if not pipeline.repo_uri:
        return
    target = pipeline.workspace_abs_path
    if not target:
        return
    target = Path(target)
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        git.Repo.clone_from(pipeline.repo_uri, str(target))
        logger.info(f"Cloned remote repo {pipeline.repo_uri} to {target}")
    else:
        repo = git.Repo(str(target))
        _sync_origin_url(repo, pipeline.repo_uri)
        repo.remotes.origin.fetch()
        try:
            repo.git.pull("--ff-only")
        except git.exc.GitCommandError:
            logger.warning(
                "Fast-forward pull failed for %s; resetting to origin default branch",
                target,
            )
            default = repo.git.symbolic_ref("refs/remotes/origin/HEAD").split("/")[-1]
            repo.git.reset("--hard", f"origin/{default}")


async def ensure_repo_fetched(pipeline: Pipeline) -> int:
    """Clone the repo if missing, then fetch remote-tracking refs only.

    Unlike :func:`ensure_repo_cloned` this never pulls, fast-forwards, resets or
    otherwise mutates the checked-out branch/working tree, so it is safe to run
    while a coding session may hold uncommitted work. A fresh clone already has
    current remote-tracking refs. Returns the number of refs fetched (0 for
    local pipelines and for a clone performed here).
    """
    if not pipeline.repo_uri:
        return 0
    target = pipeline.workspace_abs_path
    if not target:
        return 0
    if ensure_repo_present(pipeline) is RepoBootstrapStatus.CLONED:
        return 0
    repo = git.Repo(str(Path(target)))
    _sync_origin_url(repo, pipeline.repo_uri)
    return len(repo.remotes.origin.fetch())


def ensure_repo_present(pipeline: Pipeline) -> Optional[RepoBootstrapStatus]:
    """Clone the pipeline's remote repo if it is not present locally.

    Unlike :func:`ensure_repo_cloned` this never fetches, pulls or resets an
    existing checkout: if the target directory already exists it is a strictly
    read-only no-op. Returns ``CLONED`` when a clone was performed,
    ``AVAILABLE`` when the checkout already existed, and ``None`` for local
    pipelines or pipelines without a resolvable workspace path.
    """
    if not pipeline.repo_uri:
        return None
    target = pipeline.workspace_abs_path
    if not target:
        return None
    target = Path(target)
    if target.is_dir():
        return RepoBootstrapStatus.AVAILABLE
    target.parent.mkdir(parents=True, exist_ok=True)
    git.Repo.clone_from(pipeline.repo_uri, str(target))
    return RepoBootstrapStatus.CLONED


def verify_remote_repo(repo_uri: str, username: str = "", token: str = "") -> None:
    """
    Verify that a remote git repo is reachable and authenticated.

    Runs ``git ls-remote --heads`` against the URI with the provided credentials
    injected (reusing ``_inject_credentials``). Raises
    ``core.exceptions.ValidationError`` with a clear message when the repository
    is unreachable, the URI is invalid, or the command exceeds the configured
    timeout (``config.GIT_LS_REMOTE_TIMEOUT``).
    """
    uri = _inject_credentials(repo_uri, username, token)
    try:
        subprocess.run(
            ["git", "ls-remote", "--heads", uri],
            capture_output=True,
            text=True,
            check=True,
            timeout=config.GIT_LS_REMOTE_TIMEOUT,
        )
    except subprocess.TimeoutExpired as e:
        raise ValidationError(
            f"Timed out verifying the repository '{repo_uri}'. "
            "Check that the host is reachable and the network is available."
        ) from e
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip()
        raise ValidationError(
            f"Could not reach the repository '{repo_uri}': {stderr or e}"
        ) from e


def _inject_credentials(uri: str, username: str, token: str) -> str:
    """
    Insert <user>:<token>@ into an HTTP/HTTPS git URL.
    Percent-encodes credentials and safely ignores/flags non-HTTP schemes.
    """
    # Check for SCP-style (git@host:path) or explicit SSH scheme
    if re.match(r"^[^@]+@[^:]+:.+$", uri) or uri.startswith("ssh://"):
        return uri

    parts = urlsplit(uri)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return uri

    # GitHub standard token user is 'x-access-token'
    safe_user = quote(username or "x-access-token", safe="")
    safe_token = quote(token, safe="")

    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"

    netloc = f"{safe_user}:{safe_token}@{host}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def _resolve_credentials(pipeline: Pipeline) -> Tuple[str, str]:
    """Resolve credentials: pipeline fields -> global env -> none."""
    username = pipeline.repo_username or config.GIT_PUSH_USERNAME or ""
    token = pipeline.repo_token or config.GIT_PUSH_TOKEN or ""
    return username, token


def push_with_auth(repo: git.Repo, pipeline: Pipeline) -> None:
    if not pipeline.repo_uri:
        return

    username, token = _resolve_credentials(pipeline)

    if token:
        # For GitHub/Gitea: basic auth header with user:token
        user = username or token  # fallback to token if no user provided
        auth_pair = f"{user}:{token}".encode("utf-8")
        auth_header = (
            f"Authorization: Basic {base64.b64encode(auth_pair).decode('ascii')}"
        )

        # Git accepts config parameters via environment variable:
        # Format is: 'key=value' with single quotes around the key=val pair
        env_config = f"'http.extraHeader={auth_header}'"

        with repo.git.custom_environment(GIT_CONFIG_PARAMETERS=env_config):
            repo.git.push("origin", "HEAD")
    else:
        repo.git.push("origin", "HEAD")


def push_branch_with_auth(repo: git.Repo, pipeline: Pipeline, branch: str) -> None:
    """Push a named branch (not HEAD) to origin using resolved credentials.

    Targets `refs/heads/{branch}:refs/heads/{branch}` so origin's default branch
    is never touched. Used by the remote Gitea-PR submission flow.
    """
    if not pipeline.repo_uri:
        return

    username, token = _resolve_credentials(pipeline)

    if token:
        user = username or token  # fallback to token if no user provided
        auth_pair = f"{user}:{token}".encode("utf-8")
        auth_header = (
            f"Authorization: Basic {base64.b64encode(auth_pair).decode('ascii')}"
        )
        env_config = f"'http.extraHeader={auth_header}'"

        with repo.git.custom_environment(GIT_CONFIG_PARAMETERS=env_config):
            repo.git.push("origin", f"refs/heads/{branch}:refs/heads/{branch}")
    else:
        repo.git.push("origin", f"refs/heads/{branch}:refs/heads/{branch}")


def ensure_feature_branch(
    repo: git.Repo, branch_name: str, start_point: Optional[str] = None
) -> None:
    """Create and check out `branch_name` from the default branch if missing.

    If the branch already exists it is checked out as-is (no-op creation). The
    new branch is created from the current HEAD so an already-applied patch on
    the default branch is carried over onto the feature branch.

    When ``start_point`` is given the branch is created at that ref instead of
    the current HEAD, and an already-existing branch is reset to it first. This
    is used to stack a chained pull request on top of its predecessor's accepted
    branch rather than on the clean default branch, and to make a retry after a
    failed apply idempotent.
    """
    try:
        exists = any(b.name == branch_name for b in repo.branches)
    except git.exc.GitCommandError:
        exists = False

    if not exists:
        logger.info(f"Creating feature branch {branch_name}")
        if start_point:
            repo.git.checkout("-b", branch_name, start_point)
        else:
            repo.git.checkout("-b", branch_name)
    else:
        logger.info(f"Feature branch {branch_name} already exists; checking it out")
        repo.git.checkout(branch_name)
        if start_point:
            # Re-point the branch at the requested start point before the patch
            # is applied so a retry does not reuse a branch created from an
            # earlier (or default) base.
            logger.info(f"Resetting feature branch {branch_name} to {start_point}")
            repo.git.reset("--hard", start_point)
            repo.git.clean("-fd")


def create_branch_at_head(repo: git.Repo, branch_name: str) -> None:
    """Create ``refs/heads/<branch_name>`` at HEAD without touching the worktree.

    Unlike :func:`ensure_feature_branch` this never checks the branch out. It is
    used by the interactive pull-request flow when the agent committed straight
    onto the default branch: the changes are pushed from a new feature branch
    while the agent's checked-out branch (and working tree) stay untouched.
    Creating an existing branch is a no-op.
    """
    if branch_name in {b.name for b in repo.branches}:
        logger.info("Branch %s already exists; leaving it as-is", branch_name)
        return
    logger.info("Creating branch %s at HEAD without checkout", branch_name)
    repo.create_head(branch_name, "HEAD")


def delete_branch_if_exists(repo: git.Repo, branch_name: str) -> bool:
    """Delete a local branch with ``git branch -D`` when it exists.

    Returns ``True`` only when a branch was actually deleted. The currently
    checked-out branch is never deleted (the repository must not be left on a
    deleted ref): a warning is logged and ``False`` is returned instead. All
    other git failures are logged and treated as "not deleted" so callers can
    keep going with the rest of the cleanup.
    """
    if not branch_name:
        return False
    try:
        active_branch = repo.active_branch.name
    except Exception:
        active_branch = None
    if active_branch == branch_name:
        logger.warning(
            "Refusing to delete branch %s because it is checked out in %s",
            branch_name,
            getattr(repo, "working_tree_dir", None),
        )
        return False
    if not _branch_exists_local(repo, branch_name):
        return False
    try:
        repo.git.branch("-D", branch_name)
        logger.info("Deleted local branch %s", branch_name)
        return True
    except git.exc.GitCommandError:
        logger.warning("Failed to delete local branch %s", branch_name, exc_info=True)
        return False


def current_default_branch(repo: git.Repo) -> str:
    """Return the name of the remote default branch.

    Derive it from `origin/HEAD` symbolic-ref, falling back to `origin/main`
    then `origin/master`.
    """
    try:
        symbolic = repo.git.symbolic_ref("refs/remotes/origin/HEAD")
        # symbolic_ref yields e.g. refs/remotes/origin/main -> "main"
        name = symbolic.rsplit("/", 1)[-1]
        if name:
            return name
    except git.exc.GitCommandError:
        pass

    for candidate in ("main", "master"):
        try:
            repo.git.rev_parse(f"origin/{candidate}")
            return candidate
        except git.exc.GitCommandError:
            continue
    return "main"


def resolve_gitea_repo(repo_uri: str) -> Tuple[str, str, str]:
    """Return (base_url, owner, repo) for a Gitea repo_uri.

    Handles `https://host/owner/repo.git`, http URLs and SCP-style
    `git@host:owner/repo` strings. Trailing `.git` is stripped.
    """
    uri = repo_uri.rstrip("/")

    if re.match(r"^[^@]+@[^:]+:.+$", uri):
        # SCP-style: git@host:owner/repo.git
        host, path = uri.rsplit(":", 1)
        host = host.rsplit("@", 1)[-1]
        base_url = f"https://{host}"
    else:
        parts = urlsplit(uri)
        scheme = parts.scheme or "https"
        host = parts.netloc or ""
        path = parts.path.lstrip("/")
        base_url = f"{scheme}://{host}"

    parts = path.split("/")
    if len(parts) < 2:
        raise ValueError(f"repo_uri '{repo_uri}' cannot be parsed into owner/repo")
    owner = parts[-2]
    repo = parts[-1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    return base_url, owner, repo


def ensure_git_identity(repo: git.Repo) -> Dict[str, str]:
    """
    Return GIT_AUTHOR_*/GIT_COMMITTER_* environment variables for any identity
    field that is missing from the repo's effective git config.

    Falls back to the configured defaults so `git commit` works in environments
    without a git user (e.g. the Docker image). An existing identity (e.g. the
    host user's global config) is respected and left untouched.
    """
    reader = repo.config_reader()
    # Use a non-None default: gitpython's get_value only returns the default
    # when the default is not None, so a missing [user] section (e.g. in CI
    # without a global git identity) would otherwise raise NoSectionError.
    name = reader.get_value("user", "name", "")
    email = reader.get_value("user", "email", "")
    env: Dict[str, str] = {}
    if not name:
        env["GIT_AUTHOR_NAME"] = config.GIT_USER_NAME
        env["GIT_COMMITTER_NAME"] = config.GIT_USER_NAME
    if not email:
        env["GIT_AUTHOR_EMAIL"] = config.GIT_USER_EMAIL
        env["GIT_COMMITTER_EMAIL"] = config.GIT_USER_EMAIL
    return env


async def get_repo_for_pipeline(
    pipeline_id: str, task_id: str | None = None, use_sandbox: bool = False
) -> git.Repo:
    """
    Fetches the pipeline and returns a git.Repo instance for its workspace.
    Raises EntityNotFoundError if pipeline or workspace path is missing.
    """
    _, repo = await get_pipeline_and_repo(pipeline_id, task_id, use_sandbox)
    return repo


async def get_pipeline_and_repo(
    pipeline_id: str, task_id: str | None = None, use_sandbox: bool = False
) -> Tuple[Pipeline, git.Repo]:
    """
    Fetches the pipeline and returns both the pipeline and a git.Repo instance.
    Raises EntityNotFoundError if pipeline or workspace path is missing.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        raise EntityNotFoundError(
            f"Workspace path not found for pipeline {pipeline_id}"
        )

    await ensure_repo_cloned(pipeline)
    workspace_path = await get_workspace_path(
        pipeline_id, task_id, use_sandbox, pipeline=pipeline
    )
    return pipeline, get_repo(str(workspace_path))


async def pull(
    pipeline_id: str,
    task_id: str | None = None,
    use_sandbox: bool = False,
) -> str:
    """Fetch and pull the latest changes from the remote origin.

    Updates the local checkout to stay in sync with the remote repository.
    Returns the output of the ``git pull`` command, or a human-readable error
    message (prefixed with "Error") when the pull fails.
    """
    try:
        _, repo = await get_pipeline_and_repo(pipeline_id, task_id, use_sandbox)
        output = repo.git.pull()
        return output or "Already up to date."
    except git.exc.GitCommandError as e:
        return f"Error executing git command: {e}"
    except Exception as e:
        return f"Error: {str(e)}"


async def drop_top_commit(
    pipeline_id: str,
    task_id: str | None = None,
    use_sandbox: bool = False,
) -> str:
    """Drop the topmost local commit if it is not on the remote.

    Applies only to remote pipelines (repo_uri configured) and removes only the
    topmost commit. Aborts if the commit already exists on the remote or if the
    repository holds a single commit (nothing to drop).

    Returns a human-readable status message (prefixed with "Error" on failure).
    """
    try:
        pipeline, repo = await get_pipeline_and_repo(pipeline_id, task_id, use_sandbox)
        if not pipeline.repo_uri:
            return (
                "Error: Cannot drop commit. Pipeline has no remote repo_uri "
                "configured; only remote pipelines support dropping commits."
            )

        repo.remotes.origin.fetch()

        default_branch = current_default_branch(repo)
        remote_ref = f"origin/{default_branch}"

        head_commit = repo.head.commit
        head_sha = head_commit.hexsha

        remote_shas = {c.hexsha for c in repo.iter_commits(remote_ref)}

        if head_sha in remote_shas:
            return (
                "Error: Cannot drop top commit. The commit already exists on the "
                f"remote origin/{default_branch}."
            )

        if not head_commit.parents:
            return (
                "Error: Cannot drop top commit. The repository has only a single "
                "commit, so there is nothing to drop."
            )

        repo.git.reset("--hard", "HEAD~1")
        return (
            f"Successfully dropped commit {head_sha}. "
            f"HEAD is now at {repo.head.commit.hexsha}."
        )
    except git.exc.GitCommandError as e:
        return f"Error executing git command: {e}"
    except Exception as e:
        return f"Error: {str(e)}"


async def get_repo_for_pipeline_by_task(task_id: str) -> git.Repo:
    """
    Fetches the task and its pipeline, then returns a git.Repo instance.
    Raises EntityNotFoundError if task, pipeline, or workspace path is missing.
    """
    task = await task_queries.get_task_by_id(task_id)
    return await get_repo_for_pipeline(task.pipeline_id)


def validate_commit_hash(repo: git.Repo, commit_hash: str) -> bool:
    """Verifies that the given commit hash exists in the repository."""
    try:
        repo.git.show(commit_hash, "--no-patch")
        return True
    except git.exc.GitCommandError:
        return False


async def get_commit_diff(pipeline_id: str, commit_hash: str) -> Dict:
    """Return the unified-diff patch and light metadata for a commit.

    Raises EntityNotFoundError when the commit does not exist in the
    pipeline's repo.
    """
    pipeline, repo = await get_pipeline_and_repo(pipeline_id)
    if not validate_commit_hash(repo, commit_hash):
        raise EntityNotFoundError(
            f"Commit {commit_hash} not found in pipeline {pipeline_id}"
        )
    commit = repo.commit(commit_hash)
    # format="" strips commit metadata so only the unified patch remains;
    # this works for root commits too (no `^` parent ref needed).
    patch = repo.git.show(commit.hexsha, format="")
    return {
        "commit_hash": commit.hexsha,
        "patch": patch,
        "subject": commit.summary,
        "message": commit.message,
        "author": commit.author.name,
        "created_at": commit.committed_datetime.isoformat(),
    }


def get_git_status_summary(repo: git.Repo) -> Dict[str, int]:
    """Returns a summary of staged, unstaged, and untracked changes."""
    status_output = repo.git.status("--porcelain")
    staged = 0
    unstaged = 0
    untracked = 0

    for line in status_output.splitlines():
        if len(line) < 3:
            continue
        x, y = line[0], line[1]
        if x == "?" and y == "?":
            untracked += 1
        else:
            if x != " ":
                staged += 1
            if y != " " and y != "?":
                unstaged += 1

    return {"staged": staged, "unstaged": unstaged, "untracked": untracked}


def get_git_status_details(repo: git.Repo) -> Dict:
    """Return a read-only repository status snapshot for the UI.

    Besides the staged/unstaged/untracked counts (see
    :func:`get_git_status_summary`), this reports whether the repository has an
    ``origin`` remote and whether the current branch is in sync with its
    remote-tracking branch. ``in_sync`` is ``True`` when there are no commits
    ahead of and none behind ``origin``, ``False`` when they diverge and
    ``None`` when sync cannot be determined (e.g. no origin, detached HEAD or
    the branch has never been pushed).

    The function only reads local refs; it never fetches, pulls or otherwise
    modifies the repository.
    """
    result: Dict = {
        "staged": 0,
        "unstaged": 0,
        "untracked": 0,
        "has_origin": False,
        "branch": None,
        "in_sync": None,
        "ahead": 0,
        "behind": 0,
    }
    result.update(get_git_status_summary(repo))

    try:
        remote_names = [remote.name for remote in repo.remotes]
    except Exception:
        remote_names = []
    if "origin" not in remote_names:
        return result
    result["has_origin"] = True

    # Detached HEAD has no branch to compare against.
    try:
        branch = repo.active_branch.name
    except Exception:
        return result
    result["branch"] = branch

    remote_ref = f"origin/{branch}"
    try:
        repo.git.rev_parse("--verify", remote_ref)
    except git.exc.GitCommandError:
        # The branch has not been pushed to origin yet; sync is unknown.
        return result

    try:
        counts = repo.git.rev_list("--left-right", "--count", f"{remote_ref}...HEAD")
        behind_str, ahead_str = counts.split()
        behind = int(behind_str)
        ahead = int(ahead_str)
    except (git.exc.GitCommandError, ValueError):
        return result

    result["behind"] = behind
    result["ahead"] = ahead
    result["in_sync"] = behind == 0 and ahead == 0
    return result


def get_git_log(repo: git.Repo, limit: int = 50, offset: int = 0) -> list:
    """Return compact commit entries for the repository's current branch.

    Each entry carries the abbreviated and full hash, author name/email, the
    commit date and the subject line. ``offset`` skips that many commits from
    the tip, enabling pagination. A repository without commits (unborn HEAD)
    yields an empty list rather than raising.
    """
    try:
        commits = list(repo.iter_commits("HEAD", max_count=limit, skip=offset))
    except Exception:
        return []

    return [
        {
            "hash": commit.hexsha,
            "short_hash": commit.hexsha[:7],
            "author": commit.author.name,
            "email": commit.author.email,
            "date": commit.committed_datetime.isoformat(),
            "subject": commit.summary,
        }
        for commit in commits
    ]


def get_head_branch_and_commit(
    workspace_path: str,
) -> Tuple[Optional[str], Optional[str]]:
    """Return the checked-out branch name and HEAD commit hash.

    Both values are best-effort: a missing repository, a detached HEAD or an
    unborn HEAD yields ``None`` for the unavailable field rather than raising.
    """
    branch: Optional[str] = None
    commit: Optional[str] = None
    try:
        repo = get_repo(workspace_path)
    except Exception:
        return branch, commit
    try:
        branch = repo.active_branch.name
    except Exception:
        pass
    try:
        commit = repo.head.commit.hexsha
    except Exception:
        pass
    return branch, commit


def get_git_log_total(repo: git.Repo) -> int:
    """Return the total number of commits reachable from HEAD.

    Uses ``git rev-list --count HEAD`` which is cheap even on large histories.
    An unborn HEAD (or any git failure) yields ``0`` rather than raising.
    """
    try:
        return int(repo.git.rev_list("--count", "HEAD"))
    except Exception:
        return 0


# Git porcelain status codes mapped to the small status vocabulary the UI
# understands. Conflicts use two-letter codes (e.g. ``UU``, ``AA``, ``DU``)
# and are handled explicitly.
_GIT_STATUS_PRIORITY = [
    "clean",
    "ignored",
    "untracked",
    "deleted",
    "added",
    "modified",
    "conflicted",
]


def _porcelain_status(x: str, y: str) -> str:
    """Map a two-letter porcelain status code to a status string."""
    if x == "?" and y == "?":
        return "untracked"
    if x == "!" and y == "!":
        return "ignored"
    if x in ("U", "A", "D") and y in ("U", "A", "D"):
        # Any mixed state involving U is a merge conflict; AA/DD are both-sided
        # adds/deletes which git also reports as conflicted.
        if "U" in (x, y) or (x == y and x in ("A", "D")):
            return "conflicted"
    if x == "A" or y == "A":
        return "added"
    if x == "D" or y == "D":
        return "deleted"
    if x == "R" or y == "R":
        return "modified"
    if x == "M" or y == "M":
        return "modified"
    return "clean"


def _normalize_status_path(path: str) -> str:
    """Normalize a porcelain path to a repo-relative POSIX string."""
    path = path.strip()
    if len(path) >= 2 and path[0] == '"' and path[-1] == '"':
        path = path[1:-1]
    return path.replace("\\", "/").strip("/")


def _collect_repo_git_status(repo: git.Repo) -> Dict[str, str]:
    """Run one ``git status --porcelain`` and return a path -> status map.

    Returns an empty map when git is unavailable or the command fails; callers
    treat an empty map as "everything clean / status unknown".
    """
    try:
        output = repo.git.status("--porcelain=v1", "--untracked-files=all", "--ignored")
    except Exception:
        logger.debug("Could not read git status", exc_info=True)
        return {}

    result: Dict[str, str] = {}
    for line in output.splitlines():
        if len(line) < 3:
            continue
        x, y = line[0], line[1]
        path = line[3:]
        if " -> " in path:
            # Renames are reported as ``old -> new``; track the new path.
            path = path.split(" -> ", 1)[1]
        result[_normalize_status_path(path)] = _porcelain_status(x, y)
    return result


def _aggregate_status(statuses: list[str]) -> str:
    """Return the most significant status from a list (dirty subtrees)."""
    best = "clean"
    best_rank = 0
    for status in statuses:
        rank = (
            _GIT_STATUS_PRIORITY.index(status) if status in _GIT_STATUS_PRIORITY else 0
        )
        if rank > best_rank:
            best = status
            best_rank = rank
    return best


def get_paths_git_status(repo: git.Repo, rel_paths: list[str]) -> Dict[str, str]:
    """Map repo-relative paths to a git status using one git invocation.

    Values are ``clean|modified|added|deleted|untracked|ignored|conflicted``.
    Directories are reported as the aggregated status of their descendants so
    the UI can mark dirty subtrees. Unknown paths default to ``clean``.
    """
    exact = _collect_repo_git_status(repo)

    result: Dict[str, str] = {}
    for raw_path in rel_paths:
        path = _normalize_status_path(raw_path)
        if path in exact:
            result[raw_path] = exact[path]
            continue

        if path == "":
            descendants = list(exact.values())
        else:
            prefix = path + "/"
            descendants = [
                status for key, status in exact.items() if key.startswith(prefix)
            ]
        result[raw_path] = _aggregate_status(descendants) if descendants else "clean"
    return result


def get_file_git_status(repo: git.Repo, rel_path: str) -> str:
    """Return the git status for a single repo-relative path."""
    return get_paths_git_status(repo, [rel_path]).get(rel_path, "clean")


async def get_pipeline_repo_readonly(pipeline_id: str) -> Tuple[Pipeline, git.Repo]:
    """Resolve a pipeline's repository for read-only inspection.

    Unlike :func:`get_pipeline_and_repo` this never clones, fetches, pulls or
    resets the repository, so it is safe to call from read-only endpoints. It
    does not require the repository to be cloned at all. Raises
    ``EntityNotFoundError`` when the pipeline or its repository is missing.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        raise EntityNotFoundError(
            f"Workspace path not found for pipeline {pipeline_id}"
        )
    try:
        repo = get_repo(str(pipeline.workspace_abs_path))
    except (git.exc.InvalidGitRepositoryError, git.exc.NoSuchPathError) as e:
        raise EntityNotFoundError(
            f"Git repository not found for pipeline {pipeline_id}"
        ) from e
    return pipeline, repo


async def get_pipeline_git_status(pipeline_id: str) -> Dict:
    """Read-only git status (including origin sync) for a pipeline repo."""
    _, repo = await get_pipeline_repo_readonly(pipeline_id)
    return get_git_status_details(repo)


async def get_pipeline_git_log(
    pipeline_id: str, limit: int = 50, offset: int = 0
) -> list:
    """Read-only git log for a pipeline repo."""
    _, repo = await get_pipeline_repo_readonly(pipeline_id)
    return get_git_log(repo, limit, offset)


async def get_pipeline_git_log_total(pipeline_id: str) -> int:
    """Read-only total commit count for a pipeline repo."""
    _, repo = await get_pipeline_repo_readonly(pipeline_id)
    return get_git_log_total(repo)


# ---------------------------------------------------------------------------
# Pull-request dev-server workspace resolution
# ---------------------------------------------------------------------------


def _pr_worktree_path(pipeline: Pipeline, pr: PullRequest) -> Path:
    """Return the stable, per-PR worktree path on ``R``'s filesystem.

    Worktrees share ``R``'s object store, so they must live on the same
    filesystem. Remote pipelines are cloned under ``REMOTE_WORKSPACES_ROOT`` and
    local pipelines under ``WORKSPACES_ROOT``; both roots are used here so the
    resulting ``<repo>.dev/<task_id>`` directory is always a sibling of ``R``.
    """
    task_id = str(pr.task_id)
    if pipeline.repo_uri:
        repo_name = repo_name_from_uri(pipeline.repo_uri) or pipeline.name
        return safe_join(config.REMOTE_WORKSPACES_ROOT, f"{repo_name}.dev", task_id)
    workspace = pipeline.workspace_path or pipeline.name
    return safe_join(config.WORKSPACES_ROOT, f"{workspace}.dev", task_id)


def _retained_sandbox_path(pr: PullRequest) -> Optional[Path]:
    """Return the retained batch workspace for ``pr``'s session, if any."""
    if not pr.pi_session_uid:
        return None
    return safe_join(config.PI_SESSIONS_ROOT, pr.pi_session_uid, "workspace")


def _workspace_head_is_branch(workspace_path: Path, branch_name: str) -> bool:
    """Whether ``workspace_path`` is a repo whose HEAD is on ``branch_name``."""
    try:
        repo = git.Repo(str(workspace_path))
        return repo.active_branch.name == branch_name
    except Exception:
        return False


def _branch_exists_local(repo: git.Repo, branch_name: str) -> bool:
    """Whether ``branch_name`` exists as a local branch in ``repo``."""
    try:
        repo.git.rev_parse("--verify", f"refs/heads/{branch_name}")
        return True
    except git.exc.GitCommandError:
        return False


def _branch_exists_remote(repo: git.Repo, branch_name: str) -> bool:
    """Whether ``branch_name`` exists as a remote-tracking branch in ``repo``."""
    try:
        repo.git.rev_parse("--verify", f"refs/remotes/origin/{branch_name}")
        return True
    except git.exc.GitCommandError:
        return False


def _remove_worktree(repo: git.Repo, wt_path: Path) -> None:
    """Remove a worktree (and its directory) if it already exists.

    Re-materialisation reuses the same stable per-PR path, so a previous
    worktree must be torn down before a fresh one is created.
    """
    if not wt_path.exists():
        return
    try:
        repo.git.worktree("remove", "--force", str(wt_path))
    except git.exc.GitCommandError:
        # The directory may exist without being registered (e.g. after a manual
        # deletion of the worktree metadata); prune and remove the directory.
        try:
            repo.git.worktree("prune")
        except git.exc.GitCommandError:
            pass
        shutil.rmtree(wt_path, ignore_errors=True)


def _apply_patch_to_worktree(worktree_path: str, patch: Optional[str]) -> None:
    """Apply a PR patch (``git apply --3way``) inside an existing worktree."""
    if not patch or not patch.strip():
        return
    patch_content = patch if patch.endswith("\n") else patch + "\n"
    with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False) as f:
        f.write(patch_content)
        patch_path = f.name
    try:
        repo = get_repo(worktree_path)
        repo.git.apply("--3way", patch_path)
    finally:
        if os.path.exists(patch_path):
            os.remove(patch_path)


async def _find_chained_predecessor_pr(pr: PullRequest) -> Optional[PullRequest]:
    """Return the predecessor PR a chained PR is stacked on top of.

    Ordered branch chaining stores the predecessor session on
    ``PiSession.chained_from_session_uid`` and each session references the pull
    request(s) it produced. Returns ``None`` when ``pr`` is not chained or the
    predecessor cannot be resolved.
    """
    if not pr.pi_session_uid:
        return None
    try:
        session = await PiSession.find_one(PiSession.uid == pr.pi_session_uid)
    except Exception:
        return None
    if session is None or not session.chained_from_session_uid:
        return None
    try:
        predecessor = await PiSession.find_one(
            PiSession.uid == session.chained_from_session_uid
        )
    except Exception:
        return None
    if predecessor is None:
        return None
    for pr_id in predecessor.pull_request_ids or []:
        if not pr_id:
            continue
        try:
            candidate = await PullRequest.get(pr_id)
        except Exception:
            candidate = None
        if candidate is not None:
            return candidate
    return None


async def _collect_patch_chain(pr: PullRequest) -> List[PullRequest]:
    """Return the chain of PRs from oldest to ``pr`` (inclusive).

    When a chained PR has to be re-materialised from its patch, every
    predecessor patch must be applied first because each patch is a delta
    relative to its predecessor's tip. Documentation PRs are not part of the
    implementation chain, so their patch is replayed on its own.
    """
    if getattr(pr, "kind", None) == PullRequestKind.DOCUMENTATION:
        return [pr]
    chain: List[PullRequest] = []
    current: Optional[PullRequest] = pr
    seen = set()
    while current is not None and current.id not in seen:
        seen.add(current.id)
        chain.append(current)
        current = await _find_chained_predecessor_pr(current)
    chain.reverse()
    return chain


async def _resolve_chained_start_point_for_repo(
    repo: git.Repo, pr: PullRequest
) -> Optional[str]:
    """Return the local branch a chained PR's patch fallback must start from."""
    if getattr(pr, "kind", None) == PullRequestKind.DOCUMENTATION:
        return None
    try:
        branch = await pi_session_queries.find_chained_predecessor_branch(
            pr.pi_session_uid
        )
    except Exception:
        return None
    if not branch:
        return None
    if _branch_exists_local(repo, branch):
        return branch
    return None


def _default_branch_for_repo(repo: git.Repo, pipeline: Pipeline) -> str:
    """Return the branch to base a patch fallback worktree on.

    Remote clones have a well-known default branch; local pipelines use the
    currently checked-out branch of ``R`` (there is no origin to consult).
    """
    if pipeline.repo_uri:
        return current_default_branch(repo)
    try:
        return repo.active_branch.name
    except Exception:
        return current_default_branch(repo)


async def cleanup_completed_pull_request(
    pipeline: Pipeline, pr: PullRequest
) -> Dict[str, object]:
    """Release the artefacts of a terminal (accepted/rejected) pull request.

    The helper is idempotent and best-effort: every step is logged
    independently and failures are recorded in the returned ``errors`` list
    rather than raised.

    A PR whose session still has a pending chained descendant keeps its *local*
    feature branch and ``patch`` because they are the start point / patch
    fallback for that descendant. Its remote Gitea branch is deleted
    immediately. Deferral is recomputed from the database on every call; no
    ``deferred`` flag is persisted on the document.

    The retained CoderBot sandbox (``PI_SESSIONS_ROOT/<uid>/workspace``) is
    deliberately untouched; it is released by the Pi-session TTL sweep or
    ``discard_session``.
    """
    result: Dict[str, object] = {
        "local_branch_deleted": False,
        "remote_branch_deleted": False,
        "patch_cleared": False,
        "deferred": False,
        "errors": [],
    }
    errors: List[str] = result["errors"]  # type: ignore[assignment]

    # A dev-server worktree may hold the feature branch and block its deletion.
    try:
        await remove_pr_worktree(pipeline, pr)
    except Exception as e:
        logger.warning("Failed to remove dev-server worktree for PR %s: %s", pr.id, e)
        errors.append(f"worktree: {e}")

    deferred = False
    pipeline_id = getattr(pipeline, "id", None)
    # Documentation PRs are orthogonal to the implementation chain: they may
    # share a task with a chained implementation PR, but their unique branch is
    # never a start point for a descendant, so they must not defer cleanup.
    if (
        getattr(pr, "kind", None) != PullRequestKind.DOCUMENTATION
        and pr.pi_session_uid
        and pipeline_id is not None
    ):
        try:
            deferred = await pi_session_queries.has_pending_chained_descendant(
                pr.pi_session_uid, pipeline_id=str(pipeline_id)
            )
        except Exception as e:
            logger.warning(
                "Failed to check chained descendants for PR %s: %s", pr.id, e
            )
            errors.append(f"defer: {e}")
    result["deferred"] = deferred

    repo = None
    local_branch_exists = False
    branch_name = getattr(pr, "branch_name", None)
    if pipeline.workspace_abs_path and branch_name:
        try:
            repo = get_repo(str(pipeline.workspace_abs_path))
            local_branch_exists = _branch_exists_local(repo, branch_name)
            if not deferred:
                result["local_branch_deleted"] = delete_branch_if_exists(
                    repo, branch_name
                )
        except Exception as e:
            logger.warning(
                "Failed to delete local branch %s for PR %s: %s",
                branch_name,
                pr.id,
                e,
            )
            errors.append(f"local branch: {e}")

    # The remote branch is independent of chained descendants: a descendant's
    # head already contains the predecessor commits, so it can be deleted now.
    remote_candidate = bool(
        pipeline.repo_uri
        and branch_name
        and (pr.remote_pr_url or pr.base_branch)
        and config.GITEA_DELETE_BRANCH_ON_COMPLETE
    )
    # Skip a redundant Gitea call when a previous cleanup already released
    # everything (no local branch and no patch left). Deferred PRs always keep
    # trying so each completion can clean its own remote branch. The sweep sets
    # ``_completion_cleanup_remote_done`` because the remote branch is already
    # deleted at the PR's own completion, even when local/patch were deferred.
    already_clean = not deferred and pr.patch is None and not local_branch_exists
    remote_already_done = bool(getattr(pr, "_completion_cleanup_remote_done", False))
    if remote_candidate and not already_clean and not remote_already_done:
        try:
            base_url, owner, repo_name = resolve_gitea_repo(pipeline.repo_uri)
            token = pipeline.repo_token or config.GIT_PUSH_TOKEN
            client = GiteaClient(base_url, token)
            try:
                await client.delete_branch(
                    owner, repo_name, branch_name, missing_ok=True
                )
            finally:
                await client.aclose()
            result["remote_branch_deleted"] = True
            logger.info("Deleted remote Gitea branch %s for PR %s", branch_name, pr.id)
            # Drop the now-stale remote-tracking ref too, otherwise a later
            # ``resolve_pr_workspace`` could re-materialise the deleted branch
            # from ``origin/<branch>``.
            if repo is not None:
                try:
                    repo.git.update_ref("-d", f"refs/remotes/origin/{branch_name}")
                except git.exc.GitCommandError:
                    logger.debug("No remote-tracking ref to drop for %s", branch_name)
        except Exception as e:
            logger.warning(
                "Failed to delete remote Gitea branch %s for PR %s: %s",
                branch_name,
                pr.id,
                e,
            )
            errors.append(f"remote branch: {e}")

    if not deferred and pr.patch is not None:
        try:
            pr.patch = None
            await pr.save()
            result["patch_cleared"] = True
        except Exception as e:
            logger.warning("Failed to clear patch for PR %s: %s", pr.id, e)
            errors.append(f"patch: {e}")

    return result


async def sweep_completed_pull_requests(pipeline: Pipeline) -> int:
    """Run completion cleanup for terminal PRs that still hold artefacts.

    This is the safety net that releases a completed chain prefix whose
    descendants have since completed. It returns the number of PRs whose
    cleanup is now complete (i.e. not deferred). The sweep stays cheap when
    ``GITEA_DELETE_BRANCH_ON_COMPLETE`` is off because cleanup then makes no
    remote API call.
    """
    pipeline_id = getattr(pipeline, "id", None)
    if pipeline_id is None:
        return 0

    try:
        prs = await PullRequest.find(
            PullRequest.pipeline_id == str(pipeline_id),
            In(
                PullRequest.status,
                [PullRequestStatus.ACCEPTED, PullRequestStatus.REJECTED],
            ),
        ).to_list()
    except Exception:
        logger.warning(
            "Failed to query completed pull requests for pipeline %s",
            pipeline_id,
            exc_info=True,
        )
        return 0

    repo = None
    if pipeline.workspace_abs_path:
        try:
            repo = get_repo(str(pipeline.workspace_abs_path))
        except Exception:
            logger.debug(
                "Could not open pipeline %s workspace for cleanup sweep",
                pipeline_id,
                exc_info=True,
            )

    released = 0
    for pr in prs:
        branch_exists = bool(
            repo is not None
            and pr.branch_name
            and _branch_exists_local(repo, pr.branch_name)
        )
        if pr.patch is None and not branch_exists:
            continue
        # The remote Gitea branch was already deleted when this PR completed;
        # the sweep only releases the deferred local branch and patch.
        pr._completion_cleanup_remote_done = True
        try:
            result = await cleanup_completed_pull_request(pipeline, pr)
        except Exception:
            logger.warning(
                "Cleanup failed for completed PR %s in pipeline %s",
                pr.id,
                pipeline_id,
                exc_info=True,
            )
            continue
        if not result.get("deferred"):
            released += 1
    return released


async def resolve_pr_workspace(pipeline: Pipeline, pr: PullRequest) -> Tuple[str, str]:
    """Resolve where a pull request's code lives so a dev server can run there.

    Returns ``(workspace_path, target_label)``. The resolution is layered,
    cheapest/most-convenient first:

    1. A retained CoderBot sandbox whose HEAD is on the PR's branch.
    2. An existing feature branch in ``R``/``origin``, checked out into a
       linked git worktree.
    3. A worktree at the correct base branch with the PR patch (and, for a
       chained PR, every predecessor patch) applied via ``git apply --3way``.

    ``R``'s default branch is never checked out directly: worktrees and the
    retained sandbox keep the accept/reject flow's clean-workspace invariant.
    """
    sandbox = _retained_sandbox_path(pr)
    if sandbox is not None and _workspace_head_is_branch(sandbox, pr.branch_name):
        return str(sandbox), pr.branch_name

    if not pipeline.workspace_abs_path:
        raise EntityNotFoundError(
            f"Workspace path not found for pipeline {pipeline.id}"
        )

    await ensure_repo_cloned(pipeline)
    repo = get_repo(str(pipeline.workspace_abs_path))
    wt = _pr_worktree_path(pipeline, pr)

    if (
        getattr(pr, "status", None)
        in (PullRequestStatus.ACCEPTED, PullRequestStatus.REJECTED)
        and pr.patch is None
        and not _branch_exists_local(repo, pr.branch_name)
        and not _branch_exists_remote(repo, pr.branch_name)
    ):
        raise EntityNotFoundError(
            f"pull request {pr.id} is completed and its branch/patch have been "
            "cleaned up"
        )

    if _branch_exists_local(repo, pr.branch_name):
        _remove_worktree(repo, wt)
        repo.git.worktree("add", str(wt), pr.branch_name)
        return str(wt), pr.branch_name

    if _branch_exists_remote(repo, pr.branch_name):
        _remove_worktree(repo, wt)
        repo.git.worktree(
            "add", "-b", pr.branch_name, str(wt), f"origin/{pr.branch_name}"
        )
        return str(wt), pr.branch_name

    # Patch fallback: materialise the chain (oldest first) on top of the
    # resolved base. A detached worktree avoids checking out ``R``'s already
    # checked-out default branch.
    chain = await _collect_patch_chain(pr)
    first = chain[0]
    base = await _resolve_chained_start_point_for_repo(repo, first)
    if base is None:
        base = _default_branch_for_repo(repo, pipeline)

    _remove_worktree(repo, wt)
    repo.git.worktree("add", "--detach", str(wt), base)
    for item in chain:
        _apply_patch_to_worktree(str(wt), item.patch)
    return str(wt), pr.branch_name


async def remove_pr_worktree(pipeline: Pipeline, pr: PullRequest) -> None:
    """Remove the dev-server worktree created for a pull request, if any.

    Called when a PR leaves the reviewable state (accepted/rejected) so worktrees
    do not accumulate. The retained CoderBot sandbox is left untouched (it is
    swept separately by the Pi-session workspace sweeper).
    """
    if not pipeline.workspace_abs_path:
        return
    try:
        repo = get_repo(str(pipeline.workspace_abs_path))
    except Exception:
        return
    _remove_worktree(repo, _pr_worktree_path(pipeline, pr))
