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

from typing import List, Dict
from core.queries import pipeline as pipeline_queries
from api.assistant.decorators import register_tool


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
