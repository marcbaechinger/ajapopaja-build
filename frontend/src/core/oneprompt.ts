/**
 * Copyright 2026 Marc Baechinger
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Frontend core for the one-shot AI prompt framework
 * (`design/dd_one_shot_ai.md` sections 4.2, 5, 6 and 8).
 *
 * The module owns the client half of the `quick_prompt` protocol:
 *
 * * :func:`sendQuickPrompt` — the single fire-and-forget sender. It builds the
 *   `{runId, promptId, context}` payload, tracks the run in :data:`inFlightPrompts`
 *   and hands it to the shared {@link WebSocketClient}.
 * * :func:`handleQuickPromptResult` / :func:`handleQuickPromptStream` — the
 *   single inbound handlers for `quick_prompt_result`, `quick_prompt_error` and
 *   `quick_prompt_stream`. They correlate responses by `runId`, reject stale
 *   results whose owning task/pipeline is no longer displayed, and call the
 *   registered action's `render` / `accept` / `reject` hooks.
 * * :data:`onePromptActions` — the `promptId -> OnePromptAction` registry that
 *   makes adding a new use case a declarative, frontend-only change.
 *
 * Everything is intentionally framework-agnostic: the sender accepts any object
 * with a `send(type, payload)` method (the real {@link WebSocketClient} or a
 * test double), and the inbound handlers take the raw `WSMessage` shape used
 * across the SPA.
 */

import type { WSMessage } from './domain.ts';
import type { WebSocketClient } from './WebSocketClient.ts';

/* ------------------------------------------------------------------------- *
 * Types
 * ------------------------------------------------------------------------- */

/** Free-form context attached to a one-shot request (see design section 2). */
export interface PromptContext {
  taskId?: string;
  pipelineId?: string;
  sessionUid?: string;
  [key: string]: unknown;
}

/**
 * Describes which entity a result belongs to. `entity` is used to verify the
 * owning task/pipeline is still displayed before rendering; `field` records the
 * concrete field (e.g. `spec`) the result targets.
 */
export interface OnePromptAnchor {
  entity: 'task' | 'pipeline' | string;
  field?: string;
  /** Optional per-action visibility override (wins over the global resolver). */
  isVisible?: (context: PromptContext) => boolean;
}

/** Terminal status values mirrored from the backend runner. */
export type OnePromptStatus =
  | 'ok'
  | 'error'
  | 'not_found'
  | 'unavailable'
  | 'cancelled'
  | 'timeout'
  | (string & {});

/** Client → server payload for the `quick_prompt` message. */
export interface QuickPromptPayload {
  runId: string;
  promptId: string;
  context: PromptContext;
  /** Optional: request token streaming for this run. */
  stream?: boolean;
  /** Optional: per-run deadline in seconds. */
  timeout?: number;
}

/** Server → client `quick_prompt_result` / `quick_prompt_error` payload. */
export interface OnePromptResult {
  runId: string;
  promptId: string;
  context?: PromptContext;
  result?: string | null;
  error?: string | null;
  status?: OnePromptStatus;
  meta?: Record<string, unknown>;
}

/** Server → client `quick_prompt_stream` payload (one token/delta). */
export interface OnePromptStreamChunk {
  runId: string;
  promptId: string;
  delta: string;
  context?: PromptContext;
}

/** The context handed to an action's `render`/`accept`/`reject` hooks. */
export interface OnePromptRenderContext extends PromptContext {
  runId: string;
  promptId: string;
  /** The original (possibly backend-enriched) context. */
  context: PromptContext;
  result: string;
  status: OnePromptStatus;
  error: string | null;
  meta: Record<string, unknown>;
  anchor?: OnePromptAnchor;
  /** Container the action may render into. */
  container: HTMLElement;
  /** Accept the suggestion, invoking the action's `accept` hook. */
  accept: (resultOverride?: string) => Promise<void>;
  /** Reject the suggestion, invoking the action's `reject` hook. */
  reject: () => Promise<void>;
  accepted: boolean;
  rejected: boolean;
}

