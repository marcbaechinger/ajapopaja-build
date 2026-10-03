# Design Document: One-Shot AI Prompts (`dd_one_shot_ai.md`)

## 1. Purpose

Today the UI offers "quick prompt" actions that simply copy a pre-built prompt
to the clipboard (`QuickPromptButton.ts`) and let the user paste it into an
external chat. That works, but it forces the user to leave the dashboard and
manually hand the context to a model.

This document proposes a general **one-shot AI prompt** infrastructure: small
UI helpers (buttons) that, without any verbal prompting, generate a prompt on
the server from a **prompt template** populated with a **context data object**,
send it to AI (Ollama), and stream the response back over the existing WebSocket
so the UI can present, accept or reject the result in place.

The prime example is an **"Elaborate"** button on the `Task.spec` field:

1. The user types a quick dot-list into `Task.spec` and saves the task.
2. The user clicks **Elaborate**.
3. The UI sends a one-shot request for prompt `task_elaborate_spec` with a JSON
   context (task + pipeline id and their current data).
4. The backend looks up and renders the `task_elaborate_spec` template with the
   context object.
5. The rendered prompt is sent to Ollama asynchronously.
6. The response comes back, is optionally transformed by a hook, and is pushed
   to the client over the WebSocket.
7. The client checks whether the referenced pipeline/task is still shown in the
   UI, and presents the result inline with **accept**/**reject**.

We want this to be a **framework**, not a one-off: arbitrary prompt IDs with
arbitrary context data travel from the UI to the server, get rendered against a
template, execute against AI, and come back — all driven by a single entity on
both ends, with hooks for transforming/intercepting at each stage.

---

## 2. Core Entities

The whole feature is driven by a single shared concept on both ends: the
**prompt ID** plus the **context data object**. Everything else is derived.

| Entity | Where | Description |
|---|---|---|
| `promptId` (e.g. `task_elaborate_spec`) | frontend + backend | Unique identifier of the one-shot action. It names both the *template* on the server and the *rendering/placement* logic in the UI. |
| `context` | frontend → backend | Free-form JSON object (`dict[str, Any]`) with whatever data the template/hooks need (e.g. `taskId`, `pipelineId`, current `spec`). |
| Prompt **template** | backend | A named, parameterised text template stored in a template library. Rendered with the context to produce the final prompt sent to AI. |
| Prompt **registry** | backend + frontend | Maps `promptId` → metadata (template ref) and registered **hooks**. |
| **Hook** | backend + frontend (optional) | A callable registered for a prompt ID that can transform the context, the rendered prompt, or the AI output before it is sent forward. |
| `runId` | both | A UUID identifying a single one-shot execution, used to correlate the async request with its response and for logging/interception. |

### 2.1 Prompt template library (backend)

Templates live in a dedicated directory, one file per prompt ID:

```
backend/api/src/api/oneprompt/templates/
    task_elaborate_spec.prompt
    task_clarify_design.prompt
    ...
```

A template file has a small YAML front-matter header (reused metadata) followed
by the body. Body is rendered with the standard-library `string.Template`
(`$identifier` and `${...}` placeholders) so we avoid adding a heavy dependency;
if richer control flow is later required we can swap the renderer for Jinja2
behind the same interface.

```yaml
---
id: task_elaborate_spec
label: Elaborate
title: Expand the task specification from a dot-list into a full spec
description: Given the pipeline context and the current spec, produce an expanded,
  well-structured task specification.
model: ${ONE_PROMPT_OLLAMA_MODEL}
accept_label: Accept
reject_label: Reject
---
You are helping to elaborate the specification of a task in the "Ajapopaja
Build" pipeline manager.

Pipeline: ${pipeline_name} (id ${pipeline_id})
Task title: ${task_title}
Current specification:

"""${task_spec}"""

Rewrite and expand the specification above into clear, unambiguous, actionable
requirements while preserving the intent. Keep Markdown formatting. Do not
invent scope beyond what the current spec implies.
```

`${ONE_PROMPT_OLLAMA_MODEL}` etc. are resolved by the renderer from a supplied
resolver that checks (in order) the context object, then environment
configuration. When `ONE_PROMPT_OLLAMA_MODEL` is unset it defaults to
`OLLAMA_MODEL`.

---

## 3. Lifecycle of a one-shot prompt

The lifecycle is the single most important concept to get right. It is fully
asymmetric: the request is fire-and-forget over WebSocket, the response comes
back asynchronously on a separate message. `runId` ties them together.

```
  UI (frontend)                     backend (FastAPI)                        AI (Ollama)
      | 1. click button                      |                                     |
      | 2. build context (taskId, pipeline,  |                                     |
      |    spec, promptId)                   |                                     |
      | -----------------------------------> | 3. handle_quick_prompt                |
      |   WS "quick_prompt"                  | 4. pre-hook(ctx)  -> ctx'            |
      | (fire-and-forget)                    | 5. render template(ctx') -> prompt   |
      |                                      | 6. spawn task, assign runId          |
      |                                      | 7. post-prompt hook(prompt)          |
      |                                      | -----------------------------------> |
      |                                      |   ollama.chat / generate             |
      |                                      | <----------------------------------- |
      |                                      |   stream tokens (optional)           |
      | <----------------------------------- | 8. post-response hook(output)->res  |
      |   WS "quick_prompt_result"           | 9. send result (runId, promptId, res)|
      | 10. confirm pipeline/task still shown |                                     |
      | 11. render + accept/reject           |                                     |
```

### 3.1 Step-by-step

1. **Trigger** — the user clicks a button. Each button is created from a
   `OnePromptAction` config (see §6). Its only job is to gather context and
   send a single WebSocket message.

2. **Context assembly** — the action builds a `context` object. For the
   Elaborate button this is at minimum `{ promptId, taskId, pipelineId }` plus
   any current data needed (the task `spec`, `title`). The backend can re-fetch
   authoritative data itself; the UI only sends enough to render and to let the
   backend resolve the record. Keeping the context small reduces risk of stale
   or inconsistent data.

3. **Send** — the UI emits:
   ```json
   { "type": "quick_prompt", "payload": {
       "runId": "<uuid>", "promptId": "task_elaborate_spec",
       "context": { "taskId": "…", "pipelineId": "…" }
   }}
   ```

4. **Backend dispatch** — a single WebSocket handler
   `handle_quick_prompt` in the new `api/oneprompt` package receives every
   one-shot request. This is the **single entry point**; new use cases add a
   template + hooks, not a new route or handler.

5. **Pre-processing hook** — if a hook is registered for `promptId`, it runs
   with `(promptId, context)` and may return a modified context and/or a
   modified, possibly overridden rendered prompt. Hooks let the backend enrich
   the context with data the UI does not send (e.g. re-fetch the task/pipeline
   from MongoDB, validate existence) before rendering.

6. **Template rendering** — the registry resolves the template for `promptId`
   and renders it with the (possibly transformed) context. The renderer is a
   thin wrapper so the template source can be swapped for a different engine or
   a database-backed template without touching callers.

7. **Async execution** — the rendered prompt is handed to a small
   `OnePromptRunner` that dispatches to Ollama via the existing
   `ollama.AsyncClient` (same config/headers pattern as `AssistantSession`).
   Execution is `asyncio.create_task(...)`: the request path returns immediately,
   the runner re-emits progress and results over WebSocket when ready.

8. **AI call** — `client.chat(model=…, messages=[{role:"user", content:prompt}])`
   (or `generate` for pure completion). The model is resolved from the template
   metadata (default `config.ONE_PROMPT_OLLAMA_MODEL`, which itself defaults to
   `config.OLLAMA_MODEL`). Availability can reuse
   `is_ollama_available()` from `api/ollama_utils.py` to produce a friendly
   error instead of an opaque failure.

9. **Post-processing hook** — once the AI output arrives, an optional
   **response hook** for `promptId` runs and transforms the raw output into
   exactly what the frontend should display (e.g. strip markdown fences,
   extract a JSON payload, normalise to Markdown). Hooks can be async.

10. **Response over WebSocket** — the runner sends to the originating client
    (or broadcast, configurable):
    ```json
    { "type": "quick_prompt_result", "payload": {
        "runId": "<uuid>", "promptId": "task_elaborate_spec",
        "context": { ... }, "result": "<transformed markdown>",
        "error": null, "status": "ok", "meta": { ... }
    }}
    ```
    An error variant uses `status: "error"` and a human-readable `error`.

11. **Client routing** — the frontend's single `quick_prompt_result` handler
    looks up the `promptId` in its action registry, checks whether the owning
    entity (the task/pipeline referenced by `context`) is still displayed in
    the current view, and hands the result to the registered **render** hook.

12. **Present & decide** — the render hook places the result inline where the
    spec is shown, with **Accept** and **Reject** buttons. Accept applies the
    suggestion back into the field/task (e.g. `PATCH /tasks/{id}` updating
    `spec`); Reject discards it.

---

## 4. Monitoring, interception, and transformation

Because every request funnels through the single `handle_quick_prompt` handler
and the `OnePromptRunner`, monitoring and interception are centralised.

### 4.1 Server-side

- **Single point of control** — all reads/writes cross the runner, which emits
  structured lifecycle events:
  - `quick_prompt_start` (request received, before rendering)
  - `quick_prompt_rendered` (final rendered prompt, `runId`, `promptId`)
  - `quick_prompt_result` / `quick_prompt_error` (terminal)
  
  These are logged (with `runId` for trace correlation) and can optionally be
  broadcast to any client that requests to follow a `runId`.
- **Hooks registry** — `api/oneprompt/hooks.py` keeps a dict
  `promptId -> PromptHook` where `PromptHook` exposes optional:
  - `pre_render(context) -> dict`
  - `post_render(prompt, context) -> str`
  - `post_response(raw_output, context) -> Any`
  
  This is the interception/transformation seam. A hook can reject a request by
  raising a clear error that is returned to the client.
- **Streaming (optional)** — the runner can relay partial tokens as
  `quick_prompt_stream` messages with the same `runId`; the client may show a
  live preview while the request is in flight. Interception applies equally to
  the streamed chunks (each chunk passes through the response hook).
- **Cancellation** — a `quick_prompt_cancel` message with a `runId` lets the
  UI (or an operator) stop an in-flight run; the runner cancels the underlying
  asyncio task and emits a terminal `quick_prompt_error` with
  `status: "cancelled"`.

### 4.2 Frontend

- The single `quick_prompt` sender and the single `quick_prompt_result` handler
  live in one module (`ui/core/oneprompt.ts`), so any future use case reuses
  the same transport, error handling, and `runId` correlation.
- Each prompt ID may register a frontend hook to decide where the result is
  rendered and how it is transformed for display, and to implement
  accept/reject. This is the frontend interception/transformation seam.
- The client keeps an in-flight `Map<runId, handler>` so late or out-of-order
  responses can be matched, and stale results (for a task no longer shown)
  can be dropped.

---

## 5. Message protocol (WebSocket)

Reuses the existing `WSMessage {type, id, payload}` model and
`ConnectionManager` in `api/websocket_manager.py`. The `runId` is carried in
`payload` (and echoed in `id` for convenience).

Outbound (client → server):

| `type` | payload | Notes |
|---|---|---|
| `quick_prompt` | `{runId, promptId, context}` | Fire-and-forget request. |
| `quick_prompt_stream_cmd` | `{runId, enable: bool}` | (optional) toggle streaming for a run. |
| `quick_prompt_cancel` | `{runId}` | Cancel an in-flight run. |
| `quick_prompt_accept` | `{runId, payload}` | Tell server the client accepted (for server-side application; optional). |
| `quick_prompt_reject` | `{runId}` | Tell server the client rejected (optional, for metrics). |

Inbound (server → client):

| `type` | payload |
|---|---|
| `quick_prompt_start` | `{runId, promptId, context}` |
| `quick_prompt_rendered` | `{runId, promptId, prompt, context}` (logged / optional) |
| `quick_prompt_stream` | `{runId, promptId, delta}` (optional streaming chunks) |
| `quick_prompt_result` | `{runId, promptId, context, result, status:"ok", meta}` |
| `quick_prompt_error` | `{runId, promptId, context, error, status, meta}` (`status` ∈ `"error"`, `"not_found"`, `"unavailable"`, `"cancelled"`, `"timeout"`) |

The terminal decision (**accept**/**reject**) is purely a client concern for the
first use case; applying it writes back through the normal REST API
(`PATCH /tasks/{id}` for the spec). This keeps the transport focused on
delivering AI results and avoids coupling the framework to write-back logic.

