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

import asyncio
import uuid
from typing import Any, Dict, List

from api.assistant.decorators import register_tool
from core.queries import pipeline as pipeline_queries
from core.utils import git_utils

from .command_runner import CommandRunner

# Tool Categories
WRITE_ACCESS = "write_access"


@register_tool()
async def list_pipelines() -> List[Dict]:
    """
    Returns a list of all pipelines available in the system.
    """
    pipelines = await pipeline_queries.get_all_pipelines()
    return [p.model_dump(mode="json") for p in pipelines]


@register_tool()
async def get_pipeline_details(pipeline_id: str) -> Dict:
    """
    Returns detailed information for a specific pipeline.

    Args:
        pipeline_id: The unique identifier of the pipeline to retrieve.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    return pipeline.model_dump(mode="json")


@register_tool(tool_type=WRITE_ACCESS)
async def run_tests(pipeline_id: str) -> Dict[str, Any]:
    """
    Runs the configured test suite for a pipeline.

    If the pipeline has no test commands defined, returns a ``no_tests`` status
    immediately. Otherwise the test suite is executed asynchronously against the
    pipeline workspace (in its own background task so a long-running run never
    blocks this call) and the result is reported back through the assistant when
    it completes.

    Args:
        pipeline_id: The identifier of the pipeline whose tests to run.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    commands = _resolved_commands(pipeline.test_commands)
    if not commands:
        return {
            "status": "no_tests",
            "message": f"Pipeline {pipeline_id} has no test commands defined.",
        }
    return await _dispatch_pipeline_run(pipeline_id, commands, "test")


@register_tool(tool_type=WRITE_ACCESS)
async def run_lint(pipeline_id: str) -> Dict[str, Any]:
    """
    Runs the configured lint suite for a pipeline.

    If the pipeline has no lint commands defined, returns a ``no_lint`` status
    immediately. Otherwise the lint suite is executed asynchronously against the
    pipeline workspace (in its own background task so a long-running run never
    blocks this call) and the result is reported back through the assistant when
    it completes.

    Args:
        pipeline_id: The identifier of the pipeline whose lint commands to run.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    commands = _resolved_commands(pipeline.lint_commands)
    if not commands:
        return {
            "status": "no_lint",
            "message": f"Pipeline {pipeline_id} has no lint commands defined.",
        }
    return await _dispatch_pipeline_run(pipeline_id, commands, "lint")


def _resolved_commands(commands):
    """Filters a stored command list down to non-empty argv lists.

    ``None``/empty means "not configured" -> no commands to run.
    """
    return [c for c in (commands or []) if isinstance(c, list) and c]


async def _dispatch_pipeline_run(
    pipeline_id: str, commands: List[List[str]], kind: str
) -> Dict[str, Any]:
    """
    Schedules a command sequence against a pipeline's workspace as a background
    task and returns immediately with a ``started`` status and a ``run_id``.
    """
    # Resolve the workspace working directory (cloning remote repos on first
    # use). Commands run against this pipeline workspace, not a task sandbox.
    _, _repo = await git_utils.get_pipeline_and_repo(pipeline_id)
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    workspace_path = str(pipeline.workspace_abs_path)

    run_id = uuid.uuid4().hex
    # Schedule the run in a background task so this tool call returns promptly;
    # the AssistantSession registers a completion handler for ``run_id`` that
    # delivers the aggregate result back as the tool response when it finishes.
    asyncio.create_task(CommandRunner.dispatch(run_id, commands, workspace_path))

    return {
        "status": "started",
        "run_id": run_id,
        "message": f"{kind.capitalize()} run for pipeline {pipeline_id} started; "
        "result will be reported when complete.",
    }
