from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from core.db import init_db
from core.exceptions import AjapopajaError, EntityNotFoundError, VersionMismatchError, ValidationError
from api.routes.pipeline import router as pipeline_router
from api.routes.task import task_router, pipeline_task_router
from api.websocket_manager import manager
import os
import logging

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database
    await init_db()
    yield

app = FastAPI(title="Ajapopaja Build API", lifespan=lifespan)

# Global Exception Handlers
@app.exception_handler(EntityNotFoundError)
async def entity_not_found_handler(request: Request, exc: EntityNotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc) or "Entity not found"})

@app.exception_handler(VersionMismatchError)
async def version_mismatch_handler(request: Request, exc: VersionMismatchError):
    return JSONResponse(status_code=409, content={"detail": str(exc) or "Optimistic concurrency conflict"})

@app.exception_handler(ValidationError)
async def validation_error_handler(request: Request, exc: ValidationError):
    return JSONResponse(status_code=422, content={"detail": str(exc) or "Validation error"})

@app.exception_handler(AjapopajaError)
async def generic_ajapopaja_error_handler(request: Request, exc: AjapopajaError):
    return JSONResponse(status_code=400, content={"detail": str(exc) or "Application error"})

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routers
app.include_router(pipeline_router)
app.include_router(task_router)
app.include_router(pipeline_task_router)

# WebSocket Endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.handle_message(data, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

# Serve SPA static files in production mode
frontend_path = os.path.join(os.path.dirname(__file__), "../../../frontend/dist")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
