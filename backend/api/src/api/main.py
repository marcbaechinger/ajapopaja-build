from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from core.db import init_db
from core.models.models import Pipeline, Task, TaskStatus
from typing import List
import os

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database
    await init_db()
    yield

app = FastAPI(title="Ajapopaja Build API", lifespan=lifespan)

# Enable CORS for development (allows Vite dev server to talk to FastAPI)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/pipelines", response_model=List[Pipeline])
async def get_pipelines():
    return await Pipeline.find_all().to_list()

@app.post("/pipelines", response_model=Pipeline)
async def create_pipeline(pipeline: Pipeline):
    await pipeline.insert()
    return pipeline

@app.get("/pipelines/{pipeline_id}/tasks", response_model=List[Task])
async def get_pipeline_tasks(pipeline_id: str):
    return await Task.find(Task.pipeline_id == pipeline_id).sort(+Task.order).to_list()

@app.post("/pipelines/{pipeline_id}/tasks", response_model=Task)
async def create_task(pipeline_id: str, task: Task):
    task.pipeline_id = pipeline_id
    await task.insert()
    return task

@app.patch("/tasks/{task_id}/status", response_model=Task)
async def update_task_status(task_id: str, status: TaskStatus):
    task = await Task.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.status = status
    await task.save()
    return task

# Serve SPA static files in production mode
# Expects 'frontend/dist' to exist after 'npm run build'
frontend_path = os.path.join(os.path.dirname(__file__), "../../../frontend/dist")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
