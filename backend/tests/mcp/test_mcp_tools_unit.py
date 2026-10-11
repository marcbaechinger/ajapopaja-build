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

from ajapopaja_mcp.tools import (
    complete_task,
    create_pull_request,
    create_task,
    get_next_task,
    get_task_details,
    get_task_status,
    search_tasks,
    update_task_design_doc,
)
from api.git_hosting.gitea import GiteaApiError
from core.models.models import TaskStatus

VALID_TASK_ID = "0123456789abcdef01234567"
VALID_PIPELINE_ID = "fedcba9876543210fedcba98"


@pytest.mark.asyncio
async def test_search_tasks_unit():
    mock_task = MagicMock()
    mock_task.id = VALID_TASK_ID
    mock_task.title = "Search Result"
    mock_task.status = "scheduled"
    mock_task.spec = "Some spec"
    mock_task.version = 1

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.tools.task_queries.search_tasks", new_callable=AsyncMock
        ) as mock_search,
    ):
        mock_search.return_value = ([mock_task], 1)

        result = await search_tasks(keywords="Search", statuses=["scheduled"])

        mock_init_db.assert_awaited_once()
        # Actual enum conversion is tested in integration tests.
        mock_search.assert_awaited_once()

        assert result["total_count"] == 1
        assert result["tasks"][0]["title"] == "Search Result"
        assert result["tasks"][0]["spec"] == "Some spec"


@pytest.mark.asyncio
async def test_search_tasks_invalid_pipeline_id():
    result = await search_tasks(pipeline_id="invalid-id")
    assert "error" in result
    assert "Invalid pipeline_id" in result["error"]


@pytest.mark.asyncio
async def test_search_tasks_invalid_status():
    with patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock):
        result = await search_tasks(statuses=["invalid-status"])
    assert "error" in result
    assert "Invalid status provided" in result["error"]


@pytest.mark.asyncio
async def test_search_tasks_excludes_deleted_unit():
    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.tools.task_queries.search_tasks", new_callable=AsyncMock
        ) as mock_search,
    ):
        mock_search.return_value = ([], 0)

        result = await search_tasks(keywords="Deleted")

        mock_init_db.assert_awaited_once()
        mock_search.assert_awaited_once()

        assert result["total_count"] == 0
        assert len(result["tasks"]) == 0


@pytest.mark.asyncio
async def test_get_task_details_invalid_id():
    result = await get_task_details(task_id="invalid-id")
    assert "error" in result
    assert "Invalid task_id" in result["error"]


@pytest.mark.asyncio
async def test_get_task_details_unit():
    task_id = VALID_TASK_ID
    mock_task = MagicMock()
    mock_task.id = task_id
    mock_task.pipeline_id = VALID_PIPELINE_ID
    mock_task.title = "Task Title"
    mock_task.description = "Task Description"
    mock_task.status = "inprogress"
    mock_task.type = "manual"
    mock_task.spec = "Task Spec"
    mock_task.design_doc = "Design Doc"
    mock_task.want_design_doc = True
    mock_task.version = 2
    mock_task.commit_hash = "abc1234"
    mock_task.completion_info = "Completed info"
    mock_task.verification = {"success": True}
    mock_task.history = []
    mock_task.created_at.isoformat.return_value = "2024-01-01T00:00:00Z"
    mock_task.updated_at.isoformat.return_value = "2024-01-01T01:00:00Z"

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.tools.task_queries.get_task_by_id", new_callable=AsyncMock
        ) as mock_get_task,
    ):
        mock_get_task.return_value = mock_task

        result = await get_task_details(task_id)

        mock_init_db.assert_awaited_once()
        mock_get_task.assert_awaited_once_with(task_id)
        assert result["id"] == task_id
        assert result["pipeline_id"] == VALID_PIPELINE_ID
        assert result["title"] == "Task Title"
        assert result["status"] == "inprogress"
        assert result["spec"] == "Task Spec"
        assert result["design_doc"] == "Design Doc"
        assert result["commit_hash"] == "abc1234"
        assert result["created_at"] == "2024-01-01T00:00:00Z"
        assert result["updated_at"] == "2024-01-01T01:00:00Z"