---

## 6. Adding a new one-shot prompt

The goal is: **adding a new prompt for an existing entity must be a
declarative two-file change** (a template + a small frontend action), often with
**no backend code at all**.

### Backend

1. **Add a template** — drop `<prompt_id>.prompt` in
   `api/oneprompt/templates/`. The registry auto-discovers templates on startup,
   so there is nothing to register manually. Front-matter `id` must match the
   file stem.
   - (If the template depends on data the UI doesn't send, the backend can
     resolve it inside the context via a **data provider**: a hook that only
     enriches context is the general solution.)
2. **Add hooks (only if needed)** — register `pre_render` / `post_render` /
   `post_response` in `api/oneprompt/hooks.py`. Hooks are optional; the
   majority of future prompts need none.

That's it. The same `handle_quick_prompt` handler, runner, template renderer,
Ollama client, error handling, and WebSocket plumbing are reused unchanged.

### Frontend

1. **Declare an action** — add an entry to the `onePromptActions` registry in
   `ui/core/oneprompt.ts`:
   ```ts
   {
     id: 'task_elaborate_spec',
     label: 'Elaborate',
     title: 'Expand the task specification',
     iconSvg: '<svg …/>',
     buildContext: (taskId, pipelineId) => ({ taskId, pipelineId }),
     anchor: { entity: 'task', field: 'spec' },   // where to place the result
     render: (resultEl, ctx) => { /* render + Accept/Reject */ },
     accept: (ctx, result) => api.updateTaskSpec(ctx.taskId, result),
     reject: (ctx) => { /* discard */ },
   }
   ```
