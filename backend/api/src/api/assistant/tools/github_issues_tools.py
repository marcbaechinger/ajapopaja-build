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

"""
Assistant tools for reading and writing GitHub/Gitea issues and pull requests.

These tools operate against the git hosting service that backs a Pipeline's
`repo_uri`. Read operations (listing and reading issues/PRs) are always allowed;
write operations (commenting, closing, creating) are registered as write access
and therefore require explicit user confirmation before an agent may call them.
"""

from typing import List, Optional

from api.assistant.decorators import register_tool
from api.git_hosting.gitea import GiteaApiError, GiteaClient
from core import config
from core.models.models import User
from core.queries import pipeline as pipeline_queries
from core.utils import git_utils

# Tool Categories
READ_ONLY = "read_only"
WRITE_ACCESS = "write_access"

# Gitea/GitHub return both the pull request metadata on the issue-style fields.
# These are the fields we surface in human-readable output.
_ISSUE_FIELDS = ("number", "title", "state", "user", "created_at", "body")
_PULL_FIELDS = (
    "number",
    "title",
    "state",
    "user",
    "created_at",
    "base",
    "head",
    "body",
)


async def _get_client_and_repo(
    pipeline_id: str,
) -> tuple[GiteaClient, str, str, str, object]:
    """Resolve the git-hosting client and repo coordinates for a pipeline.

    Returns (client, base_url, owner, repo, pipeline). Raises ValueError with a
    user-friendly message when the pipeline has no remote repository configured.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline:
        raise ValueError(f"Pipeline with ID '{pipeline_id}' not found.")
    if not pipeline.repo_uri:
        raise ValueError(
            f"Pipeline '{pipeline_id}' has no remote repository (repo_uri) configured, "
            "so issues and pull requests cannot be accessed."
        )
    base_url, owner, repo = git_utils.resolve_gitea_repo(pipeline.repo_uri)
    token = pipeline.repo_token or config.GIT_PUSH_TOKEN
    if not token:
        raise ValueError(
            f"Pipeline '{pipeline_id}' has no repository token configured. "
            "Issues and pull requests cannot be accessed without authentication."
        )
    return GiteaClient(base_url, token), base_url, owner, repo, pipeline


def _fmt_issue(item: dict) -> str:
    user = (item.get("user") or {}).get("login") or "unknown"
    return (
        f"#{item.get('number')} [{item.get('state')}] {item.get('title')}\n"
        f"    author: {user} | created: {item.get('created_at')}\n"
        f"    body: {(item.get('body') or '').strip()}\n"
    )


def _fmt_pull(item: dict) -> str:
    user = (item.get("user") or {}).get("login") or "unknown"
    head = (item.get("head") or {}).get("ref") or "?"
    base = (item.get("base") or {}).get("ref") or "?"
    return (
        f"#{item.get('number')} [{item.get('state')}] {item.get('title')}\n"
        f"    author: {user} | {base} <- {head} | created: {item.get('created_at')}\n"
        f"    body: {(item.get('body') or '').strip()}\n"
    )


async def _with_client(client: GiteaClient, operation) -> str:
    try:
        return await operation
    except GiteaApiError as e:
        return f"Error: {e} (status {e.status_code})"
    except Exception as e:
        return f"Error: {str(e)}"
    finally:
        await client.aclose()


def _render_issue_detail(issue: dict, comments: list) -> str:
    lines = [_fmt_issue(issue)]
    if comments:
        lines.append("  comments:")
        for c in comments:
            author = (c.get("user") or {}).get("login") or "unknown"
            body = (c.get("body") or "").strip()
            lines.append(f"    - [{author}]: {body}")
    else:
        lines.append("  comments: (none)")
    return "\n".join(lines)


@register_tool(tool_type=READ_ONLY)
async def list_issues(
    pipeline_id: str,
    state: str = "open",
    assignee: Optional[str] = None,
    labels: Optional[str] = None,
    limit: int = 20,
) -> str:
    """
    Lists issues belonging to the Pipeline's remote repository.

    Args:
        pipeline_id: The ID of the pipeline whose repository should be queried.
        state: Which issues to return: 'open', 'closed', or 'all' (default: 'open').
        assignee: Only return issues assigned to this username (optional).
        labels: Only return issues carrying these comma-separated labels (optional).
        limit: Maximum number of issues to return (default: 20, max: 100).
    """
    try:
        client, _, owner, repo, _ = await _get_client_and_repo(pipeline_id)
    except ValueError as e:
        return f"Error: {e}"

    limit = max(1, min(limit, 100))

    async def op() -> str:
        issues = await client.list_issues(
            owner,
            repo,
            state=state,
            type="issues",
            assignee=assignee,
            labels=labels,
            per_page=limit,
        )
        if not issues:
            return f"No issues found (state={state})."
        return "\n".join(_fmt_issue(i) for i in issues)

    return await _with_client(client, op())


@register_tool(tool_type=READ_ONLY)
async def read_issue(pipeline_id: str, issue_number: int) -> str:
    """
    Reads a single issue (and its comments) from the Pipeline's remote repository.

    Args:
        pipeline_id: The ID of the pipeline whose repository should be queried.
        issue_number: The number of the issue to read.
    """
    try:
        client, _, owner, repo, _ = await _get_client_and_repo(pipeline_id)
    except ValueError as e:
        return f"Error: {e}"

    async def op() -> str:
        issue = await client.get_issue(owner, repo, issue_number)
        comments = await client.list_issue_comments(owner, repo, issue_number)
        return _render_issue_detail(issue, comments)

    return await _with_client(client, op())


@register_tool(tool_type=READ_ONLY)
async def list_pull_requests(
    pipeline_id: str,
    state: str = "open",
    limit: int = 20,
) -> str:
    """
    Lists pull requests belonging to the Pipeline's remote repository.

    Args:
        pipeline_id: The ID of the pipeline whose repository should be queried.
        state: Which pull requests to return: 'open', 'closed', or 'all' (default: 'open').
        limit: Maximum number of pull requests to return (default: 20, max: 100).
    """
    try:
        client, _, owner, repo, _ = await _get_client_and_repo(pipeline_id)
    except ValueError as e:
        return f"Error: {e}"

    limit = max(1, min(limit, 100))

    async def op() -> str:
        prs = await client.list_pull_requests(owner, repo, state=state, per_page=limit)
        if not prs:
            return f"No pull requests found (state={state})."
        return "\n".join(_fmt_pull(p) for p in prs)

    return await _with_client(client, op())


@register_tool(tool_type=READ_ONLY)
async def read_pull_request(pipeline_id: str, pr_number: int) -> str:
    """
    Reads a single pull request (and its comments) from the Pipeline's remote repository.

    Args:
        pipeline_id: The ID of the pipeline whose repository should be queried.
        pr_number: The number of the pull request to read.
    """
    try:
        client, _, owner, repo, _ = await _get_client_and_repo(pipeline_id)
    except ValueError as e:
        return f"Error: {e}"

    async def op() -> str:
        pr = await client.get_pull_request(owner, repo, pr_number)
        comments = await client.list_issue_comments(owner, repo, pr_number)
        return _render_issue_detail(pr, comments)

    return await _with_client(client, op())


@register_tool(tool_type=WRITE_ACCESS)
async def comment_on_issue(pipeline_id: str, issue_number: int, body: str) -> str:
    """
    Adds a comment to an issue or pull request in the Pipeline's remote repository.

    Args:
        pipeline_id: The ID of the pipeline whose repository contains the issue.
        issue_number: The number of the issue or pull request to comment on.
        body: The markdown/plain text content of the comment.
    """
    try:
        client, _, owner, repo, _ = await _get_client_and_repo(pipeline_id)
    except ValueError as e:
        return f"Error: {e}"

    async def op() -> str:
        created = await client.create_issue_comment(owner, repo, issue_number, body)
        return (
            f"Added comment to #{issue_number} at {created.get('html_url', 'issue')}."
        )

    return await _with_client(client, op())


@register_tool(tool_type=WRITE_ACCESS)
async def close_issue(pipeline_id: str, issue_number: int) -> str:
    """
    Closes an issue or pull request in the Pipeline's remote repository.

    Args:
        pipeline_id: The ID of the pipeline whose repository contains the issue.
        issue_number: The number of the issue or pull request to close.
    """
    try:
        client, _, owner, repo, _ = await _get_client_and_repo(pipeline_id)
    except ValueError as e:
        return f"Error: {e}"

    async def op() -> str:
        result = await client.close_issue(owner, repo, issue_number)
        return f"Closed #{issue_number} ('{result.get('title')}')."

    return await _with_client(client, op())


@register_tool(tool_type=WRITE_ACCESS)
async def create_issue(
    pipeline_id: str,
    title: str,
    body: Optional[str] = None,
    assignee: Optional[str] = None,
) -> str:
    """
    Creates a new issue in the Pipeline's remote repository.

    Args:
        pipeline_id: The ID of the pipeline whose repository should receive the issue.
        title: The title of the new issue.
        body: Optional body/description of the issue.
        assignee: Optional username to whom the issue should be assigned. Use list_known_users to see valid usernames.
    """
    try:
        client, _, owner, repo, _ = await _get_client_and_repo(pipeline_id)
    except ValueError as e:
        return f"Error: {e}"

    assignees = [assignee] if assignee else None

    async def op() -> str:
        created = await client.create_issue(
            owner, repo, title=title, body=body or "", assignees=assignees
        )
        number = created.get("number")
        assignee_note = f", assigned to {assignee}" if assignee else ""
        return f"Created issue #{number}: {created.get('title')}{assignee_note}."

    return await _with_client(client, op())


@register_tool(tool_type=READ_ONLY)
async def list_known_users() -> List[str]:
    """
    Returns a list of known users (usernames). These are the users that can be
    assigned to issues created through the create_issue tool.
    """
    users = await User.find_all().to_list()
    return sorted(u.username for u in users)