@pytest.mark.asyncio
async def test_get_next_task_unit():
    pipeline_id = VALID_PIPELINE_ID
    mock_task = MagicMock()
    mock_task.id = VALID_TASK_ID
    mock_task.title = "Task Title"
    mock_task.description = "Task Description"
    mock_task.design_doc = "Design Doc"
    mock_task.spec = "Task Spec"
    mock_task.want_design_doc = True
    mock_task.version = 1

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.tools.task_queries.get_next_task", new_callable=AsyncMock
        ) as mock_get_next,
        patch(
            "ajapopaja_mcp.tools.manager.notify_task_update", new_callable=AsyncMock
        ) as mock_notify,
    ):
        mock_get_next.return_value = mock_task

        result = await get_next_task(pipeline_id)

        mock_init_db.assert_awaited_once()
        mock_get_next.assert_awaited_once_with(pipeline_id, actor="mcp")
        mock_notify.assert_awaited_once_with(VALID_TASK_ID)

        assert result["id"] == VALID_TASK_ID
        assert result["title"] == "Task Title"
        assert result["design_doc_ready"] is True


@pytest.mark.asyncio
async def test_get_next_task_empty_unit():
    pipeline_id = VALID_PIPELINE_ID

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.tools.task_queries.get_next_task", new_callable=AsyncMock
        ) as mock_get_next,
    ):
        mock_get_next.return_value = None

        result = await get_next_task(pipeline_id)

        mock_init_db.assert_awaited_once()
        assert "error" in result
        assert "No scheduled tasks found" in result["error"]


@pytest.mark.asyncio
async def test_update_task_design_doc_unit():
    task_id = VALID_TASK_ID
    design_doc = "New Design"
    version = 1

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.tools.task_queries.update_task_details",
            new_callable=AsyncMock,
        ) as mock_update,
        patch(
            "ajapopaja_mcp.tools.manager.notify_task_update", new_callable=AsyncMock
        ) as mock_notify,
    ):
        result = await update_task_design_doc(task_id, design_doc, version)

        mock_init_db.assert_awaited_once()
        mock_update.assert_awaited_once_with(
            task_id=task_id, version=version, design_doc=design_doc
        )
        mock_notify.assert_awaited_once_with(task_id)
        assert "updated successfully" in result


@pytest.mark.asyncio
async def test_complete_task_unit():
    task_id = VALID_TASK_ID
    commit_hash = "abcdef1234567890"
    completion_info = "Done"
    version = 1

    mock_task = MagicMock()
    mock_task.id = task_id
    mock_task.pipeline_id = VALID_PIPELINE_ID
    mock_task.verification = {"success": True}

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.tools.git_utils.get_repo_for_pipeline_by_task",
            new_callable=AsyncMock,
        ) as mock_get_repo,
        patch(
            "ajapopaja_mcp.tools.git_utils.validate_commit_hash"
        ) as mock_validate_hash,
        patch(
            "ajapopaja_mcp.tools.task_queries.complete_task", new_callable=AsyncMock
        ) as mock_complete,
        patch(
            "ajapopaja_mcp.tools.manager.notify_task_update", new_callable=AsyncMock
        ) as mock_notify,
    ):
        mock_repo = MagicMock()
        mock_repo.working_dir = "/tmp/repo"
        mock_get_repo.return_value = mock_repo
        mock_validate_hash.return_value = True
        mock_complete.return_value = mock_task

        result = await complete_task(task_id, commit_hash, completion_info, version)

        mock_init_db.assert_awaited_once()
        mock_get_repo.assert_awaited_once_with(task_id)
        mock_validate_hash.assert_called_once_with(mock_repo, commit_hash)
        mock_complete.assert_awaited_once_with(
            task_id=task_id,
            version=version,
            commit_hash=commit_hash,
            completion_info=completion_info,
            actor="mcp",
        )
        mock_notify.assert_awaited_once_with(task_id)

        assert "completed successfully" in result