2. **Mount the button** — reuse/extend `QuickPromptButton`
   (`renderQuickPromptButton`) so that the same button currently copying to the
   clipboard can instead invoke the one-shot action. One-shot buttons send the
   `quick_prompt` message; "copy" buttons keep their current behaviour.

---

## 7. Proposed backend files

New package `backend/api/src/api/oneprompt/`:

| File | Responsibility |
|---|---|
| `templates/<prompt_id>.prompt` | The template library (auto-discovered). |
| `registry.py` | `PromptRegistry`: load/discover templates, resolve by id, expose template metadata (model, labels). |
| `renderer.py` | `render_template(template, context) -> str` using `string.Template` with a context/env resolver. Abstract so it can be swapped for Jinja2 later. |
| `hooks.py` | `PromptHook` dataclass + `hooks` registry (`register_hook`, `get_hook`). Default no-op hooks. |
| `context.py` | Data-provider hooks that enrich a context from MongoDB (e.g. load task + pipeline by id). |
| `runner.py` | `OnePromptRunner`: orchestration (pre-hook → render → post-render hook → Ollama → post-response hook → send). Tracks in-flight runs by `runId`, handles streaming/cancellation/timeouts. |
| `ws_handler.py` | `register_oneprompt_handlers()` wiring `quick_prompt`, `quick_prompt_stream_cmd`, `quick_prompt_cancel`, `quick_prompt_accept`, `quick_prompt_reject` into the `ConnectionManager`. |
| `ollama_client.py` (optional) | Thin wrapper over `ollama.AsyncClient` reusing `config.OLLAMA_HOST` / `config.OLLAMA_API_KEY` / `config.ONE_PROMPT_OLLAMA_MODEL`, honouring `is_ollama_available()`. |

