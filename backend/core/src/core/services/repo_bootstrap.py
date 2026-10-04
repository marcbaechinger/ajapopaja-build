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

"""Bootstrap remote pipeline repositories on server start.

Remote pipelines (those with a ``repo_uri``) keep their working copy in a
clone under ``config.REMOTE_WORKSPACES_ROOT``. That directory is not
necessarily persisted across container recreations, so after a restart the
clone can be missing and every read-only path (file browser, git status/log)
fails until something happens to trigger a lazy clone.

This service pre-warms those clones when the backend starts: for each remote
pipeline it clones the repo when the checkout is missing and otherwise leaves
the existing checkout completely untouched (a strictly read-only no-op).
Exactly one INFO log line is emitted per remote repo stating whether it was
cloned or already available.
"""

import logging

from core.models.models import RepoBootstrapStatus
from core.queries import pipeline as pipeline_queries
from core.utils import git_utils

logger = logging.getLogger(__name__)


async def bootstrap_remote_repos() -> None:
    """Ensure each remote pipeline's clone exists; clone when missing.

    Best-effort and defensive: it never raises, so it can be awaited from the
    FastAPI lifespan without risking startup. Each remote repository produces
    exactly one INFO log line; failures are logged and do not stop the
    remaining repositories.
    """
    try:
        pipelines = await pipeline_queries.get_all_pipelines()
    except Exception:
        logger.warning("Could not list pipelines for repo bootstrap", exc_info=True)
        return

    for pipeline in pipelines:
        if not pipeline.repo_uri:
            continue  # local pipeline: nothing to bootstrap
        try:
            status = git_utils.ensure_repo_present(pipeline)
        except Exception as exc:
            logger.warning(
                "Remote repo %s for pipeline '%s' could not be prepared: %s",
                pipeline.repo_uri,
                pipeline.name,
                exc,
            )
            continue
        if status is None:
            continue
        logger.info(
            "Remote repo %s for pipeline '%s': %s",
            pipeline.repo_uri,
            pipeline.name,
            (
                "cloned (was missing)"
                if status is RepoBootstrapStatus.CLONED
                else "already present (no action)"
            ),
        )