@pytest.mark.asyncio
async def test_complete_task_commit_not_found():
    task_id = VALID_TASK_ID
    commit_hash = "1234567"
    completion_info = "Done"
    version = 1

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock),
        patch(
            "ajapopaja_mcp.tools.git_utils.get_repo_for_pipeline_by_task",
            new_callable=AsyncMock,
        ) as mock_get_repo,
        patch(
            "ajapopaja_mcp.tools.git_utils.validate_commit_hash"
        ) as mock_validate_hash,
    ):
        mock_repo = MagicMock()
        mock_repo.working_dir = "/tmp/repo"
        mock_get_repo.return_value = mock_repo
        mock_validate_hash.return_value = False

        result = await complete_task(task_id, commit_hash, completion_info, version)

        assert f"Error: Commit hash '{commit_hash}' not found" in result


@pytest.mark.asyncio
async def test_get_task_status_unit():
    task_id = VALID_TASK_ID
    mock_task = MagicMock()
    mock_task.id = task_id
    mock_task.status = "inprogress"
    mock_task.version = 2
    mock_task.verification = None

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.tools.task_queries.get_task_by_id", new_callable=AsyncMock
        ) as mock_get_task,
    ):
        mock_get_task.return_value = mock_task

        result = await get_task_status(task_id)

        mock_init_db.assert_awaited_once()
        mock_get_task.assert_awaited_once_with(task_id)
        assert result["id"] == task_id
        assert result["status"] == "inprogress"


# ---------------------------------------------------------------------------
# create_task
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_create_task_unit():
    mock_task = MagicMock()
    mock_task.id = VALID_TASK_ID
    mock_task.pipeline_id = VALID_PIPELINE_ID
    mock_task.title = "New Task"
    mock_task.description = "A description"
    mock_task.status = TaskStatus.SCHEDULED
    mock_task.type = "manual"
    mock_task.spec = "Some spec"
    mock_task.design_doc = "# Design"
    mock_task.want_design_doc = True
    mock_task.order = 5
    mock_task.version = 1
    mock_task.created_at.isoformat.return_value = "2024-01-01T00:00:00Z"
    mock_task.updated_at.isoformat.return_value = "2024-01-01T00:00:00Z"

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock) as mock_init_db,
        patch("ajapopaja_mcp.tools.Task") as mock_task_cls,
        patch(
            "ajapopaja_mcp.tools.task_queries.create_task", new_callable=AsyncMock
        ) as mock_create,
        patch(
            "ajapopaja_mcp.tools.manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast,
    ):
        mock_task_cls.return_value = mock_task
        mock_create.return_value = mock_task

        result = await create_task(
            VALID_PIPELINE_ID,
            "New Task",
            spec="Some spec",
            design_doc="# Design",
            description="A description",
            want_design_doc=True,
            status="scheduled",
            order=5,
        )

        mock_init_db.assert_awaited_once()

        # The Task is built from the caller-supplied fields.
        built = mock_task_cls.call_args.kwargs
        assert built["pipeline_id"] == VALID_PIPELINE_ID
        assert built["title"] == "New Task"
        assert built["spec"] == "Some spec"
        assert built["design_doc"] == "# Design"
        assert built["description"] == "A description"
        assert built["status"] == TaskStatus.SCHEDULED
        assert built["want_design_doc"] is True
        assert built["order"] == 5

        mock_create.assert_awaited_once()
        call_args, call_kwargs = mock_create.await_args
        assert call_args[0] == VALID_PIPELINE_ID
        assert call_args[1] is mock_task
        assert call_kwargs["actor"] == "mcp"

        # A TASK_CREATED broadcast must be emitted for the live UI update.
        mock_broadcast.assert_awaited_once()
        message = mock_broadcast.await_args.args[0]
        assert message.type == "TASK_CREATED"

        assert result["id"] == VALID_TASK_ID
        assert result["pipeline_id"] == VALID_PIPELINE_ID
        assert result["title"] == "New Task"
        assert result["status"] == TaskStatus.SCHEDULED
        assert result["version"] == 1
        assert result["created_at"] == "2024-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test_create_task_invalid_pipeline_id():
    result = await create_task("invalid-id", "New Task")
    assert "error" in result
    assert "Invalid pipeline_id" in result["error"]