Wiring: register the handlers in `main.py` `lifespan()` (next to
`register_assistant_handlers()`); initialise the registry (scan the template
dir) on startup. The first use case registers one template
(`task_elaborate_spec`) and one data-provider hook that fetches the task +
pipeline and injects `pipeline_name`, `task_title`, `task_spec` into the
context before rendering.

---

## 8. Proposed frontend files

| File | Responsibility |
|---|---|
| `ui/core/oneprompt.ts` | Types (`OnePromptAction`, `PromptContext`, results), the `quick_prompt` sender, the single `quick_prompt_result`/`quick_prompt_stream` handler + in-flight `runId` registry, and the `onePromptActions` map. |
| `ui/components/QuickPromptButton.ts` | Extend so an action can either copy a prompt to the clipboard (current) or dispatch a one-shot `quick_prompt`. |
| `ui/components/SpecSection.ts` | Mount the **Elaborate** button beside the `Task.spec` field and render the suggested result with Accept/Reject. |

The handler for `quick_prompt_result`:
1. Looks up the action by `promptId`.
2. Uses `action.anchor` + `context` to verify the owning task/pipeline is still
   present in the current view/state; otherwise log-and-drop.
3. Calls `action.render` to present the result and wire up accept/reject.

---

## 9. Error handling and robustness

