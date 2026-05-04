# Design Document: Conversation Logging in BaseBotSession

## 1. Purpose

`BaseBotSession` now maintains a structured **conversation log** that records each turn of an autonomous bot session. The log captures user prompts, assistant replies, individual tool executions, and associated metadata. The design enables analytics, auditing, and debugging without inspecting raw chat history.

## 2. Data Model

### 2.1 `ConversationTurn`

The log stores objects of type `ConversationTurn`, defined in `api/bot/conversation.py`.

```python
@dataclass
class ConversationTurn:
    turn_id: int
    timestamp: datetime
    role: str            # "user", "assistant", "tool", or "system"
    content: str         # Truncated raw text (max 120 characters)
    tool_name: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    tool_result: Optional[Any] = None
    success: Optional[bool] = None
```

* `turn_id` is an incrementing integer for order.
* `timestamp` records the instant the turn was created.
* `content` is truncated to keep logs lightweight.
* `tool_args`, `tool_result`, and `success` are populated only for `role="tool"` turns.

### 2.2 Truncation & Pruning

Large or complex values are shortened to prevent unbounded growth:

* Text > 120 chars is cut off and appended with `...`.
* Strings > 100 chars are shortened to 100 chars.
* Lists are replaced with a descriptive placeholder like `[list:int:5]`.
* Dictionaries are shallow‑pruned; non‑primitive values become `[object]`.

These rules are implemented by `shorten_content` and `prune_value`.

## 3. Logging Mechanism

`BaseBotSession` now exposes:

* `self.conversation_log: List[ConversationTurn]` – an in‑memory list.
* `_log_turn(turn: ConversationTurn)` – appends to the list and, if
  `BASEBOT_LOG_ENABLED`, appends the turn to `logs/<task_id>/__log.jsonl` in JSONL format.
* `get_summary_stats()` – returns aggregate metrics:
  ```json
  {
    "total_turns": 42,
    "num_tool_calls": 10,
    "success_rate": 0.8
  }
  ```

Logging points are inserted:

* After user prompt (role="user").
* After each assistant message (role="assistant").
* After each tool execution (role="tool").
* After any generated feedback or warning (role="user").

## 4. Persistence

When the configuration flag `BASEBOT_LOG_ENABLED` is `true`, every call to `_log_turn` appends the current turn to disk. The log file uses **JSON Lines (JSONL)** format, where each line is a valid JSON object. This ensures efficient $O(1)$ persistence per turn. `datetime` objects are converted to ISO‑8601 strings. The directory structure is `logs/<task_id>/__log.jsonl` under the sandbox root (`SANDBOX_ROOT`). Errors during persistence are logged but never abort the session.

## 5. Benefits

* **Auditability** – a permanent record of every turn.
* **Analytics** – simple counters and success rates without re‑parsing chat.
* **Debugging** – easy to replay or inspect problematic tool calls.
* **Extensibility** – downstream systems can consume the log JSON.

## 6. Integration

* Existing bots (`CoderBot`, `ReviewBot`, etc.) automatically inherit the new logging behaviour by subclassing `BaseBotSession`.
* Unit tests (`test_conversation_log.py`) validate log creation and persistence.

---

*Author: Marc Baechinger*