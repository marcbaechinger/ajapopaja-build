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

import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Optional, Union

from fastapi import (
    APIRouter,
    FastAPI,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastmcp.utilities.lifespan import combine_lifespans
from jose import JWTError, jwt

from ajapopaja_mcp.server import mcp
from api.assistant.ws_handler import register_assistant_handlers
from api.auth import ALGORITHM, SECRET_KEY, get_current_user_from_token
from api.gemini_executor import GeminiExecutor
from api.routes.auth import router as auth_router
from api.routes.docbot import router as docbot_router
from api.routes.editor_commands import router as editor_router
from api.reviewbot.router import router as reviewbot_router
from api.archbot.router import router as archbot_router
from api.routes.pipeline import router as pipeline_router
from api.routes.system import router as system_router
from api.routes.task import pipeline_task_router, task_router
from api.websocket_manager import manager
from core import __version__, config
from core.db import init_db
from core.exceptions import (
    AjapopajaError,
    EntityNotFoundError,
    ValidationError,
    VersionMismatchError,
)

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
        # Matches 'token=' followed by any non-whitespace, non-ampersand, non-quote char
        return re.sub(r"token=[^& \n\"]+", "token=[REDACTED]", text)


# Apply redaction filter to uvicorn loggers
for logger_name in ["uvicorn.access", "uvicorn.error"]:
    logging.getLogger(logger_name).addFilter(TokenRedactionFilter())


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application starting up...")
    logger.info("Initializing database...")
    await init_db()
    register_assistant_handlers()
    yield
    logger.info("Shutting down Gemini executors...")
    GeminiExecutor.stop_all()


# Create MCP ASGI app
# We use path="/" because it's mounted at /mcp in the main app
# FastMCP by default uses /mcp, which would lead to /mcp/mcp
mcp_app = mcp.http_app(path="/")


async def mcp_auth_middleware(scope, receive, send):
    """ASGI middleware to authenticate MCP requests."""
    if scope["type"] != "http":
        await mcp_app(scope, receive, send)
        return

    # Check if authentication is enabled
    if not config.MCP_AUTHENTICATION_ENABLED:
        await mcp_app(scope, receive, send)
        return

    # Allow OPTIONS for CORS
    if scope["method"] == "OPTIONS":
        await mcp_app(scope, receive, send)
        return

    # Extract token
    token = None
    # 1. Check Authorization header
    for name, value in scope.get("headers", []):
        if name == b"authorization":
            auth_val = value.decode("utf-8")
            if auth_val.startswith("Bearer "):
                token = auth_val[7:]
            break

    # 2. Check query parameter if header not found
    if not token:
        query_string = scope.get("query_string", b"").decode("utf-8")
        params = dict(re.findall(r"([^=&]+)=([^&]*)", query_string))
        token = params.get("token")

    user = await get_current_user_from_token(token)
    if not user:
        logger.warning(
            f"MCP auth failed for {scope['method']} {scope['path']}. "
            f"Token present: {bool(token)}"
        )
        # Return 401 Unauthorized
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                ],
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": b'{"detail": "Unauthorized: Valid token required for MCP"}',
            }
        )
        return

    await mcp_app(scope, receive, send)


app = FastAPI(
    title="Ajapopaja Build API", lifespan=combine_lifespans(lifespan, mcp_app.lifespan)
)

# Map MCP endpoints explicitly using mount to handle everything under /mcp
# Use mcp_auth_middleware as the ASGI app (receives scope, receive, send)
app.mount("/mcp", mcp_auth_middleware)

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


@api_router.get("/version")
async def version():
    return {"version": os.environ.get("APP_VERSION", __version__)}


api_router.include_router(pipeline_router)
api_router.include_router(task_router)
api_router.include_router(pipeline_task_router)
api_router.include_router(auth_router)
api_router.include_router(system_router)
api_router.include_router(docbot_router)
api_router.include_router(editor_router)
api_router.include_router(reviewbot_router)
api_router.include_router(archbot_router)

app.include_router(api_router)

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