@pytest.mark.asyncio
async def test_create_task_empty_title():
    result = await create_task(VALID_PIPELINE_ID, "   ")
    assert "error" in result
    assert "title cannot be empty" in result["error"]


@pytest.mark.asyncio
async def test_create_task_invalid_status():
    result = await create_task(VALID_PIPELINE_ID, "New Task", status="bogus")
    assert "error" in result
    assert "Invalid status" in result["error"]


@pytest.mark.asyncio
async def test_create_task_broadcast_failure_is_best_effort():
    mock_task = MagicMock()
    mock_task.id = VALID_TASK_ID
    mock_task.pipeline_id = VALID_PIPELINE_ID
    mock_task.title = "New Task"
    mock_task.description = None
    mock_task.status = TaskStatus.CREATED
    mock_task.type = "manual"
    mock_task.spec = None
    mock_task.design_doc = None
    mock_task.want_design_doc = False
    mock_task.order = 100
    mock_task.version = 1
    mock_task.created_at.isoformat.return_value = "2024-01-01T00:00:00Z"
    mock_task.updated_at.isoformat.return_value = "2024-01-01T00:00:00Z"

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock),
        patch("ajapopaja_mcp.tools.Task") as mock_task_cls,
        patch(
            "ajapopaja_mcp.tools.task_queries.create_task", new_callable=AsyncMock
        ) as mock_create,
        patch(
            "ajapopaja_mcp.tools.manager.broadcast",
            new_callable=AsyncMock,
            side_effect=RuntimeError("no socket"),
        ),
    ):
        mock_task_cls.return_value = mock_task
        mock_create.return_value = mock_task

        result = await create_task(VALID_PIPELINE_ID, "New Task")

    # The task is still created even though the broadcast failed.
    assert "error" not in result
    assert result["id"] == VALID_TASK_ID
    assert result["status"] == TaskStatus.CREATED


# ---------------------------------------------------------------------------
# create_pull_request
# ---------------------------------------------------------------------------
def _mock_repo(*, head="feature/x", base="main", dirty=False, sha="a" * 40):
    repo = MagicMock()
    repo.active_branch.name = head
    repo.is_dirty.return_value = dirty
    repo.head.commit.hexsha = sha
    return repo


def _patch_create_pr_deps(repo, pipeline, pr_url="https://host/owner/repo/pulls/9"):
    return (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock),
        patch(
            "ajapopaja_mcp.tools.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch("ajapopaja_mcp.tools.git_utils.get_repo", return_value=repo),
        patch(
            "ajapopaja_mcp.tools.git_utils.current_default_branch", return_value="main"
        ),
        patch(
            "ajapopaja_mcp.tools.create_pipeline_pull_request",
            new_callable=AsyncMock,
            return_value=pr_url,
        ),
    )


@pytest.mark.asyncio
async def test_create_pull_request_success():
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/owner/repo.git"
    pipeline.workspace_abs_path = "/tmp/repo"
    repo = _mock_repo()

    patches = _patch_create_pr_deps(repo, pipeline)
    with (
        patches[0],
        patches[1],
        patches[2],
        patches[3],
        patches[4] as mock_create,
    ):
        result = await create_pull_request(
            VALID_PIPELINE_ID, "Add feature", "Body text"
        )

    assert result["status"] == "created"
    assert result["pr_url"] == "https://host/owner/repo/pulls/9"
    assert result["branch"] == "feature/x"
    assert result["base"] == "main"
    assert result["commit_hash"] == "a" * 40
    assert result["task_status"] is None
    mock_create.assert_awaited_once()
    # The feature branch is used as head; no new branch is created.
    repo.create_head.assert_not_called()


