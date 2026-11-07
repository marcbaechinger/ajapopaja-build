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

"""Normalisation of Gitea webhook payloads into a canonical PR-state event.

A single receiver endpoint handles three shapes:

* Gitea's native ``push`` payload (a merge/rebase/squash is delivered as a push
  to the base branch),
* Gitea's native ``pull_request`` payload (action ``closed`` distinguishes a
  merge from a reject), and
* a minimal normalised body used by a Gitea Actions ``curl`` step or tests.

All three collapse into :class:`PrStateEvent`, which the reconciliation notifier
then acts on.
"""

from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional

_ZERO_SHA = "0" * 40


def pr_index_from_url(remote_pr_url: str | None) -> int | None:
    """Extract the Gitea pull-request number from its web URL.

    ``remote_pr_url`` is ``{base}/{owner}/{repo}/pulls/{number}``; the trailing
    path segment is the PR index. Returns ``None`` when it cannot be parsed.
    """
    if not remote_pr_url:
        return None
    try:
        return int(remote_pr_url.rstrip("/").rsplit("/", 1)[-1])
    except (ValueError, IndexError):
        return None


def _as_int(value: Any) -> Optional[int]:
    """Best-effort integer coercion for optional webhook identity fields."""
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@dataclass
class PrStateEvent:
    """A remote PR/branch state change that must be mirrored onto local state.

    ``state`` is ``"merged"`` when work landed on the base branch and ``"closed"``
    when a pull request was closed without merging (a remote reject).
    """

    repo_full_name: str
    branch: str
    state: Literal["merged", "closed"]
    commit_hash: Optional[str] = None
    base_branch: Optional[str] = None
    pr_number: Optional[int] = None
    remote_pr_url: Optional[str] = None


def parse_gitea_push_payload(payload: Dict[str, Any]) -> Optional[PrStateEvent]:
    """Parse a Gitea ``push`` webhook payload.

    A branch delete (``after`` is all zeros) and non-push payloads are not
    actionable and return ``None``.
    """
    if not isinstance(payload, dict):
        return None
    ref = payload.get("ref")
    after = payload.get("after")
    if not ref or not after or not str(ref).startswith("refs/heads/"):
        return None
    if str(after) == _ZERO_SHA or str(after).strip("0") == "":
        # Branch deletion: no commit to mirror.
        return None
    repo = payload.get("repository") or {}
    repo_full_name = repo.get("full_name", "") if isinstance(repo, dict) else ""
    branch = str(ref)[len("refs/heads/") :]
    return PrStateEvent(
        repo_full_name=repo_full_name,
        branch=branch,
        state="merged",
        commit_hash=str(after),
        base_branch=branch,
    )


def parse_gitea_pr_payload(payload: Dict[str, Any]) -> Optional[PrStateEvent]:
    """Parse a Gitea ``pull_request`` webhook payload.

    Only action ``closed`` is actionable: a merged PR maps to ``"merged"`` and a
    closed-without-merge PR maps to ``"closed"`` (remote reject). Other actions
    (``opened``, ``reopened``, …) have no state to mirror and return ``None``.
    """
    if not isinstance(payload, dict):
        return None
    if payload.get("action") != "closed":
        return None
    pull_request = payload.get("pull_request")
    if not isinstance(pull_request, dict):
        return None

    pr_number = _as_int(pull_request.get("number"))
    remote_pr_url = pull_request.get("html_url")

    repo = payload.get("repository") or {}
    repo_full_name = repo.get("full_name", "") if isinstance(repo, dict) else ""

    base = pull_request.get("base") or {}
    base_branch = base.get("ref") if isinstance(base, dict) else None

    merged = bool(pull_request.get("merged"))
    if merged:
        commit_hash = pull_request.get("merge_commit_sha") or (
            (pull_request.get("head") or {}).get("sha")
        )
        return PrStateEvent(
            repo_full_name=repo_full_name,
            branch=base_branch or "",
            state="merged",
            commit_hash=commit_hash,
            base_branch=base_branch,
            pr_number=pr_number,
            remote_pr_url=remote_pr_url,
        )

    # Closed without merge: a remote reject. There is no new commit to verify.
    head = pull_request.get("head") or {}
    head_ref = head.get("ref") if isinstance(head, dict) else None
    branch = head_ref or base_branch or ""
    return PrStateEvent(
        repo_full_name=repo_full_name,
        branch=branch,
        state="closed",
        commit_hash=None,
        base_branch=base_branch,
        pr_number=pr_number,
        remote_pr_url=remote_pr_url,
    )


def parse_normalized_payload(payload: Dict[str, Any]) -> Optional[PrStateEvent]:
    """Parse a minimal normalised body.

    Expected shape::

        {
            "repo": "owner/name",
            "branch": "main",
            "commit_hash": "<sha>",   # optional for "closed"
            "state": "merged" | "closed",
        }
    """
    if not isinstance(payload, dict):
        return None
    state = payload.get("state")
    if state not in ("merged", "closed"):
        return None
    branch = payload.get("branch") or payload.get("base_branch") or ""
    return PrStateEvent(
        repo_full_name=payload.get("repo") or payload.get("repo_full_name") or "",
        branch=branch,
        state=state,
        commit_hash=payload.get("commit_hash"),
        base_branch=payload.get("base_branch") or branch or None,
        pr_number=_as_int(payload.get("pr_number")),
        remote_pr_url=payload.get("remote_pr_url"),
    )


def parse_pr_state_payload(payload: Dict[str, Any]) -> Optional[PrStateEvent]:
    """Parse any supported payload shape into a :class:`PrStateEvent`.

    Dispatch is based on the presence of Gitea-specific keys: a ``pull_request``
    key means a PR event, a ``ref``/``after`` pair means a push event, and a
    ``state`` key (without either) means the minimal normalised body.
    """
    if not isinstance(payload, dict):
        return None
    if "pull_request" in payload or "action" in payload:
        return parse_gitea_pr_payload(payload)
    if "ref" in payload or "after" in payload:
        return parse_gitea_push_payload(payload)
    return parse_normalized_payload(payload)
