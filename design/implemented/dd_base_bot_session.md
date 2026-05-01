# Design Document: BaseBotSession

## 1. Purpose

`BaseBotSession` is a reusable foundation for autonomous agents that interact with an LLM via Ollama.  It encapsulates the common lifecycle of such agents – managing conversation history, translating registered tools into Ollama‑compatible function calls, executing those calls, and detecting termination.  By extracting this logic from `DocBotSession`, new agents (e.g., `CodeBot`, `TestBot`) can be added with minimal duplication.

## 2. Architecture

```text
 ┌─────────────────────┐
 │  BaseBotSession     │  (abstract base class)
 ├─────────────────────┤
 │  - pipeline_id      │  (identifier for the surrounding task pipeline)
 │  - task_id          │  (identifier for the specific task the bot is addressing)
 │  - client           │  (ollama.AsyncClient instance)
 │  - history          │  (list of chat messages)
 ├─────────────────────┤
 │  + run(initial_prompt, max_iterations=50)
 │  + _prepare_ollama_tools()
 │  + _execute_tool(name, args)
 │  + _find_tool_definition(name)
 │  + _is_tool_error(result)
 └─────────────────────┘
```

### 2.1 Responsibilities

| Responsibility | Implementation |
|----------------|----------------|
| **State Management** | Maintains `pipeline_id`, `task_id`, and conversation history. |
| **Ollama Integration** | Configures `AsyncClient` with host and API key; performs `chat()` calls. |
| **Tool Mapping** | Transforms `ToolDefinition` objects into the JSON schema expected by Ollama.  Injects `pipeline_id` and `task_id` parameters automatically. |
| **Autonomous Loop** | `run()` iteratively:
|  * Sends user prompt and conversation history.
|  * Receives assistant messages, optionally containing tool calls.
|  * If no tool calls are returned, pushes a predefined feedback message prompting further action.
|  * Executes each tool call via `_execute_tool`.
|  * Detects terminal tool calls (`is_terminal_tool`) to terminate the loop.
| **Error Handling** | Errors from tool execution are captured and marked as error strings.  If a terminal tool fails, the loop retries. |
| **Extensibility Hooks** | Subclass implements:
|  * `get_system_instruction()` – system prompt.
|  * `get_tools()` – list of available tools.
|  * `is_terminal_tool(tool_name)` – whether a tool call ends the session. |

## 3. Integration with DocBotSession

`DocBotSession` now subclasses `BaseBotSession`:

```python
class DocBotSession(BaseBotSession):
    def get_system_instruction(self) -> str:
        return SYSTEM_INSTRUCTION

    def get_tools(self) -> List[ToolDefinition]:
        return docbot_registry.list_tools()

    def is_terminal_tool(self, tool_name: str) -> bool:
        return tool_name in ["update_ref_doc", "no_doc_update_needed"]
```

The subclass focuses solely on providing the domain‑specific system instruction, tool list, and terminal tool detection.  All loop control, tool execution, and history management remain in the base class.

## 4. Benefits

* **DRY** – eliminates duplicated chat‑loop logic across multiple agents.
* **Clear Separation** – domain logic lives in the subclass; core LLM orchestration lives in the base.
* **Easier Testing** – unit tests target `BaseBotSession` once and can be reused for new agents.
* **Future‑Proof** – adding a new autonomous bot only requires implementing the three abstract methods.

## 5. Usage Example

```python
# In a new agent, e.g., CodeBot
class CodeBotSession(BaseBotSession):
    def get_system_instruction(self):
        return "You are a code‑review bot…"

    def get_tools(self):
        return codebot_registry.list_tools()

    def is_terminal_tool(self, name):
        return name == "commit_code"

# Run
session = CodeBotSession(pipeline_id="123", task_id="456")
await session.run("Please review the following code change…")
```
