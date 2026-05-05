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

from typing import List, Optional
from fastapi import APIRouter, HTTPException
from core.models.models import (
    PullRequest,
    PullRequestStatus,
    Pipeline,
    Task,
    TaskStatus,
)
from core.utils import git_utils

router = APIRouter(prefix="/pull_requests", tags=["pull_requests"])


@router.get("/pipeline/{pipeline_id}", response_model=List[PullRequest])
async def get_pipeline_pull_requests(pipeline_id: str):
    return await PullRequest.find(PullRequest.pipeline_id == pipeline_id).to_list()


@router.get("/task/{task_id}", response_model=Optional[PullRequest])
async def get_task_pull_request(task_id: str):
    return await PullRequest.find_one(PullRequest.task_id == task_id)


@router.post("/{pr_id}/accept")
async def accept_pull_request(pr_id: str):
    pr = await PullRequest.get(pr_id)
    if not pr:
        raise HTTPException(status_code=404, detail="Pull Request not found")

    if pr.status != PullRequestStatus.OPEN:
        raise HTTPException(status_code=400, detail="Pull Request is not open")

    pipeline = await Pipeline.get(pr.pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    # Apply patch to main workspace
    try:
        repo = git_utils.get_repo(str(pipeline.workspace_abs_path))
        # We can use git apply or similar. GitPython might have a better way but we can use repo.git.apply
        # We write patch to a temp file and apply it
        import tempfile
        import os

        with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False) as f:
            f.write(pr.patch)
            patch_path = f.name

        try:
            # --3way fallback is safer
            repo.git.apply(patch_path)
        finally:
            if os.path.exists(patch_path):
                os.remove(patch_path)

        pr.status = PullRequestStatus.ACCEPTED
        await pr.save()

        # Update task status
        task = await Task.get(pr.task_id)
        if task:
            task.status = TaskStatus.IMPLEMENTED
            task.completion_info = pr.summary
            await task.save()

        return {"status": "success", "message": "Pull Request accepted and applied"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error applying patch: {str(e)}")


@router.post("/{pr_id}/reject")
async def reject_pull_request(pr_id: str):
    pr = await PullRequest.get(pr_id)
    if not pr:
        raise HTTPException(status_code=404, detail="Pull Request not found")

    pr.status = PullRequestStatus.REJECTED
    await pr.save()
    return {"status": "success", "message": "Pull Request rejected"}
