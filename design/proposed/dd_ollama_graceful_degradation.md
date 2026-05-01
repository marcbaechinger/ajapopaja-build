# Design Document: Sanitize for Environment Without Ollama

## 1. Objective
Several key features of Ajapopaja Build (AI Assistant, DocBot) depend on an Ollama server. We want to ensure that if Ollama is not available (no GPU, no account, or no internet), the application degrades gracefully instead of showing errors or confusing the user with non-functional buttons.

## 2. Proposed Changes

### 2.1. Backend Changes

#### 2.1.1. Shared Ollama Utility (`backend/api/src/api/ollama_utils.py`)
Create a utility function to centralize the check for Ollama availability. This avoids duplicating the `AsyncClient.list()` logic and makes it reusable across the API and MCP tools.

```python
async def is_ollama_available() -> bool:
    """Checks if Ollama is reachable and responsive."""
    # ... logic using ollama.AsyncClient(host=config.OLLAMA_HOST).list() ...
```

#### 2.1.2. MCP Tools (`backend/mcp/src/ajapopaja_mcp/tools.py`)
Update the `complete_task` tool to check for Ollama availability before triggering the `DocBotManager`. If Ollama is missing, DocBot will be skipped with a log message.

```python
if await is_ollama_available():
    asyncio.create_task(DocBotManager.process_completed_task(task))
else:
    logger.info("Ollama not available; skipping DocBot session for task.")
```

#### 2.1.3. System Health Route (`backend/api/src/api/routes/system.py`)
Update the `/system/health` route to use the centralized `is_ollama_available` utility.

### 2.2. Frontend Changes

#### 2.2.1. System Client (`frontend/src/core/clients/SystemClient.ts`)
Add a helper method `isOllamaAvailable(): Promise<boolean>` to the `SystemClient` that parses the health check response.

#### 2.2.2. Graceful UI Degradation (`DashboardView.ts`, `PipelineDetailView.ts`)
Update the views to check for Ollama availability during the `mount()` phase. If Ollama is unavailable:
- The "Assistant" button in the header should be hidden OR disabled with a tooltip explaining that Ollama is required.
- **Preference**: We will hide the button if Ollama is missing to keep the UI clean.

```typescript
// Example in mount()
this.ollamaAvailable = await this.context.systemClient.isOllamaAvailable();
if (!this.ollamaAvailable) {
    this.container.querySelector('[data-action-click="toggle_assistant"]')?.classList.add('hidden');
}
```

## 3. Verification Plan

### 3.1. Manual Verification (Ollama Missing)
1.  Stop any local Ollama server.
2.  Set `OLLAMA_HOST=http://localhost:9999` (non-existent).
3.  Open the SPA Dashboard.
4.  **Expectation**: The "Assistant" button is NOT visible in the header.
5.  Complete a task via an MCP tool.
6.  **Expectation**: No error occurs, and logs show "Ollama not available; skipping DocBot".

### 3.2. Manual Verification (Ollama Available)
1.  Start local Ollama server.
2.  Open the SPA Dashboard.
3.  **Expectation**: The "Assistant" button IS visible and functional.
4.  Complete a task.
5.  **Expectation**: DocBot is triggered (logs show "Starting DocBot session").

### 3.3. Automated Testing
1.  **Backend**: Add a test in `backend/tests/test_system.py` (if it exists) or similar to mock `is_ollama_available` returning `False` and verify the `/system/health` response.
2.  **MCP**: Add a unit test to verify `complete_task` behavior when Ollama is unavailable.
