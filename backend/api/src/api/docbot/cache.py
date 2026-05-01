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

from typing import Dict, Optional

from pydantic import BaseModel


class DocBotPreview(BaseModel):
    task_id: str
    pipeline_id: str
    diff: str
    commit_msg: str
    file_path: str
    filename: str


# In-memory cache: task_id -> DocBotPreview
_preview_cache: Dict[str, DocBotPreview] = {}


def set_preview(task_id: str, preview: DocBotPreview):
    _preview_cache[task_id] = preview


def get_preview(task_id: str) -> Optional[DocBotPreview]:
    return _preview_cache.get(task_id)


def clear_preview(task_id: str):
    if task_id in _preview_cache:
        del _preview_cache[task_id]
