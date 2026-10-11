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

from api.git_hosting.branch_events import (
    PrStateEvent,
    parse_gitea_pr_payload,
    parse_gitea_push_payload,
    parse_normalized_payload,
    parse_pr_state_payload,
)


def test_parse_gitea_push_to_default_branch_is_merged():
    payload = {
        "ref": "refs/heads/main",
        "after": "abc123def456",
        "repository": {"full_name": "owner/repo"},
    }
    event = parse_gitea_push_payload(payload)
    assert event == PrStateEvent(
        repo_full_name="owner/repo",
        branch="main",
        state="merged",
        commit_hash="abc123def456",
        base_branch="main",
    )


def test_parse_gitea_push_branch_delete_is_ignored():
    payload = {"ref": "refs/heads/main", "after": "0" * 40}
    assert parse_gitea_push_payload(payload) is None


def test_parse_gitea_push_non_push_is_ignored():
    assert parse_gitea_push_payload({"zen": "hi"}) is None
    assert parse_gitea_push_payload({"ref": "refs/tags/v1", "after": "abc"}) is None


def test_parse_gitea_pr_merged():
    payload = {
        "action": "closed",
        "repository": {"full_name": "owner/repo"},
        "pull_request": {
            "merged": True,
            "merge_commit_sha": "merge-sha",
            "base": {"ref": "main"},
            "head": {"ref": "feature/x", "sha": "head-sha"},
        },
    }
    event = parse_gitea_pr_payload(payload)
    assert event == PrStateEvent(
        repo_full_name="owner/repo",
        branch="main",
        state="merged",
        commit_hash="merge-sha",
        base_branch="main",
    )


def test_parse_gitea_pr_merged_falls_back_to_head_sha():
    payload = {
        "action": "closed",
        "pull_request": {
            "merged": True,
            "base": {"ref": "main"},
            "head": {"ref": "feature/x", "sha": "head-sha"},
        },
    }
    event = parse_gitea_pr_payload(payload)
    assert event.state == "merged"
    assert event.commit_hash == "head-sha"


def test_parse_gitea_pr_closed_without_merge_is_rejected():
    payload = {
        "action": "closed",
        "repository": {"full_name": "owner/repo"},
        "pull_request": {
            "merged": False,
            "base": {"ref": "main"},
            "head": {"ref": "feature/x", "sha": "head-sha"},
        },
    }
    event = parse_gitea_pr_payload(payload)
    assert event == PrStateEvent(
        repo_full_name="owner/repo",
        branch="feature/x",
        state="closed",
        commit_hash=None,
        base_branch="main",
    )


def test_parse_gitea_pr_non_closed_actions_are_ignored():
    for action in ("opened", "reopened", "synchronized", "edited"):
        assert parse_gitea_pr_payload({"action": action}) is None


def test_parse_normalized_payload():
    payload = {
        "repo": "owner/name",
        "branch": "main",
        "commit_hash": "abc123",
        "state": "merged",
    }
    event = parse_normalized_payload(payload)
    assert event == PrStateEvent(
        repo_full_name="owner/name",
        branch="main",
        state="merged",
        commit_hash="abc123",
        base_branch="main",
    )


def test_parse_normalized_payload_closed():
    payload = {"repo": "owner/name", "branch": "main", "state": "closed"}
    event = parse_normalized_payload(payload)
    assert event.state == "closed"
    assert event.commit_hash is None


def test_parse_pr_state_payload_dispatches_by_shape():
    assert (
        parse_pr_state_payload({"ref": "refs/heads/main", "after": "abc"})
        is not None
    )
    assert (
        parse_pr_state_payload({"action": "opened", "pull_request": {}}) is None
    )
    assert parse_pr_state_payload({"state": "merged", "branch": "main"}) is not None
    assert parse_pr_state_payload({"state": "opened"}) is None
