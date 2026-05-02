# Manual: Building Autonomous Bots in Ajapopaja

This guide provides step-by-step instructions for building a new autonomous bot using the Ajapopaja infrastructure. Autonomous bots are specialized agents that use Large Language Models (LLMs) to perform specific tasks (like documentation updates or code reviews) by interacting with tools and navigating the codebase.

---

## 1. Core Architecture Overview

Ajapopaja provides a robust foundation for building autonomous agents:

- **`BaseBotSession`**: An abstract base class that manages the autonomous conversation loop, tool execution, and history.
- **`BotManager`**: A global sequential queue manager that ensures only one bot is running at a time to prevent resource contention.
- **`ToolRegistry`**: A utility for registering and describing Python functions as LLM-compatible tools.

---

## 2. Step-by-Step Implementation

### Step 1: Create the Module Structure

Create a new package under `backend/api/src/api/`. For a "TestBot", you would create:

```bash
backend/api/src/api/testbot/
├── __init__.py
├── registry.py    # Tool registry instance
├── tools.py       # Tool definitions
├── session.py     # Subclass of BaseBotSession
├── manager.py     # Logic to enqueue sessions
└── router.py      # FastAPI endpoints
```

### Step 2: Define and Register Tools

Bots interact with the world through tools.

1. **Existing Tools**: You can reuse tools from `api.assistant.tools` (e.g., `read_source_file`, `grep`).
2. **Specialized Tools**: Define tools specific to your bot in `tools.py`.
3. **Registration**: Use a dedicated `ToolRegistry` instance.

**Example (`registry.py`):**

```python
from api.assistant.tool_registry import ToolRegistry
testbot_registry = ToolRegistry()
```

**Example (`tools.py`):**

Use extensive doc string. The model sees this documentation. Give
precise advice around the semantics of the parameters.

IMPORTANT: Validate and sanitize the parameters passed in by the
LLM strictly and treat it as potentially non-sense or malicious.

Note: `pipeline_id` and `task_id` are injected by the base session when a
tool is called. The LLM does not need to provide them and hence they are
omitted in the doc string! This reduces possible frictions with fewer
parameters.

```python
from .registry import testbot_registry

async def save_test_report(pipeline_id: str, task_id: str, report_md: str):
    """
    Saves the test execution report. This is a terminal tool.

    Args:
      report_md: The report in markdown format
    Returns:
      A message telling about the result.
    """
    # Validate input variables from LLM like report_md

    # Implementation logic...
    return "Report saved successfully."

reviewbot_registry.register_tool(save_test_report)

# re-use common read only tools
testbot_registry.register_tool(tree)
testbot_registry.register_tool(read_source_file)
testbot_registry.register_tool(grep)
testbot_registry.register_tool(find)
```

**Tool re-use:** Tools of for instance the assistant can be reused. Look into
`backend/api/src/api/assistant/tools/search_tools.py` for reference.

**Decorator:** For convenience you can create a decorator to register tools. This
also allows to override the actual tool function with a tool name better
suited for the bot:

```python
def register_testbot_tool(
    name: Optional[str] = None,
    description: Optional[str] = None,
    tool_type: str = "read_only",
    parameters: Optional[Dict[str, Any]] = None,
):
    def decorator(func: Callable):
        testbot_registry.register_tool(
            func=func,
            name=name,
            description=description,
            tool_type=tool_type,
            parameters=parameters,
        )

        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)

        return wrapper

    return decorator

@register_testbot_tool(name="save_review")
def cool_tool_function(task_id: str, review_md: str):
  # implementation code ...
```

### Step 3: Implement the Session Class

Inherit from `BaseBotSession` and implement the abstract methods
(see `backend/api/src/api/bot/base_session.py`).

**Abstract Methods to Implement:**