/** A declared one-shot action (design section 6). */
export interface OnePromptAction {
  id: string;
  label: string;
  title: string;
  iconSvg?: string;
  /** Builds the `context` object from whatever the trigger has at hand. */
  buildContext?: (...args: any[]) => PromptContext;
  /** Where the result belongs / how to verify it is still relevant. */
  anchor?: OnePromptAnchor;
  /** Presents the result. The framework has already resolved `resultEl`. */
  render: (resultEl: HTMLElement, ctx: OnePromptRenderContext) => void;
  /** Applies an accepted result (e.g. `PATCH /tasks/{id}`). */
  accept?: (ctx: OnePromptRenderContext, result: string) => void | Promise<void>;
  /** Discards a rejected result. */
  reject?: (ctx: OnePromptRenderContext) => void | Promise<void>;
  /** Optional hook for streamed chunks while the run is in flight. */
  onStream?: (delta: string, ctx: OnePromptRenderContext) => void;
  /** Optional hook for terminal error statuses. */
  onError?: (ctx: OnePromptRenderContext, error: string) => void;
}

/** A minimal sender contract; {@link WebSocketClient} satisfies it. */
export interface QuickPromptSender {
  send(type: string, payload: unknown): void;
}

/** Options accepted by :func:`sendQuickPrompt`. */
export interface SendQuickPromptOptions {
  runId?: string;
  stream?: boolean;
  timeout?: number;
  /** Element to render into (overrides anchor resolution). */
  target?: HTMLElement | null;
  onStream?: (delta: string, ctx: OnePromptRenderContext) => void;
  onResult?: (ctx: OnePromptRenderContext) => void;
  onError?: (ctx: OnePromptRenderContext, error: string, meta?: Record<string, unknown>) => void;
}

/** Handle returned by :func:`sendQuickPrompt`. */
export interface OnePromptRequest {
  runId: string;
  promptId: string;
  context: PromptContext;
  action?: OnePromptAction;
}

/** In-flight state tracked per `runId`. */
export interface OnePromptInFlight {
  runId: string;
  promptId: string;
  action?: OnePromptAction;
  context: PromptContext;
  stream: boolean;
  startedAt: number;
  target?: HTMLElement | null;
  /** Container reused across stream deltas (lazily created). */
  streamContainer?: HTMLElement;
  onStream?: (delta: string, ctx: OnePromptRenderContext) => void;
  onResult?: (ctx: OnePromptRenderContext) => void;
  onError?: (ctx: OnePromptRenderContext, error: string, meta?: Record<string, unknown>) => void;
}

/** Decides whether an anchored result should still be rendered. */
export type OnePromptVisibilityResolver = (
  anchor: OnePromptAnchor,
  context: PromptContext,
  action?: OnePromptAction
) => boolean;

/* ------------------------------------------------------------------------- *
 * Registries / state
 * ------------------------------------------------------------------------- */

/** The `promptId -> OnePromptAction` registry (design section 8). */
export const onePromptActions: Map<string, OnePromptAction> = new Map();

/**
 * In-flight runs keyed by `runId`. Used both to correlate late/out-of-order
 * responses with the action that started them and to hold per-run hooks.
 */
export const inFlightPrompts: Map<string, OnePromptInFlight> = new Map();

// Common aliases so callers/tests can use whichever name reads best.
export const quickPromptHandlers = inFlightPrompts;
export const pendingPrompts = inFlightPrompts;
export const inFlight = inFlightPrompts;
export const onepromptInFlight = inFlightPrompts;
export const pendingQuickPrompts = inFlightPrompts;

/** Registry alias (the design calls this the `onePromptActions` map). */
export const onePromptRegistry = onePromptActions;
export const promptActions = onePromptActions;

/* ------------------------------------------------------------------------- *
 * Action registration helpers
 * ------------------------------------------------------------------------- */

/** Register an action in :data:`onePromptActions` (chainable). */
export function registerOnePromptAction(action: OnePromptAction): OnePromptAction {
  onePromptActions.set(action.id, action);
  return action;
}

/** Look up an action by `promptId`. */
export function getOnePromptAction(id: string): OnePromptAction | undefined {
  return onePromptActions.get(id);
}

/** Remove an action from the registry (mostly useful in tests). */
export function unregisterOnePromptAction(id: string): boolean {
  return onePromptActions.delete(id);
}

/* ------------------------------------------------------------------------- *
 * Visibility / stale-result rejection
 * ------------------------------------------------------------------------- */

