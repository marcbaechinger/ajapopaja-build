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

"""Pending elaborated-spec proposal store for the SpecAgent.

A SpecAgent session is read-only and never writes ``task.spec`` directly.
Instead it finalizes by calling the terminal ``save_elaborated_spec`` tool,
which stores a :class:`SpecProposal` here. The UI fetches the outstanding
proposal, presents it for accept/reject, and only on accept is ``task.spec``
updated through the regular task update endpoint.

The store mirrors the DocBot preview cache (``api/docbot/cache.py``): a small
JSON file on disk keyed by task id, so an outstanding proposal survives a page
reload instead of living only in transient WebSocket state.
"""

import json
import logging
import os
from typing import Dict, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Cache file path (mirrors the DocBot preview cache convention).
CACHE_FILE = ".logs/specagent_proposals.json"


class SpecProposal(BaseModel):
    """An elaborated specification awaiting human accept/reject."""

    task_id: str
    pipeline_id: str
    spec_md: str
    rationale: str = ""


def _load_cache() -> Dict[str, dict]:
    if not os.path.exists(CACHE_FILE):
        return {}
    try:
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    except Exception as e:  # noqa: BLE001 - a corrupt cache must never crash
        logger.error(f"Failed to load specagent cache: {e}")
        return {}


def _save_cache(cache: Dict[str, dict]):
    try:
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w") as f:
            json.dump(cache, f, indent=2)
    except Exception as e:  # noqa: BLE001 - persistence is best-effort
        logger.error(f"Failed to save specagent cache: {e}")


async def set_proposal(task_id: str, proposal: SpecProposal):
    logger.info(f"SET SPEC PROPOSAL for task {task_id}")
    cache = _load_cache()
    cache[task_id] = proposal.model_dump()
    _save_cache(cache)


async def get_proposal(task_id: str) -> Optional[SpecProposal]:
    cache = _load_cache()
    data = cache.get(task_id)
    if data:
        logger.info(f"GET SPEC PROPOSAL for task {task_id}: FOUND")
        return SpecProposal(**data)
    return None


async def clear_proposal(task_id: str):
    logger.info(f"CLEAR SPEC PROPOSAL for task {task_id}")
    cache = _load_cache()
    if task_id in cache:
        del cache[task_id]
        _save_cache(cache)