@pytest.mark.asyncio
async def test_create_pull_request_invalid_pipeline_id():
    result = await create_pull_request("nope", "title")
    assert "error" in result
    assert "Invalid pipeline_id" in result["error"]


@pytest.mark.asyncio
async def test_create_pull_request_invalid_task_id():
    result = await create_pull_request(VALID_PIPELINE_ID, "title", task_id="nope")
    assert "error" in result
    assert "Invalid task_id" in result["error"]


@pytest.mark.asyncio
async def test_create_pull_request_empty_title():
    result = await create_pull_request(VALID_PIPELINE_ID, "   ")
    assert "error" in result
    assert "title cannot be empty" in result["error"]


@pytest.mark.asyncio
async def test_create_pull_request_local_pipeline_rejected():
    pipeline = MagicMock()
    pipeline.repo_uri = None

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock),
        patch(
            "ajapopaja_mcp.tools.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch(
            "ajapopaja_mcp.tools.create_pipeline_pull_request",
            new_callable=AsyncMock,
        ) as mock_create,
    ):
        result = await create_pull_request(VALID_PIPELINE_ID, "title")

    assert "error" in result
    assert "no remote repo_uri" in result["error"]
    mock_create.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_pull_request_dirty_tree_rejected():
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/owner/repo.git"
    pipeline.workspace_abs_path = "/tmp/repo"
    repo = _mock_repo(dirty=True)

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock),
        patch(
            "ajapopaja_mcp.tools.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch("ajapopaja_mcp.tools.git_utils.get_repo", return_value=repo),
        patch(
            "ajapopaja_mcp.tools.git_utils.current_default_branch", return_value="main"
        ),
        patch(
            "ajapopaja_mcp.tools.create_pipeline_pull_request",
            new_callable=AsyncMock,
        ) as mock_create,
    ):
        result = await create_pull_request(VALID_PIPELINE_ID, "title")

    assert "error" in result
    assert "uncommitted" in result["error"]
    mock_create.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_pull_request_on_default_branch_creates_branch():
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/owner/repo.git"
    pipeline.workspace_abs_path = "/tmp/repo"
    repo = _mock_repo(head="main", sha="abcdef1234567890")

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock),
        patch(
            "ajapopaja_mcp.tools.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch("ajapopaja_mcp.tools.git_utils.get_repo", return_value=repo),
        patch(
            "ajapopaja_mcp.tools.git_utils.current_default_branch", return_value="main"
        ),
        patch("ajapopaja_mcp.tools.git_utils.create_branch_at_head") as mock_branch,
        patch(
            "ajapopaja_mcp.tools.create_pipeline_pull_request",
            new_callable=AsyncMock,
            return_value="https://host/owner/repo/pulls/1",
        ) as mock_create,
    ):
        result = await create_pull_request(VALID_PIPELINE_ID, "title")

    assert result["status"] == "created"
    assert result["branch"] == "pi/abcdef1"
    mock_branch.assert_called_once_with(repo, "pi/abcdef1")
    # The tool must not check the new branch out.
    repo.git.checkout.assert_not_called()
    assert mock_create.await_args.kwargs["head"] == "pi/abcdef1"


