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

import os
import logging
import re
from contextlib import asynccontextmanager
from typing import Optional, Union
from fastapi import (
    FastAPI,
    Request,
    WebSocket,
    WebSocketDisconnect,
    APIRouter,
    Query,
    status,
)
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.routing import Route
from jose import JWTError, jwt

from core.db import init_db
from core.exceptions import (
    AjapopajaError,
    EntityNotFoundError,
    VersionMismatchError,
    ValidationError,
)
from api.routes.pipeline import router as pipeline_router
from api.routes.task import task_router, pipeline_task_router
from api.routes.auth import router as auth_router
from api.websocket_manager import manager
from api.auth import SECRET_KEY, ALGORITHM
from api.gemini_executor import GeminiExecutor
from fastmcp.utilities.lifespan import combine_lifespans
from ajapopaja_mcp.server import mcp

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TokenRedactionFilter(logging.Filter):
    """Filter to redact 'token' query parameter from log messages."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self._redact(record.msg)
        if record.args:
            new_args = []
            for arg in record.args:
                if isinstance(arg, str):
                    new_args.append(self._redact(arg))
                else:
                    new_args.append(arg)
            record.args = tuple(new_args)
        return True

    def _redact(self, text: str) -> str:
        # Redacts 'token=...' from URLs or strings
        # Matches 'token=' followed by any non-whitespace, non-ampersand, non-quote characters
        return re.sub(r"token=[^& \n\"]+", "token=[REDACTED]", text)


# Apply redaction filter to uvicorn loggers
for logger_name in ["uvicorn.access", "uvicorn.error"]:
    logging.getLogger(logger_name).addFilter(TokenRedactionFilter())


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    await init_db()
    yield
    logger.info("Shutting down Gemini executors...")
    GeminiExecutor.stop_all()


# Create MCP ASGI app with internal path at root
mcp_app = mcp.http_app(path="/")

app = FastAPI(
    title="Ajapopaja Build API", lifespan=combine_lifespans(lifespan, mcp_app.lifespan)
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Exception Handlers
@app.exception_handler(EntityNotFoundError)
async def entity_not_found_handler(request: Request, exc: EntityNotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(VersionMismatchError)
async def version_mismatch_handler(request: Request, exc: VersionMismatchError):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(ValidationError)
async def validation_error_handler(request: Request, exc: ValidationError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(AjapopajaError)
async def generic_ajapopaja_error_handler(request: Request, exc: AjapopajaError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


# Surgical raw ASGI adapter for /mcp without trailing slash to avoid 405/307 issues
# Using a class-based ASGI application ensures Starlette doesn't wrap it in its
# function-to-response converter, which resolves both the TypeError and the
# "Unexpected ASGI message" conflict.
class MCPSlashlessRouter:
    async def __call__(self, scope, receive, send):
        # Proxy to mcp_app by stripping the path (mcp_app expects /)
        scope["path"] = "/"
        scope["raw_path"] = b"/"
        await mcp_app(scope, receive, send)


# We use the Starlette Route directly and add it to the app's router
app.router.routes.append(
    Route(
        "/mcp",
        MCPSlashlessRouter(),
        methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    )
)


# Root level WebSocket - Matches BEFORE routers and BEFORE static mount
@app.websocket("/ws/{client_id}")
async def websocket_endpoint(
    websocket: WebSocket, client_id: str, token: Optional[str] = Query(None)
):
    logger.info(f"WS connection attempt: {client_id}")

    if not token:
        logger.warning(f"WS connection rejected: No token for {client_id}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: Union[str, None] = payload.get("sub")
        if username is None:
            logger.warning(
                f"WS connection rejected: Invalid token payload for {client_id}"
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except JWTError as e:
        logger.warning(f"WS connection rejected: JWT error for {client_id}: {e}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    await manager.add_connection(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.handle_message(data, websocket)
    except WebSocketDisconnect:
        logger.info(f"WS disconnected: {client_id}")
        manager.disconnect(websocket, client_id)
    except Exception as e:
        logger.error(f"WS error for {client_id}: {e}")
        manager.disconnect(websocket, client_id)


# API Router for all other endpoints
api_router = APIRouter(prefix="/api")


@api_router.get("/health")
async def health():
    return {"status": "ok", "message": "Ajapopaja API is running"}


api_router.include_router(pipeline_router)
api_router.include_router(task_router)
api_router.include_router(pipeline_task_router)
api_router.include_router(auth_router)

app.include_router(api_router)

# Mount MCP server at /mcp (handles /mcp/ and subpaths)
app.mount("/mcp", mcp_app)

# Serve SPA static files - Mount last resort
frontend_path = os.environ.get("FRONTEND_DIST_PATH")
if not frontend_path:
    # Fallback to local dev path
    frontend_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../../../frontend/dist")
    )

if os.path.exists(frontend_path):
    logger.info(f"Serving SPA from: {frontend_path}")
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
else:
    logger.warning(f"Frontend path NOT found: {frontend_path}")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
