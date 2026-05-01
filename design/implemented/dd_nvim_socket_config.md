# Design Doc: Configurable Neovim Socket Path

## 1. Purpose
The current Neovim‑related tools (`nvim_open_file`, `nvim_open_selection`, etc.) always reference the hard‑coded Unix socket
`/tmp/nvimsocket`.  
This document specifies how to make that socket path configurable via the environment variable `NVIM_SOCKET` (defaulting to
`/tmp/nvimsocket`).  The change must propagate through all components that query socket availability, including the tool
registry, the system health endpoint, and any unit tests.

## 2. High‑Level Changes

| Layer | File | What to change |
|-------|------|----------------|
| 2.1. **Core Availability Helper** | `backend/api/src/api/assistant/tools/nvim_tools.py` | 1. Add a `get_nvim_socket_path()` helper that reads `NVIM_SOCKET` (default `/tmp/nvimsocket`). <br>2. Modify `is_nvim_available()` to use the helper. <br>3. Cache the result to avoid repeated filesystem checks. |
| 2.2. **Tool Registration** | `backend/api/src/api/assistant/decorators.py` | Update `@register_tool` to accept an optional `is_available` parameter and forward it to the registry. |
| 2.3. **Tool Registry** | `backend/api/src/api/assistant/tool_registry.py` | Extend `ToolDefinition` with an `is_available: Callable[[], bool] = lambda: True`. <br>Modify `list_tools()` to filter tools by `is_available()`. |
| 2.4. **Health Endpoint** | `backend/api/src/api/routes/system.py` | Replace hard‑coded socket check with `is_nvim_available()`. Return `{"nvim_socket_available\": bool}` in the JSON response. |
| 2.5. **Unit Tests** | `backend/tests/test_nvim_socket_config.py` | 1. Test default path when `NVIM_SOCKET` is unset. <br>2. Test custom path when `NVIM_SOCKET` is set. <br>3. Verify `ToolRegistry.list_tools()` excludes `nvim_*` tools when socket is missing and includes them when it exists. |
| 2.6. **Documentation** | `design/implemented/dd_nvim_socket_config.md` | This design doc. |
| 2.7. **Optional – Runtime Re‑check** | `backend/api/src/api/routes/system.py` (or a new `/system/refresh` endpoint) | If desired, expose a health‑check that re‑reads the socket path without a server restart. |

## 3. Detailed Implementation Steps

### 3.1 `nvim_tools.py`
```python
import os
import socket
from functools import lru_cache

def get_nvim_socket_path() -> str:
    \"\"\"Return the Neovim Unix socket path.

    The path can be overridden via the NVIM_SOCKET environment variable.
    Defaults to '/tmp/nvimsocket'.
    \"\"\"
    return os.getenv(\"NVIM_SOCKET\", \"/tmp/nvimsocket\")

@lru_cache(maxsize=1)
def is_nvim_available() -> bool:
    \"\"\"Check whether the Neovim Unix socket exists and is a socket.\"\"\"
    path = get_nvim_socket_path()
    return os.path.exists(path) and socket.socket(fileno=os.open(path, os.O_RDONLY)).family == socket.AF_UNIX
```
- **Note:** The lru_cache ensures the check is performed only once per process; mimic the existing `is_ollama_available` pattern.

### 3.2 `decorators.py`
```python
def register_tool(*, is_available=lambda: True, **kwargs):
    \"\"\"
    Register a tool in the global ToolRegistry.
    Accepts an optional `is_available` callable that determines whether
    the tool should be exposed to the model.
    \"\"\"
    def decorator(fn):
        ToolRegistry.register_tool(
            name=fn.__name__,
            function=fn,
            description=kwargs.get(\"description\", \"\"),
            is_available=is_available
        )
        return fn
    return decorator
```

### 3.3 `tool_registry.py`
```python
class ToolDefinition:
    name: str
    function: Callable
    description: str
    is_available: Callable[[], bool] = lambda: True

class ToolRegistry:
    @classmethod
    def register_tool(cls, name, function, description=\"\", is_available=lambda: True):
        cls._registry[name] = ToolDefinition(name, function, description, is_available)

    @classmethod
    def list_tools(cls):
        return [tool for name, tool in cls._registry.items() if tool.is_available()]
```

### 3.4 `system.py`
```python
@router.get(\"/system\")
async def get_system_info():
    info = {\n        \"nvim_socket_available\": is_nvim_available(),
        # other health data...\n    }
    return JSONResponse(content=info)
```

### 3.5 Tests (`backend/tests/test_nvim_socket_config.py`)
```python
import os
import tempfile
import socket
import pytest
from backend.api.src/api/assistant/tools import nvim_tools
from backend.api.src/api/assistant/tool_registry import ToolRegistry

@pytest.fixture
def socket_path(tmp_path):
    sock_path = tmp_path / \"nvim.sock\"
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(str(sock_path))
    sock.listen()
    yield str(sock_path)
    sock.close()

def test_default_socket_path():
    os.environ.pop(\"NVIM_SOCKET\", None)
    assert nvim_tools.get_nvim_socket_path() == \"/tmp/nvimsocket\"

def test_custom_socket_path(socket_path):
    os.environ[\"NVIM_SOCKET\"] = socket_path
    assert nvim_tools.get_nvim_socket_path() == socket_path

def test_tool_registry_includes_nvim_tools_when_socket_present(socket_path):
    os.environ[\"NVIM_SOCKET\"] = socket_path
    assert any(t.name.startswith(\"nvim_\") for t in ToolRegistry.list_tools())

def test_tool_registry_excludes_nvim_tools_when_socket_absent():
    os.environ.pop(\"NVIM_SOCKET\", None)
    # Assuming no socket at default path
    assert not any(t.name.startswith(\"nvim_\") for t in ToolRegistry.list_tools())
```

## 4. Backward Compatibility & Roll‑back

- The default path remains `/tmp/nvimsocket`, so existing deployments continue to work unchanged.
- The change is additive; no code paths that previously relied on the hard‑coded string are removed.
- If the environment variable is set to an invalid path, the registry will simply hide the nvim tools until a valid socket appears.

## 5. Documentation & Deployment

1. Commit the updated files above.  
2. Update the `design` tree with this document (`design/implemented/dd_nvim_socket_config.md`).  
3. Run the full test suite to ensure no regressions.  
4. Deploy the new version; the system health endpoint will now report Neovim availability based on the configurable socket path.

---

**End of Design Doc**