- `get_system_instruction()`: Defines the bot's persona, rules, and goals.
- `get_initial_prompt()`: Generates the first user message, providing context (e.g., git diffs, task specs).
- `get_tools()`: Returns the list of tools from your registry.
- `is_terminal_tool(tool_name)`: Returns `True` for tools that should end the autonomous loop (e.g., `save_review`).

**Example (`session.py`):**

```python
class TestBotSession(BaseBotSession):
    def get_system_instruction(self) -> str:
        return "You are a Senior QA Engineer..."

    async def get_initial_prompt(self) -> str:
        # Fetch task details from database...
        return f"Please test the following changes: {diff}"

    def get_tools(self) -> List[ToolDefinition]:
        return testbot_registry.list_tools()

    def is_terminal_tool(self, tool_name: str) -> bool:
        return tool_name == "save_test_report"
```

Optionally override 'get_default_feedback' function to chose a custom feedback
message to keep the bot going in case it sends a text message instead of a tool
call.

### Step 4: Handle Lifecycle Events

Override `on_event` to broadcast WebSocket messages. This allows the frontend to show real-time progress (e.g., "Bot Analyzing...").

```python
async def on_event(self, event_name: str, payload: Optional[Dict[str, Any]] = None):
    if event_name == "bot_started":
        await manager.broadcast(WSMessage(type="TESTBOT_STARTED", payload={...}))
    elif event_name == "bot_completed":
        await manager.broadcast(WSMessage(type="TESTBOT_COMPLETED", payload={...}))
```

### Step 5: Integrate with BotManager

Create a manager class in `manager.py` that wraps the global `bot_manager.enqueue()`.

```python
from api.bot.manager import bot_manager

class TestBotManager:
    @staticmethod
    async def process_task(task: Task):
        session = TestBotSession(pipeline_id=str(task.pipeline_id), task_id=str(task.id))
        await bot_manager.enqueue(session)
```

### Step 6: Expose API Endpoints

Create a FastAPI router to trigger the bot from the UI. Register this router in `backend/api/src/api/main.py`.

```python
@router.post("/trigger/{task_id}")
async def trigger_testbot(pipeline_id: str, task_id: str):
    # Fetch task and validate...
    await TestBotManager.process_task(task)
    return {"status": "success"}
```

---

## 3. Conversation & Termination Model

The `BaseBotSession` implements an iterative loop:

1. **Iteration Start**: The LLM receives the history + system instruction + available tools.
2. **LLM Response**: The LLM can either return a text response or one or more tool calls.
3. **No Tool Calls**: If the LLM only returns text, `BaseBotSession` injects a prompt: *"Continue to analyze and then call the tools to finalize your task."* This prevents the bot from "hanging" or just chatting without taking action.
4. **Tool Execution**: Each tool call is executed. If a tool is marked as **terminal** (via `is_terminal_tool`), the loop terminates after all current tool calls are processed.
5. **Success Requirement**: If a terminal tool returns an error, the loop **continues**, forcing the LLM to fix the issue and try again. Therefore, it's worth creating meaningful exception messages for the bot.

---

## 4. Frontend Integration

To make your bot accessible in the UI:

1. **API Client**: Create a dedicated client (e.g., `TestBotClient.ts`) inheriting from `BaseClient`.
2. **AppContext**: Register the client in `AppContext.ts`.
3. **WebSocket**: Add listeners in `PipelineDetailView.ts` for your `STARTED` and `COMPLETED` events.
4. **UI Components**: Add buttons to `TaskItem.ts` to trigger the bot manually for relevant task states.

---

## 5. Summary Checklist

- [ ] Create folder structure.
- [ ] Initialize `ToolRegistry`.
- [ ] Define tools (ensure at least one is terminal).
- [ ] Import `tools` and `registry` in `__init__.py` (Critical for startup registration).
- [ ] Implement `Session` class with clear system instructions.
- [ ] Implement `Manager` and `Router`.
- [ ] Register router in `main.py`.
- [ ] Add unit tests for tools and session logic.
