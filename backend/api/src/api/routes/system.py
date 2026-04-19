import os
import stat
from fastapi import APIRouter
from pymongo import AsyncMongoClient
import ollama

router = APIRouter(prefix="/system", tags=["System"])

@router.get("/health")
async def system_health():
    results = {}
    
    # MongoDB Check
    try:
        mongodb_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
        client = AsyncMongoClient(mongodb_uri, serverSelectionTimeoutMS=2000)
        await client.admin.command('ping')
        results['mongodb'] = {"status": "ok", "details": "Connected"}
    except Exception as e:
        results['mongodb'] = {"status": "error", "details": str(e)}

    # Ollama Check
    try:
        client = ollama.AsyncClient()
        # Ensure we can list models as a health check
        await client.list()
        results['ollama'] = {"status": "ok", "details": "Connected"}
    except Exception as e:
        results['ollama'] = {"status": "error", "details": str(e)}
        
    # Nvim Socket Check
    nvim_socket_path = "/tmp/nvimsocket"
    try:
        if os.path.exists(nvim_socket_path):
            mode = os.stat(nvim_socket_path).st_mode
            if stat.S_ISSOCK(mode):
                results['nvim'] = {"status": "ok", "details": f"Socket found at {nvim_socket_path}"}
            else:
                results['nvim'] = {"status": "error", "details": f"File at {nvim_socket_path} is not a socket"}
        else:
            results['nvim'] = {"status": "error", "details": f"Socket not found at {nvim_socket_path}"}
    except Exception as e:
        results['nvim'] = {"status": "error", "details": str(e)}
        
    return results
