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
import re
import subprocess
from pathlib import Path
from typing import Dict, Tuple
from urllib.parse import quote, urlsplit, urlunsplit

import git

from core import config
from core.exceptions import EntityNotFoundError, ValidationError
from core.models.models import Pipeline
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from core.utils.path_utils import get_workspace_path

logger = logging.getLogger(__name__)


def get_repo(workspace_abs_path: str) -> git.Repo:
    """Returns a git.Repo instance for the given absolute path."""
    return git.Repo(workspace_abs_path)


async def ensure_repo_cloned(pipeline: Pipeline) -> None:
    """
    Ensure the pipeline's remote repo is cloned and in sync with origin.

    For local pipelines (no repo_uri) this is a no-op. For remote pipelines it
    clones the repo into REMOTE_WORKSPACES_ROOT on first use, then fetches and
    fast-forwards to keep it in sync with origin.
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


def ensure_feature_branch(repo: git.Repo, branch_name: str) -> None:
    """Create and check out `branch_name` from the default branch if missing.

    If the branch already exists it is checked out as-is (no-op creation). The
    new branch is created from the current HEAD so an already-applied patch on
    the default branch is carried over onto the feature branch.
    """
    try:
        exists = any(b.name == branch_name for b in repo.branches)
    except git.exc.GitCommandError:
        exists = False

    if not exists:
        logger.info(f"Creating feature branch {branch_name}")
        repo.git.checkout("-b", branch_name)
    else:
        logger.info(f"Feature branch {branch_name} already exists; checking it out")
        repo.git.checkout(branch_name)


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
    name = reader.get_value("user", "name", None)
    email = reader.get_value("user", "email", None)
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


def get_git_log(repo: git.Repo, limit: int = 50) -> list:
    """Return compact commit entries for the repository's current branch.

    Each entry carries the abbreviated and full hash, author name/email, the
    commit date and the subject line. A repository without commits (unborn
    HEAD) yields an empty list rather than raising.
    """
    try:
        commits = list(repo.iter_commits("HEAD", max_count=limit))
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


async def get_pipeline_git_log(pipeline_id: str, limit: int = 50) -> list:
    """Read-only git log for a pipeline repo."""
    _, repo = await get_pipeline_repo_readonly(pipeline_id)
    return get_git_log(repo, limit)
