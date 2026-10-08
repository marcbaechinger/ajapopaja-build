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

"""Read-only file-browser endpoints for a pipeline repository.

The router is a thin HTTP layer: filesystem and git logic lives in
:class:`core.services.file_browser.FileBrowserService` so it can be reused by
agent tools. Every endpoint is read-only and rooted at the pipeline's
workspace; absolute paths are never exposed to the client.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from api.auth import (
    RAW_FILE_TOKEN_TTL_SECONDS,
    create_raw_file_token,
    decode_raw_file_token,
    get_current_user,
)
from core.exceptions import EntityNotFoundError
from core.models.models import (
    DirectoryListing,
    FileContent,
    FileEntry,
    FileSearchResponse,
    User,
)
from core.queries import pipeline as pipeline_queries
from core.services.file_browser import (
    FileBrowserService,
    PathEscapeError,
    guess_media_type,
)
from core.services.file_search import FileSearchService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pipelines/{pipeline_id}/files", tags=["file-browser"])


class RawFileUrl(BaseModel):
    """A short-lived token that authorises a single raw file view."""

    token: str
    expires_in: int


def _resolve_file_or_http(pipeline, path: str):
    """Resolve a file, translating service errors into HTTP responses.

    The sync counterpart of :func:`_handle`, used by the raw-file endpoints
    (whose path resolution happens before a ``FileResponse`` is built).
    """
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


async def _handle(coro):
    """Translate service errors into HTTP responses without leaking paths."""
    try:
        return await coro
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
    except Exception:
        logger.exception("File browser request failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read the requested path",
        )


@router.get("/", response_model=DirectoryListing)
async def list_directory(
    pipeline_id: str,
    path: str = "",
    current_user: User = Depends(get_current_user),
):
    """List a directory. ``path=""`` is the repository root."""
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    return await _handle(FileBrowserService.list_directory(pipeline, path))


@router.get("/content", response_model=FileContent)
async def read_file(
    pipeline_id: str,
    path: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
):
    """Read a (text) file's content and metadata."""
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    return await _handle(FileBrowserService.read_file(pipeline, path))


@router.get("/meta", response_model=FileEntry)
async def get_file_meta(
    pipeline_id: str,
    path: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
):
    """Return metadata and git status for a single entry (refresh)."""
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    return await _handle(FileBrowserService.get_meta(pipeline, path))


@router.get("/search", response_model=FileSearchResponse)
async def search_files(
    pipeline_id: str,
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
):
    """Search filenames (and pathnames) in the pipeline repository."""
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    return await _handle(FileSearchService.search(pipeline, q, limit))


@router.post("/raw-url", response_model=RawFileUrl)
async def create_raw_file_url(
    pipeline_id: str,
    path: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
):
    """Mint a short-lived token to open ``path`` in the raw viewer.

    The path is validated up front (traversal, ``.git``, missing, directory)
    so failures surface immediately instead of in the new browser tab.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    _resolved, clean = _resolve_file_or_http(pipeline, path)
    return RawFileUrl(
        token=create_raw_file_token(current_user.username, pipeline_id, clean),
        expires_in=RAW_FILE_TOKEN_TTL_SECONDS,
    )


@router.get("/raw")
async def read_raw_file(
    pipeline_id: str,
    token: Optional[str] = Query(None),
):
    """Stream the full file named by a raw-file token.

    The token *is* the authentication and the file path is taken from the
    token, not the URL, so the link cannot be edited to read another file.
    """
    claims = decode_raw_file_token(token)
    if claims.pipeline_id != pipeline_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token does not match this pipeline",
        )

    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    resolved, _clean = _resolve_file_or_http(pipeline, claims.path)

    return FileResponse(
        resolved,
        media_type=guess_media_type(resolved.name),
        filename=resolved.name,
        content_disposition_type="inline",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "private, no-store",
        },
    )
