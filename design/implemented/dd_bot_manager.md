# Design Document: BotManager

## 1. Purpose

`BotManager` is a lightweight orchestration layer for autonomous bot sessions.  It accepts any object that implements the `BaseBotSession` interface, queues it, and guarantees that only one bot runs at a time.  By decoupling the execution strategy from the bot implementation, the system gains a single point of control for queuing, error handling, and resource availability checks.

## 2. Architecture

```
┌─────────────────────┐
│  BotManager          │  (singleton)
│  ────────────────── │
│  + enqueue(session) │  → add session to queue
│  + _process_queue() │  → sequentially execute sessions
└─────────────────────┘
        ▲          │
        │          ▼
  ┌─────────────────────┐
  │  BaseBotSession      │  (abstract base class)
  └─────────────────────┘
```

### 2.1 Key Components

| Component | Role |
|-----------|------|
| `BotManager` | Holds an `asyncio.Queue` of `BaseBotSession` instances and a background worker task that processes the queue. |
| `BaseBotSession` | Provides the `run()` coroutine that performs the LLM conversation loop. |
| `is_ollama_available()` | Utility that checks if the Ollama service is reachable; sessions are skipped if unavailable. |

### 2.2 Execution Flow

1. **Enqueue** – `BotManager.enqueue(session)` is called with a `BaseBotSession` instance. The method verifies Ollama availability; if unavailable, the session is discarded and a log entry is emitted.
2. **Queueing** – The session is placed on the internal `asyncio.Queue`.
3. **Worker Task** – If no worker is running, an `asyncio.create_task` starts `_process_queue()`.
4. **Sequential Processing** – `_process_queue()` loops until the queue is empty, pulling one session at a time and invoking `await session.run()`.
5. **Error Handling** – Exceptions during `run()` are caught, logged, and the session is marked as complete. The worker continues with the next queued session.
6. **Completion** – After processing a session, `queue.task_done()` signals completion, and a log entry records the finished state.

## 3. Interaction with BaseBotSession

`BaseBotSession` implements the core LLM chat loop, tool execution, and conversation state.  The manager merely passes control to the session’s `run()` method; it does not inspect or manipulate the session’s internal state.  This separation allows new bot types to be added without modifying the manager.

## 4. Benefits

* **Single‑Execution Guarantee** – By serializing sessions in a queue, the system prevents concurrent LLM calls that could exhaust resources or produce interleaved logs.
* **Transparent Failure Handling** – Exceptions are logged but do not block subsequent sessions.
* **Extensibility** – New bots only need to implement `BaseBotSession`; the manager automatically supports them.
* **Resource Awareness** – Skips execution when Ollama is unavailable, avoiding wasteful queuing.

## 5. Example Usage

```python
# Create a DocBotSession (subclass of BaseBotSession)
session = DocBotSession(pipeline_id="abc", task_id="123")

# Enqueue for execution
await bot_manager.enqueue(session)
```

The manager will schedule the session, run it to completion, and then proceed with the next queued session.
