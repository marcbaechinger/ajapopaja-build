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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.docbot.registry import docbot_registry
from api.docbot.session import DocBotSession, _docbot_subject
from core.models.models import PullRequestKind


@pytest.fixture(autouse=True)
def mock_sandbox_dependencies():
    with (
        patch("api.bot.base_session.pipeline_queries.get_pipeline_by_id") as mock_get_p,
        patch("api.bot.base_session.SandboxGitHelper") as mock_helper_cls,
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.workspace_abs_path = "/tmp/fake/workspace"
        mock_get_p.return_value = mock_pipeline

        mock_helper = MagicMock()
        mock_helper_cls.return_value = mock_helper

        yield mock_get_p, mock_helper


async def make_async_iter(items):
    for item in items:
        yield item


@pytest.mark.asyncio
async def test_get_initial_prompt_reports_commit_missing_from_workspace():
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")
    task = MagicMock()
    task.commit_hash = "missing-sha"
    pipeline = MagicMock()
    pipeline.workspace_abs_path = "/tmp/fake/workspace"
    repo = MagicMock()
    repo.git.show.side_effect = Exception("bad object missing-sha")

    with (
        patch(
            "api.docbot.session.task_queries.get_task_by_id",
            new_callable=AsyncMock,
            return_value=task,
        ),
        patch(
            "api.docbot.session.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch("api.docbot.session.git_utils.get_repo", return_value=repo),
    ):
        with pytest.raises(ValueError, match="missing from the pipeline workspace"):
            await session.get_initial_prompt()


@pytest.mark.asyncio
async def test_docbot_session_run_terminal_call():
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")

    # Mock tool result
    async def mock_tool_func(**kwargs):
        return "Tool success"

    mock_tool = MagicMock()
    mock_tool.name = "no_doc_update_needed"
    mock_tool.description = "A mock tool description"
    mock_tool.parameters = {"type": "object", "properties": {}}
    mock_tool.func = mock_tool_func

    with (
        patch.object(docbot_registry, "get_tool", return_value=mock_tool),
        patch.object(docbot_registry, "list_tools", return_value=[mock_tool]),
    ):
        # Mock Ollama response with a tool call
        mock_msg = MagicMock()
        mock_tool_call = MagicMock()
        mock_tool_call.function.name = "no_doc_update_needed"
        mock_tool_call.function.arguments = {"reason": "nothing to do"}
        mock_msg.tool_calls = [mock_tool_call]
        mock_msg.content = ""

        mock_chunk = MagicMock()
        mock_chunk.message = mock_msg

        with patch(
            "api.bot.base_session.ollama.AsyncClient.chat", new_callable=AsyncMock
        ) as mock_chat:
            # chat returns an async generator when stream=True
            mock_chat.return_value = make_async_iter([mock_chunk])

            with patch.object(
                session,
                "get_initial_prompt",
                new_callable=AsyncMock,
                return_value="Initial prompt",
            ):
                await session.run()

            assert mock_chat.called
            # Check terminal call was detected (loop finished)
            assert any(
                msg.get("role") == "tool" and '"Tool success"' in msg.get("content", "")
                for msg in session.history
                if isinstance(msg, dict)
            )


@pytest.mark.asyncio
async def test_docbot_session_max_iterations():
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")

    # Mock Ollama response with no tool call
    mock_msg = MagicMock()
    mock_msg.tool_calls = []
    mock_msg.content = "Just talking..."

    mock_chunk = MagicMock()
    mock_chunk.message = mock_msg

    with patch(
        "api.bot.base_session.ollama.AsyncClient.chat", new_callable=AsyncMock
    ) as mock_chat:
        mock_chat.return_value = make_async_iter([mock_chunk])

        with patch.object(
            session,
            "get_initial_prompt",
            new_callable=AsyncMock,
            return_value="Initial prompt",
        ):
            await session.run(max_iterations=2)

        # Should be called 2 times (the max_iterations)
        assert mock_chat.call_count == 2
        # History should contain "Continue" prompts
        assert any(
            "You haven't finalized the session yet." in msg["content"]
            for msg in session.history
            if msg["role"] == "user"
        )


@pytest.mark.asyncio
async def test_docbot_session_multiple_tool_calls():
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")

    async def mock_tool_1(**kwargs):
        return "Tool 1 success"

    async def mock_tool_2(**kwargs):
        return "Tool 2 success"

    t1 = MagicMock()
    t1.name = "tool1"
    t1.parameters = {"type": "object", "properties": {}}
    t1.func = mock_tool_1
    t1.is_available.return_value = True

    t2 = MagicMock()
    t2.name = "no_doc_update_needed"
    t2.parameters = {"type": "object", "properties": {}}
    t2.func = mock_tool_2
    t2.is_available.return_value = True

    with (
        patch.object(
            docbot_registry,
            "get_tool",
            side_effect=lambda n: t1 if n == "tool1" else t2,
        ),
        patch.object(docbot_registry, "list_tools", return_value=[t1, t2]),
    ):
        mock_msg = MagicMock()

        tc1 = MagicMock()
        tc1.function.name = "tool1"
        tc1.function.arguments = {}

        tc2 = MagicMock()
        tc2.function.name = "no_doc_update_needed"
        tc2.function.arguments = {"reason": "done"}

        mock_msg.tool_calls = [tc1, tc2]
        mock_msg.content = ""

        mock_chunk = MagicMock()
        mock_chunk.message = mock_msg

        with patch(
            "api.bot.base_session.ollama.AsyncClient.chat", new_callable=AsyncMock
        ) as mock_chat:
            mock_chat.return_value = make_async_iter([mock_chunk])

            with patch.object(
                session,
                "get_initial_prompt",
                new_callable=AsyncMock,
                return_value="Initial prompt",
            ):
                await session.run()

            # Verify both tools were called and results added to history
            tool_results = [
                msg["content"] for msg in session.history if msg.get("role") == "tool"
            ]
            assert '"Tool 1 success"' in tool_results
            assert '"Tool 2 success"' in tool_results
            assert mock_chat.call_count == 1


@pytest.mark.asyncio
async def test_docbot_session_terminal_retry_on_error():
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")

    async def mock_fail_func(**kwargs):
        return "Error: Something went wrong"

    async def mock_success_func(**kwargs):
        return "Success"

    t = MagicMock()
    t.name = "no_doc_update_needed"
    t.parameters = {"type": "object", "properties": {}}
    t.func = mock_fail_func
    t.is_available.return_value = True

    with (
        patch.object(docbot_registry, "get_tool", return_value=t),
        patch.object(docbot_registry, "list_tools", return_value=[t]),
    ):
        # 1st response: fail
        mock_msg1 = MagicMock()
        tc1 = MagicMock()
        tc1.function.name = "no_doc_update_needed"
        tc1.function.arguments = {"reason": "try 1"}
        mock_msg1.tool_calls = [tc1]
        mock_msg1.content = ""
        mock_chunk1 = MagicMock()
        mock_chunk1.message = mock_msg1

        # 2nd response: success (we'll swap the mock function)
        mock_msg2 = MagicMock()
        tc2 = MagicMock()
        tc2.function.name = "no_doc_update_needed"
        tc2.function.arguments = {"reason": "try 2"}
        mock_msg2.tool_calls = [tc2]
        mock_msg2.content = ""
        mock_chunk2 = MagicMock()
        mock_chunk2.message = mock_msg2

        with patch(
            "api.bot.base_session.ollama.AsyncClient.chat", new_callable=AsyncMock
        ) as mock_chat:
            mock_chat.side_effect = [
                make_async_iter([mock_chunk1]),
                make_async_iter([mock_chunk2]),
            ]

            # First call uses failing func
            with patch.object(
                session,
                "get_initial_prompt",
                new_callable=AsyncMock,
                return_value="Initial prompt",
            ):
                await session.run(max_iterations=2)

            # It should have called chat twice because the first terminal call failed
            assert mock_chat.call_count == 2


@pytest.mark.asyncio
async def test_docbot_session_custom_feedback():
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")

    feedback = session.get_default_feedback("p1", "t1", "Some message")

    assert "You haven't finalized the session yet." in feedback
    assert "document_update_completed" in feedback
    assert "no_doc_update_needed" in feedback
    assert "p1" in feedback
    assert "t1" in feedback


@pytest.mark.asyncio
async def test_handle_bot_end_empty_patch_skips_pr_creation():
    """Test that an empty patch skips PR creation and logs a warning."""
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")
    session.has_updates = True

    mock_repo = MagicMock()
    mock_repo.git.commit = MagicMock()
    mock_repo.git.diff = MagicMock(return_value="")

    mock_helper = MagicMock()
    mock_helper.get_repo = MagicMock(return_value=mock_repo)
    mock_helper.branch_name = "test-branch"
    mock_helper.cleanup = MagicMock()
    session.helper = mock_helper
    session.session_result = {"summary": "Test summary"}

    with (
        patch("api.docbot.session.PullRequest") as mock_pr_class,
        patch("api.docbot.session.manager") as mock_manager,
        patch("api.docbot.session.logger") as mock_logger,
    ):
        await session._handle_bot_end()

        # Verify PR was NOT created
        mock_pr_class.return_value.insert.assert_not_called()
        mock_manager.broadcast.assert_not_called()

        # Verify warning was logged
        mock_logger.warning.assert_called_once_with(
            "DocBot generated an empty or unchanged patch. Skipping PR creation."
        )

        # Verify cleanup was called
        mock_helper.cleanup.assert_called_once()


@pytest.mark.asyncio
async def test_handle_bot_end_whitespace_only_patch_skips_pr_creation():
    """Test that a whitespace-only patch skips PR creation and logs a warning."""
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")
    session.has_updates = True

    mock_repo = MagicMock()
    mock_repo.git.commit = MagicMock()
    mock_repo.git.diff = MagicMock(return_value="   \n\t  \n")

    mock_helper = MagicMock()
    mock_helper.get_repo = MagicMock(return_value=mock_repo)
    mock_helper.branch_name = "test-branch"
    mock_helper.cleanup = MagicMock()
    session.helper = mock_helper
    session.session_result = {"summary": "Test summary"}

    with (
        patch("core.models.models.PullRequest") as mock_pr_class,
        patch("api.docbot.session.manager") as mock_manager,
        patch("api.docbot.session.logger") as mock_logger,
    ):
        await session._handle_bot_end()

        # Verify PR was NOT created
        mock_pr_class.return_value.insert.assert_not_called()
        mock_manager.broadcast.assert_not_called()

        # Verify warning was logged
        mock_logger.warning.assert_called_once_with(
            "DocBot generated an empty or unchanged patch. Skipping PR creation."
        )

        # Verify cleanup was called
        mock_helper.cleanup.assert_called_once()


@pytest.mark.asyncio
async def test_handle_bot_end_commit_failure_records_failed_result():
    """A commit failure is surfaced instead of silently completing the session."""
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")
    session.has_updates = True

    mock_repo = MagicMock()
    mock_repo.git.add = MagicMock()
    mock_repo.git.commit = MagicMock(side_effect=Exception("commit failed"))
    mock_repo.git.diff = MagicMock()

    mock_helper = MagicMock()
    mock_helper.get_repo = MagicMock(return_value=mock_repo)
    mock_helper.branch_name = "test-branch"
    mock_helper.cleanup = MagicMock()
    session.helper = mock_helper
    session.session_result = {"summary": "Test summary"}

    with (
        patch("api.docbot.session.PullRequest") as mock_pr_class,
        patch("api.docbot.session.manager") as mock_manager,
        patch("api.docbot.session.logger") as mock_logger,
    ):
        await session._handle_bot_end()

    assert session.session_result == {
        "status": "pr_creation_failed",
        "reason": "commit failed",
        "summary": "Test summary",
    }
    mock_pr_class.return_value.insert.assert_not_called()
    mock_repo.git.diff.assert_not_called()
    mock_helper.cleanup.assert_called_once()
    mock_manager.broadcast.assert_not_called()
    mock_logger.error.assert_called_once_with(
        "DocBot error creating PR: commit failed", exc_info=True
    )


@pytest.mark.asyncio
async def test_handle_bot_end_pull_request_insert_failure_records_failed_result():
    """A database insert failure is surfaced instead of reporting completion."""
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")
    session.has_updates = True

    mock_repo = MagicMock()
    mock_repo.git.add = MagicMock()
    mock_repo.git.commit = MagicMock()
    mock_repo.git.diff = MagicMock(return_value="diff --git a/doc.md b/doc.md\n")

    mock_helper = MagicMock()
    mock_helper.get_repo = MagicMock(return_value=mock_repo)
    mock_helper.branch_name = "docbot/test_task/abc12345"
    mock_helper.cleanup = MagicMock()
    session.helper = mock_helper
    session.session_result = {"summary": "Test summary"}

    mock_pr = MagicMock()
    mock_pr.insert = AsyncMock(side_effect=Exception("insert failed"))

    with (
        patch("api.docbot.session.PullRequest", return_value=mock_pr),
        patch("api.docbot.session.manager") as mock_manager,
        patch("api.docbot.session.logger") as mock_logger,
    ):
        await session._handle_bot_end()

    assert session.session_result == {
        "status": "pr_creation_failed",
        "reason": "insert failed",
        "summary": "Test summary",
    }
    mock_pr.insert.assert_awaited_once()
    mock_helper.cleanup.assert_called_once()
    mock_manager.broadcast.assert_not_called()
    mock_logger.error.assert_called_once_with(
        "DocBot error creating PR: insert failed", exc_info=True
    )


@pytest.mark.asyncio
async def test_handle_bot_end_no_helper():
    """Test that _handle_bot_end with no helper skips PR creation appropriately."""
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")
    session.has_updates = True
    session.helper = None
    session.session_result = {"summary": "Test summary"}

    with patch("api.docbot.session.manager.broadcast") as mock_broadcast:
        await session._handle_bot_end()

        mock_broadcast.assert_not_called()


@pytest.mark.asyncio
async def test_handle_bot_end_no_helper_doesnt_call_cleanup():
    """Test that cleanup() is NOT called when helper is None."""
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")
    session.has_updates = True
    session.helper = None
    session.session_result = {"summary": "Test summary"}

    with (
        patch("core.models.models.PullRequest.insert") as mock_pull_request_insert,
        patch("api.docbot.session.manager.broadcast") as mock_broadcast,
    ):
        await session._handle_bot_end()

        # Verify method completed without error
        mock_broadcast.assert_not_called()
        # This would fail if helper.cleanup() was called on None
        assert session.helper is None
        mock_pull_request_insert.assert_not_called()


def test_docbot_subject_is_non_empty_and_prefixed():
    assert _docbot_subject("Improve architecture docs\n\nMore details") == (
        "DocBot: Improve architecture docs"
    )
    assert _docbot_subject("# DocBot: update API docs") == "DocBot: update API docs"
    assert _docbot_subject("docbot refreshes docs") == "docbot refreshes docs"
    assert _docbot_subject("") == "DocBot: Documentation updated by DocBot"
    assert len(_docbot_subject("x" * 500)) == 200


@pytest.mark.asyncio
async def test_handle_bot_end_creates_documentation_pull_request():
    """DocBot PRs carry kind, subject, author and the unique sandbox branch."""
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")
    session.has_updates = True

    mock_repo = MagicMock()
    mock_repo.git.commit = MagicMock()
    mock_repo.git.diff = MagicMock(return_value="diff --git a/doc.md b/doc.md\n")

    mock_helper = MagicMock()
    mock_helper.get_repo = MagicMock(return_value=mock_repo)
    mock_helper.branch_name = "docbot/test_task/abc12345"
    mock_helper.cleanup = MagicMock()
    session.helper = mock_helper
    session.session_result = {"summary": "# Updated architecture\n\nDetails"}

    mock_pr = MagicMock()
    mock_pr.id = "pr-123"
    mock_pr.branch_name = "docbot/test_task/abc12345"
    mock_pr.insert = AsyncMock()

    with (
        patch("api.docbot.session.PullRequest", return_value=mock_pr) as mock_pr_class,
        patch("api.docbot.session.manager.broadcast", new_callable=AsyncMock),
    ):
        await session._handle_bot_end()

    mock_pr_class.assert_called_once()
    kwargs = mock_pr_class.call_args.kwargs
    assert kwargs["pipeline_id"] == "test_pipeline"
    assert kwargs["task_id"] == "test_task"
    assert kwargs["kind"] == PullRequestKind.DOCUMENTATION
    assert kwargs["subject"] == "DocBot: Updated architecture"
    assert kwargs["summary"] == "# Updated architecture\n\nDetails"
    assert kwargs["author"] == "docbot"
    assert kwargs["branch_name"] == "docbot/test_task/abc12345"
    assert kwargs["patch"] == "diff --git a/doc.md b/doc.md\n"
    assert kwargs["status"].value == "open"
    mock_pr.insert.assert_awaited_once()
    mock_helper.cleanup.assert_called_once()
    assert session.session_result["pr_id"] == "pr-123"
    assert session.session_result["branch_name"] == "docbot/test_task/abc12345"


def test_two_docbot_sessions_for_same_task_get_distinct_branches():
    """Each DocBot run gets its own branch, even for the same task."""
    fake_uuids = [
        MagicMock(hex="aaaaaaaa11111111"),
        MagicMock(hex="bbbbbbbb22222222"),
    ]
    session_one = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")
    session_two = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")

    with patch("api.docbot.session.uuid.uuid4", side_effect=fake_uuids):
        branch_one = session_one.get_sandbox_branch_name()
        branch_two = session_two.get_sandbox_branch_name()

    assert branch_one == "docbot/test_task/aaaaaaaa"
    assert branch_two == "docbot/test_task/bbbbbbbb"
    assert branch_one != branch_two


@pytest.mark.asyncio
async def test_two_docbot_runs_create_prs_on_distinct_branches():
    """Two DocBot PRs for the same task must not share a branch."""
    fake_uuids = [
        MagicMock(hex="aaaaaaaa11111111"),
        MagicMock(hex="bbbbbbbb22222222"),
    ]
    expected_branches = [
        "docbot/test_task/aaaaaaaa",
        "docbot/test_task/bbbbbbbb",
    ]
    created_branches = []

    with patch("api.docbot.session.uuid.uuid4", side_effect=fake_uuids):
        for expected_branch in expected_branches:
            session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")
            session.has_updates = True

            mock_repo = MagicMock()
            mock_repo.git.commit = MagicMock()
            mock_repo.git.diff = MagicMock(
                return_value="diff --git a/doc.md b/doc.md\n"
            )

            mock_helper = MagicMock()
            mock_helper.get_repo = MagicMock(return_value=mock_repo)
            mock_helper.branch_name = session.get_sandbox_branch_name()
            mock_helper.cleanup = MagicMock()
            session.helper = mock_helper
            session.session_result = {"summary": "Updated docs"}

            mock_pr = MagicMock()
            mock_pr.id = "pr-123"
            mock_pr.branch_name = mock_helper.branch_name
            mock_pr.insert = AsyncMock()

            with (
                patch(
                    "api.docbot.session.PullRequest", return_value=mock_pr
                ) as mock_pr_class,
                patch("api.docbot.session.manager.broadcast", new_callable=AsyncMock),
            ):
                await session._handle_bot_end()

            branch_name = mock_pr_class.call_args.kwargs["branch_name"]
            assert branch_name == expected_branch
            created_branches.append(branch_name)

    assert len(set(created_branches)) == 2
