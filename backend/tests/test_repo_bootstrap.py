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

"""Tests for the startup remote-repo bootstrap service and its wiring."""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.models.models import Pipeline, RepoBootstrapStatus
from core.services import repo_bootstrap

LOGGER_NAME = "core.services.repo_bootstrap"


def _messages(caplog):
    return [r.getMessage() for r in caplog.records if r.name == LOGGER_NAME]


@pytest.mark.asyncio
async def test_bootstrap_clones_missing_and_leaves_present(init_mock_db, caplog):
    await Pipeline(name="local", workspace_path="local").insert()
    await Pipeline(name="new", repo_uri="https://host/org/new.git").insert()
    await Pipeline(name="existing", repo_uri="https://host/org/existing.git").insert()

    def fake_status(pipeline):
        if pipeline.name == "new":
            return RepoBootstrapStatus.CLONED
        return RepoBootstrapStatus.AVAILABLE

    with (
        patch(
            "core.services.repo_bootstrap.git_utils.ensure_repo_present",
            side_effect=fake_status,
        ) as mock_ensure,
        caplog.at_level(logging.INFO, logger=LOGGER_NAME),
    ):
        await repo_bootstrap.bootstrap_remote_repos()

    # Only remote pipelines are checked.
    checked = {call.args[0].name for call in mock_ensure.call_args_list}
    assert checked == {"new", "existing"}

    messages = _messages(caplog)
    assert len(messages) == 2
    assert any("new.git" in m and "cloned (was missing)" in m for m in messages)
    assert any(
        "existing.git" in m and "already present (no action)" in m for m in messages
    )
    assert not any("local" in m for m in messages)


@pytest.mark.asyncio
async def test_bootstrap_failure_is_logged_and_does_not_stop_others(
    init_mock_db, caplog
):
    await Pipeline(name="bad", repo_uri="https://host/org/bad.git").insert()
    await Pipeline(name="good", repo_uri="https://host/org/good.git").insert()

    def fake_status(pipeline):
        if pipeline.name == "bad":
            raise RuntimeError("boom")
        return RepoBootstrapStatus.CLONED

    with (
        patch(
            "core.services.repo_bootstrap.git_utils.ensure_repo_present",
            side_effect=fake_status,
        ) as mock_ensure,
        caplog.at_level(logging.INFO, logger=LOGGER_NAME),
    ):
        # Never raises, even though one repo fails.
        await repo_bootstrap.bootstrap_remote_repos()

    assert mock_ensure.call_count == 2
    messages = _messages(caplog)
    assert any("bad.git" in m and "could not be prepared" in m for m in messages)
    assert any("good.git" in m and "cloned (was missing)" in m for m in messages)


@pytest.mark.asyncio
async def test_bootstrap_swallows_list_failure(caplog):
    with (
        patch(
            "core.services.repo_bootstrap.pipeline_queries.get_all_pipelines",
            side_effect=RuntimeError("db down"),
        ),
        caplog.at_level(logging.WARNING, logger=LOGGER_NAME),
    ):
        await repo_bootstrap.bootstrap_remote_repos()  # never raises

    assert any("Could not list pipelines" in m for m in _messages(caplog))


@pytest.mark.asyncio
async def test_lifespan_bootstraps_remote_repos():
    """The FastAPI lifespan must await the bootstrap service."""
    from api import main as api_main

    with (
        patch.object(api_main, "init_db", new_callable=AsyncMock),
        patch.object(
            api_main.coderbot_manager, "reconcile_on_startup", new_callable=AsyncMock
        ),
        patch.object(
            api_main.repo_bootstrap,
            "bootstrap_remote_repos",
            new_callable=AsyncMock,
        ) as mock_bootstrap,
        patch.object(api_main, "register_assistant_handlers"),
        patch.object(api_main, "register_oneprompt_handlers"),
        patch.object(api_main, "register_dev_process_ws"),
        patch.object(api_main, "register_notification_handlers"),
        patch.object(api_main, "initialize_oneprompt"),
        patch.object(api_main, "register_session_title_hooks"),
        patch(
            "api.main.DevProcessManager.instance",
            return_value=MagicMock(stop_all=AsyncMock()),
        ),
    ):
        async with api_main.lifespan(MagicMock()):
            mock_bootstrap.assert_awaited_once()
