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

"""Receiver for Gitea webhook deliveries that report PR/branch state.

The endpoint is called by Gitea (not a logged-in user), so it is authenticated
by an HMAC shared secret over the raw request body rather than a JWT.
"""

import hashlib
import hmac
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from api.git_hosting.branch_events import parse_pr_state_payload
from api.git_hosting.branch_notifier import PrStateNotifier
from core import config

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/git_hosting",
    tags=["git_hosting"],
)


def _verify_signature(raw_body: bytes, signature: Optional[str]) -> bool:
    """Verify the ``X-Gitea-Signature`` HMAC over the raw request body.

    When ``GITEA_WEBHOOK_SECRET`` is unset the check is skipped (development
    only) and a warning is logged so misconfiguration is visible.
    """
    secret = config.GITEA_WEBHOOK_SECRET
    if not secret:
        logger.warning(
            "GITEA_WEBHOOK_SECRET is not set; skipping webhook signature "
            "verification (development only)."
        )
        return True
    if not signature:
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/pipelines/{pipeline_id}/pr-state")
async def reconcile_pr_state(pipeline_id: str, request: Request):
    """Mirror a remote Gitea PR/branch state change onto local state.

    Accepts a Gitea ``push`` or ``pull_request`` payload, or a minimal
    normalised body. The pipeline is resolved by path ID (unknown → 404) and the
    event is authenticated via ``X-Gitea-Signature`` (HMAC over the raw body).
    """
    raw_body = await request.body()
    signature = request.headers.get("X-Gitea-Signature")
    if not _verify_signature(raw_body, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = json.loads(raw_body)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    event = parse_pr_state_payload(payload)
    if event is None:
        return JSONResponse(status_code=202, content={"status": "ignored"})

    notifier = PrStateNotifier()
    result = await notifier.on_pr_state(pipeline_id, event)

    if result.status == "not_found":
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if result.status == "mirrored":
        return {
            "status": "mirrored",
            "pipeline_id": result.pipeline_id,
            "branch": result.branch,
            "state": event.state,
            "commit_hash": result.commit_hash,
            "affected_task_ids": result.affected_task_ids,
        }

    # ignored, busy, sync_failed, commit_not_found — accepted but not mirrored.
    return JSONResponse(
        status_code=202,
        content={"status": result.status, "branch": result.branch},
    )
