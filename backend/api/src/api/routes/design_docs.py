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

"""Read-only design-doc library endpoints for the pipeline UI.

The ``DesignDocLibraryDialog`` lists and reads the Markdown documents that live
under a pipeline's configured ``doc_root``. Both routes are read-only and only
ever touch files inside that directory (see
:mod:`core.utils.design_docs`).
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from api.auth import get_current_user
from core.models.models import (
    DesignDocContent,
    DesignDocListResponse,
    User,
)
from core.queries import pipeline as pipeline_queries
from core.utils import design_docs as design_docs_utils

router = APIRouter(
    prefix="/pipelines/{pipeline_id}/design-docs",
    tags=["design-docs"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=DesignDocListResponse)
async def list_design_docs(
    pipeline_id: str,
    q: Optional[str] = Query(
        None,
        max_length=200,
        description="Optional case-insensitive search over document paths and contents.",
    ),
    current_user: User = Depends(get_current_user),
):
    """List (and optionally search) the pipeline's Markdown design documents."""
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    documents, total = design_docs_utils.list_design_docs(pipeline, q)
    return DesignDocListResponse(documents=documents, total=total, query=q)


@router.get("/content", response_model=DesignDocContent)
async def get_design_doc_content(
    pipeline_id: str,
    path: str = Query(
        ...,
        min_length=1,
        description="Path of the document relative to the pipeline's doc_root.",
    ),
    current_user: User = Depends(get_current_user),
):
    """Return the raw Markdown of a single design document."""
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    return design_docs_utils.read_design_doc(pipeline, path)
