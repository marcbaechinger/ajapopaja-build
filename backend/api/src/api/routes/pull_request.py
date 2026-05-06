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

import logging
import os
import tempfile
from typing import List, Optional

import git
from fastapi import APIRouter, HTTPException

from core.models.models import (
    Pipeline,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)
from core.utils import git_utils

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pull_requests", tags=["pull_requests"])


@router.get("/pipeline/{pipeline_id}", response_model=List[PullRequest])
async def get_pipeline_pull_requests(pipeline_id: str):
    return await PullRequest.find(PullRequest.pipeline_id == pipeline_id).to_list()


@router.get("/task/{task_id}", response_model=Optional[PullRequest])
async def get_task_pull_request(task_id: str):
    # Try to find the most recent OPEN pull request
    pr = (
        await PullRequest.find(
            PullRequest.task_id == task_id, PullRequest.status == PullRequestStatus.OPEN
        )
        .sort("-created_at")
        .first_or_none()
    )

    if not pr:
        # Fallback to the most recent PR of any status
        pr = (
            await PullRequest.find(PullRequest.task_id == task_id)
            .sort("-created_at")
            .first_or_none()
        )

    return pr


@router.get("/{pr_id}", response_model=PullRequest)
async def get_pull_request(pr_id: str):
    pr = await PullRequest.get(pr_id)
    if not pr:
        raise HTTPException(status_code=404, detail="Pull Request not found")
    return pr


@router.post("/{pr_id}/accept")
async def accept_pull_request(pr_id: str):
    logger.info(f"Accepting Pull Request {pr_id}")
    pr = await PullRequest.get(pr_id)
    if not pr:
        logger.warning(f"Pull Request {pr_id} not found")
        raise HTTPException(status_code=404, detail="Pull Request not found")

    if pr.status != PullRequestStatus.OPEN:
        logger.warning(f"Pull Request {pr_id} is not open (status: {pr.status})")
        raise HTTPException(status_code=400, detail="Pull Request is not open")

    pipeline = await Pipeline.get(pr.pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        logger.error(f"Pipeline {pr.pipeline_id} not found for PR {pr_id}")
        raise HTTPException(status_code=404, detail="Pipeline not found")

    # Apply patch to main workspace
    try:
        if not pr.patch or not pr.patch.strip():
            logger.warning(f"Pull Request {pr_id} has an empty patch")
            raise HTTPException(
                status_code=400, detail="Pull Request has an empty patch"
            )

        workspace_path = str(pipeline.workspace_abs_path)
        logger.info(f"Applying patch to workspace: {workspace_path}")
        repo = git_utils.get_repo(workspace_path)

        patch_content = pr.patch
        if not patch_content.endswith("\n"):
            patch_content += "\n"

        with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False) as f:
            f.write(patch_content)
            patch_path = f.name

        try:
            logger.info(f"Patch length: {len(pr.patch)} characters")
            logger.debug(f"Executing git apply with patch at {patch_path}")
            # Use --3way to handle minor context mismatches if possible
            repo.git.apply("--3way", patch_path)
            logger.info(f"Successfully applied patch for PR {pr_id}")
        except git.exc.GitCommandError as e:
            logger.error(f"Git apply failed for PR {pr_id}: {e.stderr}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Git apply failed: {e.stderr}")
        except Exception as e:
            logger.error(
                f"Unexpected error in git apply for PR {pr_id}: {e}", exc_info=True
            )
            raise
        finally:
            if os.path.exists(patch_path):
                os.remove(patch_path)

        pr.status = PullRequestStatus.ACCEPTED
        await pr.save()

        # Update task status
        task = await Task.get(pr.task_id)
        if task:
            logger.info(f"Updating status for task {pr.task_id} to IMPLEMENTED")
            task.status = TaskStatus.IMPLEMENTED
            task.completion_info = pr.summary
            await task.save()

        return {"status": "success", "message": "Pull Request accepted and applied"}
    except Exception as e:
        logger.error(
            f"Unexpected error in accept_pull_request for PR {pr_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"Error applying patch: {str(e)}")


@router.post("/{pr_id}/reject")
async def reject_pull_request(pr_id: str):
    pr = await PullRequest.get(pr_id)
    if not pr:
        raise HTTPException(status_code=404, detail="Pull Request not found")

    pr.status = PullRequestStatus.REJECTED
    await pr.save()
    return {"status": "success", "message": "Pull Request rejected"}