/** Default DOM-based visibility check for the supported anchor entities. */
export function defaultVisibilityResolver(
  anchor: OnePromptAnchor,
  context: PromptContext
): boolean {
  if (typeof document === 'undefined') return true;

  if (anchor.entity === 'task') {
    const taskId = context.taskId;
    if (!taskId) return false;
    return Boolean(
      document.querySelector(`[data-task-id="${escapeAttribute(String(taskId))}"]`)
    );
  }

  if (anchor.entity === 'pipeline') {
    const pipelineId = context.pipelineId;
    if (!pipelineId) return false;
    const id = escapeAttribute(String(pipelineId));
    if (document.querySelector(`[data-pipeline-id="${id}"]`)) return true;
    const hash = typeof window !== 'undefined' ? window.location?.hash || '' : '';
    return hash.includes(String(pipelineId));
  }

  if (anchor.entity === 'session') {
    const sessionUid = context.sessionUid;
    if (!sessionUid) return false;
    return Boolean(
      document.querySelector(
        `[data-session-uid="${escapeAttribute(String(sessionUid))}"]`
      )
    );
  }

  return true;
}

let visibilityResolver: OnePromptVisibilityResolver = defaultVisibilityResolver;

/** Replace the global stale-result visibility resolver. */
export function setOnePromptVisibilityResolver(
  resolver?: OnePromptVisibilityResolver
): void {
  visibilityResolver = resolver ?? defaultVisibilityResolver;
}

/** Restore the default visibility resolver. */
export function resetOnePromptVisibilityResolver(): void {
  visibilityResolver = defaultVisibilityResolver;
}

/**
 * Returns `true` when `context`'s owning entity is still displayed. An
 * `anchor.isVisible` override wins over the global resolver.
 */
export function isPromptTargetVisible(
  anchor: OnePromptAnchor | undefined,
  context: PromptContext,
  action?: OnePromptAction
): boolean {
  if (!anchor) return true;
  if (typeof anchor.isVisible === 'function') {
    try {
      return Boolean(anchor.isVisible(context));
    } catch {
      return false;
    }
  }
  try {
    return Boolean(visibilityResolver(anchor, context, action));
  } catch {
    return false;
  }
}

/** Alias kept for readability at call sites. */
export const isAnchorVisible = isPromptTargetVisible;

/* ------------------------------------------------------------------------- *
 * Sending
 * ------------------------------------------------------------------------- */

