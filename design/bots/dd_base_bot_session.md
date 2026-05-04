# Design Document: BaseBotSession

## 1. Purpose

`BaseBotSession` is a reusable foundation for autonomous agents that interact with an LLM via Ollama. It encapsulates the common lifecycle of such agents – managing conversation history, translating registered tools into Ollama‑compatible function calls, executing those calls, and detecting termination. By extracting this logic from `DocBotSession`, new agents (e.g., `CodeBot`, `TestBot`) can be added with minimal duplication.

## 2. Architecture

```text
 ┌───────────────────────────────┐
 │      BaseBotSession           │  (abstract base class)
 ├───────────────────────────────┤
 │ - pipeline_id                 │  (identifier for the surrounding task pipeline)
 │ - task_id                     │  (identifier for the specific task the bot is addressing)
 │ - client                      │  (ollama.AsyncClient instance)
 │ - history                     │  (list of chat messages)
 ├───────────────────────────────┤
 │ + run(initial_prompt, max_iterations=50)
 │ + _prepare_ollama_tools()
 │ + _execute_tool(name, args)
 │ + _find_tool_definition(name)
 │ + _is_tool_error(result)
 │ + on_event(event_name, payload)   (optional hook)
 └───────────────────────────────┘
```

### 2.1 Responsibilities

#### **State Management**

Maintains `pipeline_id`, `task_id`, and conversation history.

#### **Ollama Integration**

Configures `AsyncClient` with host and API key; performs `chat()` calls.

#### **Tool Mapping**

Transforms `ToolDefinition` objects into the JSON schema expected by Ollama. Injects `pipeline_id` and `task_id` parameters automatically.

#### **Autonomous Loop**

`run()` iteratively:

* Sends user prompt and conversation history.
* Receives assistant messages, optionally containing tool calls.
* If no tool calls are returned, pushes a predefined feedback message prompting further action.
* Executes each tool call via `_execute_tool`.
* Detects terminal tool calls (`is_terminal_tool`) to terminate the loop.

#### **Error Handling**

Errors from tool execution are captured and marked as error strings. If a terminal tool fails, the loop retries.

#### **Extensibility Hooks**

Subclass implements:

* `get_system_instruction()` – system prompt.
* `get_tools()` – list of available tools.
* `is_terminal_tool(tool_name)` – whether a tool call ends the session.
* `on_event(event_name, payload)` – optional hook for lifecycle events. Default implementation does nothing.

### 2.2 Lifecycle Events

`BaseBotSession` emits two core lifecycle events that can be observed by subclasses or external systems:

| Event | Trigger | Typical Payload |
|-------|---------|-----------------|
| `bot_started` | Before the autonomous loop begins | `{}` |
| `bot_completed` | After the loop terminates or reaches maximum iterations | `{}` |

These events are raised via the `on_event` method, allowing concrete bot sessions to broadcast status updates (e.g., WebSocket messages) without coupling the base class to specific communication mechanisms.

### 2.3 Integration with DocBotSession

`DocBotSession` now subclasses `BaseBotSession` and implements the `on_event` hook to broadcast `DOCBOT_STARTED` and `DOCBOT_COMPLETED` messages over the websocket manager. The subclass focuses solely on providing the domain‑specific system instruction, tool list, and terminal tool detection. All loop control, tool execution, and history management remain in the base class.

```python
class DocBotSession(BaseBotSession):
    def get_system_instruction(self) -> str:
        return SYSTEM_INSTRUCTION

    def get_tools(self) -> List[ToolDefinition]:
        return docbot_registry.list_tools()

    def is_terminal_tool(self, tool_name: str) -> bool:
        return tool_name in ["update_ref_doc", "no_doc_update_needed"]

    async def on_event(self, event_name: str, payload: Optional[Dict[str, Any]] = None):
        if event_name == "bot_started":
            await manager.broadcast(
                WSMessage(
                    type="DOCBOT_STARTED",
                    payload={"pipeline_id": self.pipeline_id, "task_id": self.task_id},
                )
            )
        elif event_name == "bot_completed":
            await manager.broadcast(
                WSMessage(
                    type="DOCBOT_COMPLETED",
                    payload={
                        "pipeline_id": self.pipeline_id,
                        "task_id": self.task_id,
                        "result": self.session_result,
                    },
                )
            )
```

### 2.4 Benefits

* **DRY** – eliminates duplicated chat‑loop logic across multiple agents.
* **Clear Separation** – domain logic lives in the subclass; core LLM orchestration lives in the base.
* **Easier Testing** – unit tests target `BaseBotSession` once and can be reused for new agents.
* **Future‑Proof** – adding a new autonomous bot only requires implementing the three abstract methods and optionally the event hook.

## 3. Usage Example

```python
# In a new agent, e.g., CodeBot
class CodeBotSession(BaseBotSession):
    def get_system_instruction(self):
        return "You are a code‑review bot…"

    def get_tools(self):
        return codebot_registry.list_tools()

    def is_terminal_tool(self, name):
        return name == "commit_code"

# Run without a custom configuration
session = CodeBotSession(pipeline_id="123", task_id="456")
await session.run("Please review the following code change…")

# Run with a custom configuration
config = BaseBotSessionConfig(max_iterations=30)
session = CodeBotSession(pipeline_id="123", task_id="456", session_config=config)
await session.run("Please review the following code change…")
```

### 3.1 Constructor Signatures

```python
# BaseBotSession
def __init__(self, pipeline_id: str, task_id: str, session_config: Optional[BaseBotSessionConfig] = None)
```

The `session_config` argument is optional; when omitted, the default configuration defined by `BaseBotSessionConfig` is used.

---

### 3.2 BaseBotSessionConfig

```python
@dataclass
class BaseBotSessionConfig:
    model: str = config.OLLAMA_MODEL
    host: str = config.OLLAMA_HOST
    api_key: Optional[str] = config.OLLAMA_API_KEY
    max_iterations: int = 50
```

The configuration dataclass centralises all adjustable parameters of the autonomous loop, making it easier to customise behaviour per bot without subclassing the base class.
