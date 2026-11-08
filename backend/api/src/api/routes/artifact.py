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

"""REST endpoints for a pipeline's single, declared build artifact.

Metadata is served as JSON, while the artifact bytes are streamed from a
short-lived, pipeline- and path-bound download token. The actual filesystem and
git work is delegated to :mod:`core.services.artifact` and
:class:`core.services.file_browser.FileBrowserService`, so this router only adds
the HTTP/auth layer.
"""

import logging
from typing import Any, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from api.auth import (
    ARTIFACT_TOKEN_TTL_SECONDS,
    create_artifact_token,
    decode_artifact_token,
    get_current_user,
)
from core.exceptions import EntityNotFoundError
from core.models.models import (
    BuildArtifactInfo,
    BuildArtifactSpec,
    Pipeline,
    User,
)
from core.queries import pipeline as pipeline_queries
from core.services.artifact import get_artifact_info
from core.services.file_browser import (
    FileBrowserService,
    PathEscapeError,
    guess_media_type,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pipelines/{pipeline_id}/artifact", tags=["artifact"])


class ArtifactDownloadToken(BaseModel):
    """Response for minting a short-lived artifact download token."""

    token: str
    expires_in: int


class ArtifactInfoResponse(BuildArtifactInfo):
    """Metadata response including the pipeline id and configured flag.

    ``BuildArtifactInfo`` is the shared core metadata model. These additional
    fields are specific to the REST representation (see the design's response
    example) and make it explicit whether a pipeline has declared an artifact
    at all.
    """

    pipeline_id: Optional[str] = None
    configured: bool = False


def _artifact_spec(pipeline: Pipeline) -> Optional[BuildArtifactSpec]:
    """Return the pipeline's validated artifact declaration, if any.

    Pipeline documents normally carry a :class:`BuildArtifactSpec`, but tests
    and lightweight callers may use a plain dict or duck-typed object. Treat any
    object without a usable ``path`` as "not configured".
    """
    spec = getattr(pipeline, "build_artifact", None)
    if spec is None:
        return None
    if isinstance(spec, BuildArtifactSpec):
        return spec
    if isinstance(spec, dict):
        return BuildArtifactSpec(**spec)

    path = getattr(spec, "path", None)
    if not isinstance(path, str):
        return None

    def _text(value: Any) -> Optional[str]:
        if not isinstance(value, str):
            return None
        stripped = value.strip()
        return stripped or None

    return BuildArtifactSpec(
        path=path,
        label=_text(getattr(spec, "label", None)),
        description=_text(getattr(spec, "description", None)),
        media_type=_text(getattr(spec, "media_type", None)),
    )


def _resolve_artifact_or_http(pipeline: Pipeline, path: str):
    """Resolve an artifact path, translating service errors into HTTP errors."""
    try:
        return FileBrowserService.resolve_file(pipeline, path)
    except EntityNotFoundError:
        raise
    except PathEscapeError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except IsADirectoryError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path is a directory, not a file",
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Path not found"
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        ) from e


async def _artifact_info_response(
    pipeline_id: str,
    pipeline: Pipeline,
    *,
    include_hash: bool,
) -> ArtifactInfoResponse:
    """Compute metadata and add the REST-only pipeline/configured fields."""
    info = get_artifact_info(pipeline, include_hash=include_hash)
    # ``BuildArtifactInfo`` is awaitable to support both sync and async callers;
    # tests may also substitute an async service function.
    if hasattr(info, "__await__"):
        info = await info

    data = info if isinstance(info, dict) else info.model_dump()
    return ArtifactInfoResponse(
        **data,
        pipeline_id=pipeline_id,
        configured=_artifact_spec(pipeline) is not None,
    )


@router.get("", response_model=ArtifactInfoResponse)
@router.get("/", response_model=ArtifactInfoResponse, include_in_schema=False)
async def get_build_artifact(
    pipeline_id: str,
    include_hash: bool = Query(True),
    current_user: User = Depends(get_current_user),
):
    """Return live metadata/fingerprint for the pipeline's build artifact.

    ``include_hash=false`` skips the (potentially expensive) SHA-256 pass and
    lets a caller poll ``size``/``modified_at`` cheaply first.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    return await _artifact_info_response(
        pipeline_id, pipeline, include_hash=include_hash
    )


@router.post("/token", response_model=ArtifactDownloadToken)
async def create_download_token(
    pipeline_id: str,
    current_user: User = Depends(get_current_user),
):
    """Mint a short-lived token that authorises downloading the artifact.

    The path is validated up front so an invalid/missing artifact surfaces
    immediately instead of when the browser follows the download link.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    spec = _artifact_spec(pipeline)
    if spec is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No build artifact configured for this pipeline",
        )

    _resolved, clean = _resolve_artifact_or_http(pipeline, spec.path)
    return ArtifactDownloadToken(
        token=create_artifact_token(pipeline_id, clean),
        expires_in=ARTIFACT_TOKEN_TTL_SECONDS,
    )


@router.get("/download")
async def download_build_artifact(
    pipeline_id: str,
    token: Optional[str] = Query(None),
):
    """Stream the configured artifact file named by an artifact token.

    The token is the authentication and carries both the pipeline id and the
    expected path. The endpoint only ever serves
    ``pipeline.build_artifact.path``; a token can therefore never be repurposed
    to read an arbitrary workspace file.
    """
    claims = decode_artifact_token(token)
    if claims.pipeline_id != pipeline_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token does not match this pipeline",
        )

    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    spec = _artifact_spec(pipeline)
    if spec is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No build artifact configured for this pipeline",
        )
    if claims.path != spec.path:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token does not match this artifact",
        )

    resolved, _clean = _resolve_artifact_or_http(pipeline, spec.path)
    media_type = spec.media_type or guess_media_type(resolved.name)
    return FileResponse(
        resolved,
        media_type=media_type,
        headers={
            # Only the basename is exposed, never the absolute filesystem path.
            "Content-Disposition": (
                f"attachment; filename*=UTF-8''{quote(resolved.name)}"
            ),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "private, no-store",
        },
    )