@pytest.mark.asyncio
async def test_create_pull_request_on_default_branch_with_task():
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/owner/repo.git"
    pipeline.workspace_abs_path = "/tmp/repo"
    repo = _mock_repo(head="main")

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock),
        patch(
            "ajapopaja_mcp.tools.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch("ajapopaja_mcp.tools.git_utils.get_repo", return_value=repo),
        patch(
            "ajapopaja_mcp.tools.git_utils.current_default_branch", return_value="main"
        ),
        patch("ajapopaja_mcp.tools.git_utils.create_branch_at_head") as mock_branch,
        patch(
            "ajapopaja_mcp.tools.task_queries.get_task_by_id",
            new_callable=AsyncMock,
        ) as mock_get_task,
        patch(
            "ajapopaja_mcp.tools.task_queries.transition_task",
            new_callable=AsyncMock,
        ) as mock_transition,
        patch(
            "ajapopaja_mcp.tools.create_pipeline_pull_request",
            new_callable=AsyncMock,
            return_value="https://host/owner/repo/pulls/1",
        ),
    ):
        task = MagicMock()
        task.id = VALID_TASK_ID
        task.status = TaskStatus.INPROGRESS
        task.save = AsyncMock()

        async def fake_transition(task_id, to_status, actor, task):
            task.status = to_status
            return task

        mock_get_task.return_value = task
        mock_transition.side_effect = fake_transition

        result = await create_pull_request(
            VALID_PIPELINE_ID, "title", task_id=VALID_TASK_ID
        )

    assert result["task_status"] == "submitted"
    assert task.commit_hash == "a" * 40
    assert task.review_md == "https://host/owner/repo/pulls/1"
    mock_branch.assert_called_once_with(repo, f"pi/{VALID_TASK_ID}")


@pytest.mark.asyncio
async def test_create_pull_request_task_bookkeeping_when_transition_illegal():
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/owner/repo.git"
    pipeline.workspace_abs_path = "/tmp/repo"
    repo = _mock_repo()

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock),
        patch(
            "ajapopaja_mcp.tools.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch("ajapopaja_mcp.tools.git_utils.get_repo", return_value=repo),
        patch(
            "ajapopaja_mcp.tools.git_utils.current_default_branch", return_value="main"
        ),
        patch(
            "ajapopaja_mcp.tools.task_queries.get_task_by_id",
            new_callable=AsyncMock,
        ) as mock_get_task,
        patch(
            "ajapopaja_mcp.tools.task_queries.transition_task",
            new_callable=AsyncMock,
            side_effect=ValueError("Illegal task transition"),
        ),
        patch(
            "ajapopaja_mcp.tools.create_pipeline_pull_request",
            new_callable=AsyncMock,
            return_value="https://host/owner/repo/pulls/2",
        ),
    ):
        task = MagicMock()
        task.id = VALID_TASK_ID
        task.status = TaskStatus.INPROGRESS
        task.save = AsyncMock()
        mock_get_task.return_value = task

        result = await create_pull_request(
            VALID_PIPELINE_ID, "title", task_id=VALID_TASK_ID
        )

    # PR is still created; the recorded hashes are persisted but the status
    # is left unchanged because the transition is not legal.
    assert result["status"] == "created"
    assert result["task_status"] == "inprogress"
    assert task.commit_hash == "a" * 40
    assert task.review_md == "https://host/owner/repo/pulls/2"
    task.save.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_pull_request_gitea_error_surfaced():
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/owner/repo.git"
    pipeline.workspace_abs_path = "/tmp/repo"
    repo = _mock_repo()

    with (
        patch("ajapopaja_mcp.tools.init_db", new_callable=AsyncMock),
        patch(
            "ajapopaja_mcp.tools.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch("ajapopaja_mcp.tools.git_utils.get_repo", return_value=repo),
        patch(
            "ajapopaja_mcp.tools.git_utils.current_default_branch", return_value="main"
        ),
        patch(
            "ajapopaja_mcp.tools.create_pipeline_pull_request",
            new_callable=AsyncMock,
            side_effect=GiteaApiError("boom", status_code=422, detail="ref missing"),
        ),
    ):
        result = await create_pull_request(VALID_PIPELINE_ID, "title")

    assert "error" in result
    assert result["status_code"] == 422
    assert result["detail"] == "ref missing"
