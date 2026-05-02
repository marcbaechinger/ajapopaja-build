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

import json
import logging
import os
from typing import Dict, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Cache file path
CACHE_FILE = ".logs/docbot_previews.json"


class DocBotPreview(BaseModel):
    task_id: str
    pipeline_id: str
    diff: str
    commit_msg: str
    file_path: str
    filename: str


def _load_cache() -> Dict[str, dict]:
    if not os.path.exists(CACHE_FILE):
        return {}
    try:
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load docbot cache: {e}")
        return {}


def _save_cache(cache: Dict[str, dict]):
    try:
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w") as f:
            json.dump(cache, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save docbot cache: {e}")


async def set_preview(task_id: str, preview: DocBotPreview):
    logger.info(f"SET PREVIEW for task {task_id}")
    cache = _load_cache()
    cache[task_id] = preview.model_dump()
    _save_cache(cache)


async def get_preview(task_id: str) -> Optional[DocBotPreview]:
    logger.info(f"GET PREVIEW for task {task_id}")
    cache = _load_cache()
    data = cache.get(task_id)
    if data:
        logger.info(f"GET PREVIEW for task {task_id}: FOUND")
        return DocBotPreview(**data)

    logger.warning(
        f"GET PREVIEW for task {task_id}: NOT FOUND. Cache keys: {list(cache.keys())}"
    )
    return None


async def clear_preview(task_id: str):
    logger.info(f"CLEAR PREVIEW for task {task_id}")
    cache = _load_cache()
    if task_id in cache:
        del cache[task_id]
        _save_cache(cache)
        logger.info(f"CLEAR PREVIEW for task {task_id}: DELETED")
    else:
        logger.warning(f"CLEAR PREVIEW for task {task_id}: NOT FOUND")
