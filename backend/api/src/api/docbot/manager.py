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

import git

from core.models.models import Task
from core.queries import pipeline as pipeline_queries

from .session import DocBotSession

logger = logging.getLogger(__name__)


class DocBotManager:
    @staticmethod
    async def process_completed_task(task: Task):
        """
        Gathers context for a completed task and triggers an autonomous DocBot session.
        """
        if not task.commit_hash:
            logger.warning(
                f"Task {task.id} completed without a commit hash. Skipping DocBot."
            )
            return

        pipeline = await pipeline_queries.get_pipeline_by_id(task.pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            logger.error(
                f"Pipeline {task.pipeline_id} not found or has no workspace path."
            )
            return

        try:
            repo = git.Repo(pipeline.workspace_abs_path)
            diff = repo.git.show(task.commit_hash)
        except Exception as e:
            logger.error(f"Failed to get git diff for commit {task.commit_hash}: {e}")
            return

        initial_prompt = f"""
I have completed a task in the pipeline '{pipeline.name}' (ID: {pipeline.id}).

TASK DETAILS:
- Title: {task.title}
- Description: {task.description or "N/A"}
- Spec: {task.spec or "N/A"}
- Design Doc: {task.design_doc or "N/A"}
- Completion Summary: {task.completion_info or "N/A"}
- Commit Hash: {task.commit_hash}

GIT DIFF:
```diff
{diff}
```

Please analyze if this change requires an update to the reference
documentation in the 'design/' directory.
"""

        logger.info(f"Starting DocBot session for task {task.id}")
        session = DocBotSession()
        try:
            await session.run(initial_prompt)
        except Exception as e:
            logger.error(f"DocBot session failed for task {task.id}: {e}")
