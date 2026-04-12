import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, APIRouter
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from core.db import init_db
from core.exceptions import (
    AjapopajaError,
    EntityNotFoundError,
    VersionMismatchError,
    ValidationError,
)
from api.routes.pipeline import router as pipeline_router
from api.routes.task import task_router, pipeline_task_router
from api.websocket_manager import manager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database
    logger.info("Initializing database...")
    await init_db()
    yield

app = FastAPI(title="Ajapopaja Build API", lifespan=lifespan)

# Global Exception Handlers
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

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health Check
@app.get("/api/health")
async def health():
    return {"status": "ok", "message": "Ajapopaja API is running"}

# WebSocket Endpoint - Root level
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    logger.info("Incoming WebSocket connection...")
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.handle_message(data, websocket)
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

# Register Routers
app.include_router(pipeline_router, prefix="/api")
app.include_router(task_router, prefix="/api")
app.include_router(pipeline_task_router, prefix="/api")

# Serve SPA static files - Mount last resort
frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../frontend/dist"))
if os.path.exists(frontend_path):
    logger.info(f"Serving SPA from: {frontend_path}")
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
else:
    logger.warning(f"Frontend path NOT found: {frontend_path}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