/** Generate a run id (UUID v4 when available, with a safe fallback). */
export function newRunId(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined'
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `run-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function resolveAction(
  actionOrId: OnePromptAction | string
): OnePromptAction | undefined {
  if (typeof actionOrId === 'string') return onePromptActions.get(actionOrId);
  return actionOrId;
}

/**
 * The single `quick_prompt` sender (design sections 3.3 and 4.2).
 *
 * Builds the protocol payload, records the run for correlation and sends it
 * fire-and-forget over the WebSocket.
 */
export function sendQuickPrompt(
  wsClient: QuickPromptSender,
  actionOrId: OnePromptAction | string,
  context: PromptContext = {},
  options: SendQuickPromptOptions = {}
): OnePromptRequest {
  const action = resolveAction(actionOrId);
  const promptId =
    action?.id ?? (typeof actionOrId === 'string' ? actionOrId : '');
  if (!promptId) {
    throw new Error('oneprompt: sendQuickPrompt requires a promptId.');
  }

  const runId = options.runId || newRunId();
  const payload: QuickPromptPayload = {
    runId,
    promptId,
    context: context || {},
  };
  if (options.stream !== undefined) payload.stream = options.stream;
  if (options.timeout !== undefined) payload.timeout = options.timeout;

  inFlightPrompts.set(runId, {
    runId,
    promptId,
    action,
    context: context || {},
    stream: Boolean(options.stream),
    startedAt: Date.now(),
    target: options.target ?? null,
    onStream: options.onStream,
    onResult: options.onResult,
    onError: options.onError,
  });

  wsClient.send('quick_prompt', payload);

  return { runId, promptId, context: context || {}, action };
}

/**
 * Convenience wrapper around :func:`sendQuickPrompt` that builds the context
 * from the action's `buildContext` hook (design section 3.1).
 */
export function startQuickPrompt(
  wsClient: QuickPromptSender,
  action: OnePromptAction,
  ...contextArgs: any[]
): OnePromptRequest {
  const context = action.buildContext
    ? action.buildContext(...contextArgs)
    : ((contextArgs[0] as PromptContext) ?? {});
  return sendQuickPrompt(wsClient, action, context ?? {});
}

/** Aliases for the sender. */
export const requestQuickPrompt = sendQuickPrompt;
export const quickPrompt = sendQuickPrompt;
export const sendOnePrompt = sendQuickPrompt;
export const dispatchQuickPrompt = sendQuickPrompt;

/* ------------------------------------------------------------------------- *
 * Inbound handling
 * ------------------------------------------------------------------------- */

type InboundMessage = WSMessage | OnePromptResult;
type InboundStreamMessage = WSMessage | OnePromptStreamChunk;

function messagePayload<T extends object>(message: T | { payload?: any }): T {
  const maybe = message as { payload?: any };
  if (maybe && typeof maybe === 'object' && 'payload' in maybe && maybe.payload) {
    return maybe.payload as T;
  }
  return message as T;
}

function messageId(message: unknown): string {
  const maybe = message as { id?: unknown };
  return maybe && maybe.id != null ? String(maybe.id) : '';
}

function resolveResultContext(
  payload: OnePromptResult,
  inFlight: OnePromptInFlight | undefined
): PromptContext {
  const ctx = payload.context;
  if (ctx && typeof ctx === 'object') return ctx as PromptContext;
  return inFlight?.context ?? {};
}

function createRenderContext(
  action: OnePromptAction,
  payload: OnePromptResult,
  context: PromptContext,
  container: HTMLElement,
  result: string
): OnePromptRenderContext {
  const status = (payload.status ?? 'ok') as OnePromptStatus;
  const error = payload.error != null ? String(payload.error) : null;
  const meta = (payload.meta ?? {}) as Record<string, unknown>;

  const ctx: OnePromptRenderContext = {
    ...context,
    runId: String(payload.runId ?? ''),
    promptId: String(payload.promptId ?? action.id),
    context,
    result,
    status,
    error,
    meta,
    anchor: action.anchor,
    container,
    accepted: false,
    rejected: false,
    accept: async () => {},
    reject: async () => {},
  };

  ctx.accept = async (resultOverride?: string) => {
    if (ctx.accepted || ctx.rejected) return;
    ctx.accepted = true;
    const value = typeof resultOverride === 'string' ? resultOverride : ctx.result;
    try {
      await action.accept?.(ctx, value);
    } catch (err) {
      console.error(`[oneprompt] accept hook for "${ctx.promptId}" failed:`, err);
    }
    ctx.container.remove?.();
  };

  ctx.reject = async () => {
    if (ctx.accepted || ctx.rejected) return;
    ctx.rejected = true;
    try {
      await action.reject?.(ctx);
    } catch (err) {
      console.error(`[oneprompt] reject hook for "${ctx.promptId}" failed:`, err);
    }
    ctx.container.remove?.();
  };

  return ctx;
}

/** Resolve the DOM element a result should be rendered into. */
export function resolveAnchorElement(
  anchor: OnePromptAnchor | undefined,
  context: PromptContext
): HTMLElement | null {
  if (!anchor || typeof document === 'undefined') return null;
  try {
    if (anchor.entity === 'task' && context.taskId) {
      const selector = `[data-task-id="${escapeAttribute(String(context.taskId))}"]`;
      return document.querySelector<HTMLElement>(selector);
    }
    if (anchor.entity === 'pipeline' && context.pipelineId) {
      const selector = `[data-pipeline-id="${escapeAttribute(String(context.pipelineId))}"]`;
      return document.querySelector<HTMLElement>(selector);
    }
    if (anchor.entity === 'session' && context.sessionUid) {
      const id = escapeAttribute(String(context.sessionUid));
      const target = document.querySelector<HTMLElement>(
        `[data-session-uid="${id}"][data-oneprompt-target]`
      );
      if (target) return target;
      const row = document.querySelector<HTMLElement>(`[data-session-uid="${id}"]`);
      if (!row) return null;
      return row.querySelector<HTMLElement>('[data-oneprompt-target]') ?? row;
    }
  } catch {
    return null;
  }
  return null;
}

function createResultElement(runId: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'oneprompt-result';
  el.setAttribute('data-oneprompt-result', runId);
  return el;
}

function appendDefaultActionBar(
  resultEl: HTMLElement,
  ctx: OnePromptRenderContext
): void {
  if (resultEl.querySelector('[data-oneprompt-action]')) return;
  const bar = document.createElement('div');
  bar.className = 'oneprompt-actions';

  const acceptBtn = document.createElement('button');
  acceptBtn.type = 'button';
  acceptBtn.setAttribute('data-oneprompt-action', 'accept');
  acceptBtn.textContent = 'Accept';
  acceptBtn.addEventListener('click', () => {
    void ctx.accept();
  });

  const rejectBtn = document.createElement('button');
  rejectBtn.type = 'button';
  rejectBtn.setAttribute('data-oneprompt-action', 'reject');
  rejectBtn.textContent = 'Reject';
  rejectBtn.addEventListener('click', () => {
    void ctx.reject();
  });

  bar.appendChild(acceptBtn);
  bar.appendChild(rejectBtn);
  resultEl.appendChild(bar);
}

/**
 * The single `quick_prompt_result` (and `quick_prompt_error`) handler.
 *
 * Steps (design section 8):
 *  1. look up the action,
 *  2. reject stale results for entities no longer displayed,
 *  3. call `render` and wire up `accept`/`reject`.
 *
 * Returns `true` when the message was handled (rendered or routed to an error
 * hook), `false` when it was dropped.
 */
export function handleQuickPromptResult(message: InboundMessage): boolean {
  const payload = messagePayload<OnePromptResult>(message);
  const runId = String(payload.runId ?? messageId(message) ?? '');
  const promptId = String(payload.promptId ?? '');
  const inFlight = runId ? inFlightPrompts.get(runId) : undefined;
  const action = inFlight?.action ?? onePromptActions.get(promptId);

  if (!action) {
    console.warn(
      `[oneprompt] No action registered for prompt "${promptId}" (run "${runId}").`
    );
    if (runId) inFlightPrompts.delete(runId);
    return false;
  }

  const context = resolveResultContext(payload, inFlight);

  if (!isPromptTargetVisible(action.anchor, context, action)) {
    console.warn(
      `[oneprompt] Dropping stale result for "${promptId}" (run "${runId}"): ` +
        `the owning ${action.anchor?.entity ?? 'entity'} is no longer displayed.`
    );
    if (runId) inFlightPrompts.delete(runId);
    return false;
  }

  if (runId) inFlightPrompts.delete(runId);

  const status = (payload.status ?? 'ok') as OnePromptStatus;
  const result = payload.result == null ? '' : String(payload.result);

  // The result element is always a dedicated, removable container so accepting
  // or rejecting can clean up without touching the surrounding task card. When a
  // live stream preview already exists, the terminal render reuses it.
  let container = inFlight?.streamContainer;
  if (!container) {
    container = createResultElement(runId);
    const target = inFlight?.target ?? resolveAnchorElement(action.anchor, context);
    if (target) target.appendChild(container);
  } else {
    container.replaceChildren();
  }

  const ctx = createRenderContext(action, payload, context, container, result);

  if (status !== 'ok') {
    const error = payload.error != null ? String(payload.error) : `One-shot prompt failed (${status}).`;
    // Surface the failure to whoever is interested without pretending it is a
    // successful render.
    if (inFlight?.onError || action.onError) {
      inFlight?.onError?.(ctx, error, payload.meta);
      action.onError?.(ctx, error);
    } else {
      console.warn(`[oneprompt] "${action.id}" failed with status "${status}": ${error}`);
    }
    return true;
  }

  try {
    action.render(container, ctx);
    appendDefaultActionBar(container, ctx);
    inFlight?.onResult?.(ctx);
  } catch (err) {
    console.error(`[oneprompt] render hook for "${action.id}" failed:`, err);
    container.remove?.();
  }
  return true;
}

/**
 * The single `quick_prompt_stream` handler. Forwards streamed deltas to the
 * owning action (and any per-run `onStream` hook) after the same stale check the
 * result handler applies.
 */
export function handleQuickPromptStream(message: InboundStreamMessage): boolean {
  const payload = messagePayload<OnePromptStreamChunk>(message);
  const runId = String(payload.runId ?? messageId(message) ?? '');
  const promptId = String(payload.promptId ?? '');
  const inFlight = runId ? inFlightPrompts.get(runId) : undefined;
  const action = inFlight?.action ?? onePromptActions.get(promptId);

  if (!action) {
    console.warn(
      `[oneprompt] Stream for unknown prompt "${promptId}" (run "${runId}") dropped.`
    );
    return false;
  }

  const context = payload.context ?? inFlight?.context ?? {};
  if (!isPromptTargetVisible(action.anchor, context, action)) {
    console.warn(
      `[oneprompt] Dropping stale stream for "${promptId}" (run "${runId}").`
    );
    return false;
  }

  const delta = payload.delta == null ? '' : String(payload.delta);
  const target = inFlight?.target ?? resolveAnchorElement(action.anchor, context);

  // Reuse one preview container across deltas so streaming does not litter the
  // DOM; the terminal result reuses and clears it as well.
  let container = inFlight?.streamContainer;
  if (!container) {
    container = createResultElement(runId);
    if (inFlight) inFlight.streamContainer = container;
    if (target) target.appendChild(container);
  }

  const ctx = createRenderContext(action, {
    runId,
    promptId,
    context,
    result: delta,
    status: 'ok',
  }, context, container, delta);

  try {
    inFlight?.onStream?.(delta, ctx);
    action.onStream?.(delta, ctx);
  } catch (err) {
    console.error(`[oneprompt] stream hook for "${action.id}" failed:`, err);
  }
  return true;
}

/** Alias for the result handler used by callers that handle errors separately. */
export const handleQuickPromptError = handleQuickPromptResult;

/* ------------------------------------------------------------------------- *
 * Handler registration
 * ------------------------------------------------------------------------- */

/** The inbound message types this module consumes. */
export const ONE_PROMPT_INBOUND_TYPES = [
  'quick_prompt_result',
  'quick_prompt_error',
  'quick_prompt_stream',
] as const;

/**
 * Subscribe the single result/stream handlers on `wsClient`. Returns an
 * unsubscribe function that removes every handler it registered.
 */
export function registerOnePromptHandlers(
  wsClient: Pick<WebSocketClient, 'on' | 'off'>
): () => void {
  const unsubscribeResult = wsClient.on('quick_prompt_result', (msg) =>
    handleQuickPromptResult(msg)
  );
  const unsubscribeError = wsClient.on('quick_prompt_error', (msg) =>
    handleQuickPromptResult(msg)
  );
  const unsubscribeStream = wsClient.on('quick_prompt_stream', (msg) =>
    handleQuickPromptStream(msg)
  );

  return () => {
    unsubscribeResult();
    unsubscribeError();
    unsubscribeStream();
  };
}

/** Aliases for handler registration. */
export const initOnePrompt = registerOnePromptHandlers;
export const setupOnePromptHandlers = registerOnePromptHandlers;
export const registerQuickPromptHandlers = registerOnePromptHandlers;

/* ------------------------------------------------------------------------- *
 * Convenience service
 * ------------------------------------------------------------------------- */

/**
 * Small integration helper that binds the transport to one
 * `WebSocketClient`. It is optional — the module-level functions above are the
 * canonical API.
 */
export class OnePromptService {
  readonly wsClient: QuickPromptSender;
  private unsubscribe: (() => void) | null = null;

  constructor(wsClient: QuickPromptSender) {
    this.wsClient = wsClient;
  }

  /** Register the inbound handlers (idempotent). */
  register(): this {
    if (!this.unsubscribe && typeof (this.wsClient as any).on === 'function') {
      this.unsubscribe = registerOnePromptHandlers(
        this.wsClient as unknown as Pick<WebSocketClient, 'on' | 'off'>
      );
    }
    return this;
  }

  /** Send a one-shot request. */
  send(
    actionOrId: OnePromptAction | string,
    context: PromptContext = {},
    options: SendQuickPromptOptions = {}
  ): OnePromptRequest {
    return sendQuickPrompt(this.wsClient, actionOrId, context, options);
  }

  /** Send a one-shot request using the action's `buildContext` hook. */
  start(action: OnePromptAction, ...contextArgs: any[]): OnePromptRequest {
    return startQuickPrompt(this.wsClient, action, ...contextArgs);
  }

  /** Remove the registered handlers. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

/* ------------------------------------------------------------------------- *
 * Test / lifecycle helpers
 * ------------------------------------------------------------------------- */

/**
 * Clear in-flight runs and the action registry (used between tests). Passing
 * `clearActions = false` keeps registered actions, which is convenient when a
 * suite registers them once in `beforeAll`.
 */
export function resetOnePromptState(clearActions = true): void {
  inFlightPrompts.clear();
  if (clearActions) onePromptActions.clear();
  resetOnePromptVisibilityResolver();
}

/* ------------------------------------------------------------------------- *
 * Internals
 * ------------------------------------------------------------------------- */

function escapeAttribute(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