- **Ollama unavailable** — runner checks availability (or surfaces a connection
  exception) and returns `quick_prompt_error` with `status:"unavailable"` and a
  friendly message; the UI button can disable itself after repeated failures.
- **Unknown `promptId`** — backend returns `status:"not_found"`; the UI logs and
  shows a message; no crash.
- **Timeout** — a per-run deadline (default ~60s, tunable per template)
  terminates the task and sends `status:"timeout"`.
- **Cancellation** — `quick_prompt_cancel` triggers cooperative cancellation of
  the asyncio task; runner sends `status:"cancelled"`.
- **Stale results in UI** — the client drops results for entities no longer
  displayed; `runId` correlation prevents mismatched render/accept.
- **Malformed context** — the renderer/hook validates required keys; missing
  ones produce a clear error rather than rendering `$undefined` placeholders.
- **Concurrency** — each run is an independent asyncio task keyed by `runId`;
  no shared mutable state beyond the in-flight map.

---

## 10. Security considerations

- The framework reuses `OLLAMA_API_KEY`/`OLLAMA_HOST`; template rendering only
  inserts user-supplied context into the prompt body and never executes code.
  The template renderer treats all context values as plain (untrusted) text.
- WebSocket messages are already behind JWT auth (the `/ws/{client_id}`
  handshake). One-shot messages carry no new surface; we never accept a
  `promptId` that resolves to a template outside the library.
- The rendered prompt is for the model only; sensitive context should be reduced
  server-side and, where needed, redacted before being echoed back in
  `quick_prompt_rendered` log messages.

---

## 11. Tests

**Backend** (`backend/api/tests/oneprompt/`):
- Template registry discovers/loads a template by id; unknown id → `not_found`.
- Renderer produces correct prompt for a given context incl. missing-key error.
- Hooks: `pre_render`, `post_render`, `post_response` transform input/output;
  a hook can reject a request.
- Runner end-to-end with a mocked Ollama client: verifies `runId` correlation,
  streaming, cancellation, timeout, and `quick_prompt_result` / `quick_prompt_error`
  payloads.
- `task_elaborate_spec` integration: context enrichment from MongoDB and
  expected final result markdown.

**Frontend** (`frontend/src/ui/components/QuickPromptButton.test.ts` +
`ui/core/oneprompt.test.ts`):
- One-shot action sends a correctly-shaped `quick_prompt` message with
  `runId`/`promptId`/`context`.
- `quick_prompt_result` handler routes to the right action, drops stale results
  for entities not shown, and calls `render`/`accept`/`reject`.
- The Elaborate button appears on `SpecSection`, and Accept issues a normal task
  update.

---

## 12. Summary

A single, reusable **one-shot AI prompt** framework is built around the pairing
of a `promptId` and a `context` object. A single backend entry point
(`quick_prompt` handler + `OnePromptRunner`) renders a template, executes AI via
Ollama, and pushes results back over the existing WebSocket; optional hooks on
both ends provide interception and transformation; `runId` correlation supports
streaming, cancellation, and stale-result rejection. Adding a new prompt is a
declarative change — drop a template (and, only if needed, register hooks and a
frontend action). The concrete first use case is an **Elaborate** button on
`Task.spec` that expands a quick dot-list into a full specification, presented
inline with accept/reject.
