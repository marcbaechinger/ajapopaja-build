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

import { WebSocketClient } from './WebSocketClient.ts';
import { AuthService } from './AuthService.ts';

export type CoderBotListener = (content: string) => void;

export type BlockKind =
  | 'text'
  | 'thinking'
  | 'tool'
  | 'bash'
  | 'notice'
  | 'error'
  | 'divider'
  | 'verification';

/**
 * A single structured, rendered line/block in the CoderBot activity log.
 */
export interface RenderBlock {
  id: string;
  kind: BlockKind;
  /** Accumulated content for text/thinking/bash blocks. */
  text?: string;
  /** Headline (e.g. "→ Calling write"). */
  header?: string;
  /** Extra detail lines (tool args, queue items, retry info). */
  sub?: string[];
  /** Marks error blocks for red tinting. */
  error?: boolean;
  /**
   * The original command/argument captured when a tool started (e.g. the bash
   * command or the file a read/write tool operated on). Preserving it keeps
   * "what was executed" visible after the tool completes and its header becomes
   * "✓ bash finished"; the view prepends it before the result/output.
   */
  command?: string;
}

type BlockListener = (blocks: RenderBlock[]) => void;

interface OpenBlock {
  block: RenderBlock;
  buffer: string;
  /** The original command/argument captured at tool start (see RenderBlock.command). */
  command?: string;
}

/**
 * Service to manage the real-time activity log of the CoderBot.
 *
 * It subscribes to the structured `CODERBOT_RPC_EVENT` stream (the raw Pi RPC event
 * forwarded by the backend) and reduces it into a list of stable `RenderBlock`s that
 * the UI renders. Legacy `ASSISTANT_STREAM` handling is preserved for bots other than
 * CoderBot.
 */
export class CoderBotService {
  private wsClient: WebSocketClient;
  private authService: AuthService;
  private messageHistory: string = '';
  private blocks: RenderBlock[] = [];
  /** Live blocks still receiving streaming deltas, keyed by a logical key. */
  private openBlocks: Map<string, OpenBlock> = new Map();
  private nextBlockId: number = 1;
  private listeners: Set<CoderBotListener> = new Set();
  private blockListeners: Set<BlockListener> = new Set();
  private stateListeners: Set<(active: boolean) => void> = new Set();
  private sessionListeners: Set<() => void> = new Set();
  private currentTaskId: string | null = null;
  private currentPipelineId: string | null = null;
  private isSessionActive: boolean = false;
  /** Key of the session whose history has already been replayed (dedupe). */
  private loadedSessionKey: string | null = null;
  /** In-flight history load so concurrent reconnects share one fetch. */
  private historyLoadPromise: Promise<void> | null = null;
  /**
   * Wall-clock start (epoch ms) of the current/last session, as reported by the
   * backend so the "Running since" elapsed-time display can resume from the real
   * session start instead of when the PiView was created.
   */
  private sessionStartTime: number | null = null;
  private startTimeListeners: Set<(startTime: number | null) => void> = new Set();

  private static readonly SESSION_STORAGE_KEY = 'ajapopaja:coderbot:session';

  constructor(wsClient: WebSocketClient, authService: AuthService) {
    this.wsClient = wsClient;
    this.authService = authService;
    this.setupHandlers();
    this.loadPersistedSession();
  }

  private setupHandlers() {
    this.wsClient.on('CODERBOT_STARTED', (msg) => {
      const taskId = msg.payload?.task_id;
      if (taskId !== this.currentTaskId) {
        this.clearHistory();
        this.currentTaskId = taskId;
        // A brand-new session is beginning; seed a local start reference until
        // the server-reported start time is loaded with the history.
        this.setSessionStartTime(Date.now());
      }
      this.currentPipelineId = msg.payload?.pipeline_id ?? this.currentPipelineId;
      this.setSessionActive(true);
      this.persistSession();
      this.notifySessionChange();
    });

    this.wsClient.on('CODERBOT_COMPLETED', () => {
      this.setSessionActive(false);
      this.persistSession();
      this.notifySessionChange();
    });

    // Legacy plain-text stream for bots other than CoderBot. CoderBot is rendered
    // exclusively from the structured CODERBOT_RPC_EVENT stream.
    this.wsClient.on('ASSISTANT_STREAM', (msg) => {
      if (msg.payload?.bot_type && msg.payload.bot_type !== 'coderbot') {
        const content = msg.payload.content || '';
        this.messageHistory += content;
        this.notify(content);
      }
    });

    this.wsClient.on('CODERBOT_RPC_EVENT', (msg) => {
      if (msg.payload?.bot_type === 'coderbot') {
        this.handleRpcEvent(msg.payload?.event);
      }
    });

    // Post-run test verification broadcast. Rendered as a distinct, boxed block
    // so the user can see whether the mandatory test suite passed or failed.
    this.wsClient.on('CODERBOT_VERIFICATION', (msg) => {
      if (msg.payload?.bot_type === 'coderbot') {
        this.addVerificationBlock(msg.payload.result);
      }
    });

    // Broadcast emitted right before the post-run verification commands start,
    // so PiView can tell the user the mandatory test suite is now running.
    this.wsClient.on('CODERBOT_VERIFICATION_STARTED', (msg) => {
      if (msg.payload?.bot_type === 'coderbot') {
        this.addBlock({ kind: 'notice', text: '● Verification: running tests…' });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // RPC event -> render block reducer
  // ---------------------------------------------------------------------------

  private handleRpcEvent(event: any) {
    const type = event?.type;
    if (!type) return;

    switch (type) {
      case 'message_update':
        this.handleMessageUpdate(event.assistantMessageEvent);
        break;
      case 'message_start':
      case 'message_end':
        // Close any streaming text/thinking blocks so each message's content stays
        // in its own block (contentIndex restarts at 0 per message).
        this.closeStreamingBlocks(['text', 'thinking']);
        break;
      case 'agent_start':
        this.addBlock({ kind: 'notice', text: '● Agent started' });
        break;
      case 'agent_end':
        this.addBlock({
          kind: 'notice',
          text: `● Agent run completed${event.willRetry ? ' — will auto-retry' : ''}`,
        });
        break;
      case 'agent_settled':
        this.addBlock({ kind: 'notice', text: '● Agent settled (no pending work)' });
        break;
      case 'bash_execution_update':
        this.handleBashUpdate(event);
        break;
      case 'tool_execution_start':
        this.handleToolStart(event);
        break;
      case 'tool_execution_update':
        this.handleToolUpdate(event);
        break;
      case 'tool_execution_end':
        this.finishTool(event, event.isError);
        break;
      case 'queue_update':
        this.handleQueueUpdate(event);
        break;
      case 'compaction_start':
        this.addBlock({
          kind: 'notice',
          text: `● Compacting… (${event.reason || 'threshold'})`,
        });
        break;
      case 'compaction_end':
        this.handleCompactionEnd(event);
        break;
      case 'auto_retry_start':
        this.addBlock({
          kind: 'notice',
          text: `● Auto-retry (${event.attempt}/${event.maxAttempts})…`,
        });
        break;
      case 'auto_retry_end':
        this.addBlock({
          kind: 'notice',
          text: event.success
            ? `● Auto-retry succeeded (attempt ${event.attempt})`
            : `● Auto-retry failed: ${event.finalError || 'unknown error'}`,
          error: !event.success,
        });
        break;
      case 'summarization_retry_scheduled':
        this.addBlock({
          kind: 'notice',
          text: `● Summarization retry scheduled (${event.attempt}/${event.maxAttempts})…`,
        });
        break;
      case 'summarization_retry_attempt_start':
        this.addBlock({
          kind: 'notice',
          text: `● Retrying summarization…`,
        });
        break;
      case 'summarization_retry_finished':
        this.addBlock({ kind: 'notice', text: '● Summarization retry finished' });
        break;
      case 'extension_error':
        this.addBlock({
          kind: 'error',
          text: `Extension error (${event.extensionPath || ''}): ${event.error || event.event || ''}`,
          error: true,
        });
        break;
      default:
        // Unknown/ignored event types are logged on the backend; nothing to render.
        break;
    }
  }

  private handleMessageUpdate(delta: any) {
    const deltaType = delta?.type;
    if (deltaType === 'text_delta' && delta.delta) {
      this.appendStreaming('text', `text:${delta.contentIndex ?? 0}`, delta.delta);
    } else if (deltaType === 'thinking_delta' && delta.delta) {
      this.appendStreaming('thinking', `thinking:${delta.contentIndex ?? 0}`, delta.delta);
    } else if (deltaType === 'toolcall_start') {
      this.openToolCall(delta.id, delta.toolName ?? 'tool');
    } else if (deltaType === 'toolcall_delta') {
      const open = this.openBlocks.get(`tool:${delta.id}`);
      if (open) {
        open.buffer += delta.delta ?? '';
        this.updateBlock(open.block.id, { text: open.buffer });
      }
    } else if (deltaType === 'toolcall_end') {
      const open = this.openBlocks.get(`tool:${delta.id}`);
      if (open) {
        this.updateBlock(open.block.id, {
          header: `✓ ${delta.toolCall?.name ?? 'tool'}`,
        });
      }
    }
  }

  private openToolCall(id: unknown, name: string) {
    if (id === undefined || id === null) {
      id = `gen_${this.nextBlockId}`;
    }
    const key = `tool:${id}`;
    if (this.openBlocks.has(key)) {
      return;
    }
    const block: RenderBlock = {
      id: this.nextId(),
      kind: 'tool',
      header: `→ Calling ${name}…`,
      text: '',
    };
    this.openBlocks.set(key, { block, buffer: '' });
    this.blocks.push(block);
    this.emitBlocks();
  }

  private handleBashUpdate(event: any) {
    const key = `bash:${event.id ?? '_no_id'}`;
    this.appendStreaming('bash', key, event.delta ?? '');
  }

  private handleToolStart(event: any) {
    const key = `tool:${event.toolCallId}`;
    let open = this.openBlocks.get(key);
    if (!open) {
      const block: RenderBlock = {
        id: this.nextId(),
        kind: 'tool',
        header: `→ Running ${event.toolName ?? 'tool'}…`,
        text: '',
      };
      open = { block, buffer: '' };
      this.openBlocks.set(key, open);
      this.blocks.push(block);
    } else {
      this.updateBlock(open.block.id, {
        header: `→ Running ${event.toolName ?? 'tool'}…`,
      });
    }
    const args = event.args?.command ?? this.previewArgs(event.args);
    if (args) {
      const command = String(args);
      open.buffer = command;
      open.command = command;
      this.updateBlock(open.block.id, { text: open.buffer, command });
    }
  }

  private handleToolUpdate(event: any) {
    const open = this.openBlocks.get(`tool:${event.toolCallId}`);
    if (!open) return;
    const partial = event.partialResult?.content;
    let text = '';
    if (Array.isArray(partial)) {
      text = partial.map((p: any) => p?.text ?? '').join('');
    } else if (typeof partial === 'string') {
      text = partial;
    }
    if (text) {
      open.buffer = text;
      this.updateBlock(open.block.id, { text });
    }
  }

  private finishTool(event: any, isError: boolean) {
    const open = this.openBlocks.get(`tool:${event.toolCallId}`);
    if (!open) return;
    const result = event.result?.content;
    let text = open.buffer;
    if (Array.isArray(result)) {
      const joined = result.map((p: any) => p?.text ?? '').join('');
      if (joined) text = joined;
    } else if (typeof result === 'string' && result) {
      text = result;
    }
    this.updateBlock(open.block.id, {
      header: isError ? `✕ ${event.toolName ?? 'tool'} failed` : `✓ ${event.toolName ?? 'tool'} finished`,
      text,
      error: isError,
      // Keep the executed command/file so it stays visible after completion.
      command: open.command,
    });
    this.openBlocks.delete(`tool:${event.toolCallId}`);
  }

  private handleQueueUpdate(event: any) {
    const parts: string[] = [];
    const steering = event.steering ?? [];
    const followUp = event.followUp ?? [];
    if (steering.length) parts.push(`steering: ${steering.join(' · ')}`);
    if (followUp.length) parts.push(`follow-up: ${followUp.join(' · ')}`);
    this.addBlock({ kind: 'notice', text: parts.length ? `● Queue — ${parts.join(' | ')}` : '● Queue empty' });
  }

  private handleCompactionEnd(event: any) {
    const result = event.result;
    if (event.aborted) {
      this.addBlock({ kind: 'notice', text: '● Compaction aborted', error: true });
      return;
    }
    if (!result || event.errorMessage) {
      this.addBlock({
        kind: 'notice',
        text: `● Compaction failed: ${event.errorMessage || 'unknown error'}`,
        error: true,
      });
      return;
    }
    const tokensBefore = result.tokensBefore ?? '?';
    const tokensAfter = event.estimatedTokensAfter ?? result.estimatedTokensAfter ?? '?';
    this.addBlock({
      kind: 'notice',
      text: `● Compacted ${tokensBefore} → ${tokensAfter} tokens (will retry: ${event.willRetry ? 'yes' : 'no'})`,
    });
  }

  private previewArgs(args: any): string {
    if (!args) return '';
    try {
      return JSON.stringify(args);
    } catch {
      return String(args);
    }
  }

  // ---------------------------------------------------------------------------
  // Block helpers
  // ---------------------------------------------------------------------------

  private nextId(): string {
    return `blk_${this.nextBlockId++}`;
  }

  /**
   * Reducer for a `CODERBOT_VERIFICATION` broadcast. Builds a single
   * `verification`-kind block summarizing the post-run test suite.
   */
  private addVerificationBlock(result: any) {
    const passed = !!result?.passed;
    const commands: any[] = Array.isArray(result?.commands)
      ? result.commands
      : [];
    const sub: string[] = [];
    for (const entry of commands) {
      const cmd = entry?.cmd ?? '';
      const exitCode = entry?.exit_code;
      sub.push(`- ${cmd}  → exit code ${exitCode}`);
      // Append the (truncated) output tail only for failed commands, matching
      // the backend's PR summary annotation.
      if (!passed && exitCode !== 0 && entry?.output_tail) {
        sub.push(entry.output_tail.slice(0, 500));
      }
    }
    this.addBlock({
      kind: 'verification',
      text: passed ? '● Verification: PASSED' : '● Verification: FAILED',
      sub,
      error: !passed,
    });
  }

  private addBlock(opts: Omit<RenderBlock, 'id'>) {
    const block: RenderBlock = { id: this.nextId(), ...opts };
    this.blocks.push(block);
    this.emitBlocks();
    return block.id;
  }

  private appendStreaming(kind: BlockKind, key: string, delta: string) {
    let open = this.openBlocks.get(key);
    if (!open) {
      const block: RenderBlock = { id: this.nextId(), kind, text: '' };
      open = { block, buffer: '' };
      this.openBlocks.set(key, open);
      this.blocks.push(block);
    }
    open.buffer += delta;
    open.block.text = open.buffer;
    this.emitBlocks();
  }

  private closeStreamingBlocks(kinds: BlockKind[]) {
    for (const [key, open] of this.openBlocks) {
      const kind = open.block.kind;
      if (kinds.includes(kind)) {
        this.openBlocks.delete(key);
      }
    }
    // No visual change; closing just separates message boundaries.
  }

  private updateBlock(id: string, patch: Partial<RenderBlock>) {
    const block = this.blocks.find((b) => b.id === id);
    if (!block) return;
    Object.assign(block, patch);
    this.emitBlocks();
  }

  private emitBlocks() {
    const snapshot = this.blocks.slice();
    this.blockListeners.forEach((l) => l(snapshot));
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns the structured activity log blocks. */
  public getHistory(): RenderBlock[] {
    return this.blocks.slice();
  }

  public getRawHistory(): string {
    return this.messageHistory;
  }

  public getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  public isActive(): boolean {
    return this.isSessionActive;
  }

  public clearHistory() {
    this.blocks = [];
    this.openBlocks.clear();
    this.messageHistory = '';
    this.currentTaskId = null;
    this.emitBlocks();
    this.notify('');
  }

  public onMessage(listener: CoderBotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to structured activity-log changes. Receives the full block list. */
  public onBlocks(listener: BlockListener): () => void {
    this.blockListeners.add(listener);
    return () => this.blockListeners.delete(listener);
  }

  public onSessionStateChange(listener: (active: boolean) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Subscribe to session identity/state changes (any pipeline's session update). */
  public onSessionChange(listener: () => void): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  public async stopSession(taskId: string): Promise<void> {
    const token = this.authService.getAccessToken();
    const response = await fetch(`/api/coderbot/stop/${taskId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to stop CoderBot session');
    }
  }

  /** Returns the current (or last) CoderBot session, or null when none. */
  public getCurrentSession(): { pipelineId: string | null; taskId: string | null; active: boolean } | null {
    if (!this.currentTaskId) return null;
    return { pipelineId: this.currentPipelineId, taskId: this.currentTaskId, active: this.isSessionActive };
  }

  /** Returns the wall-clock start (epoch ms) of the current session, or null. */
  public getSessionStartTime(): number | null {
    return this.sessionStartTime;
  }

  /**
   * Subscribe to session start-time updates (e.g. once the server-reported start
   * time is loaded from the history/session endpoints after a mount).
   */
  public onSessionStartTimeChange(listener: (startTime: number | null) => void): () => void {
    this.startTimeListeners.add(listener);
    return () => this.startTimeListeners.delete(listener);
  }

  private setSessionStartTime(startTime: number | null) {
    this.sessionStartTime = startTime;
    this.startTimeListeners.forEach((l) => l(startTime));
  }

  /** Coerces a backend ISO-8601 start time to epoch ms, or null when absent. */
  private parseStartTime(iso?: string | null): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  /** Refreshes the session from the backend (e.g. after a page reload). */
  public async refreshSession(): Promise<{ pipelineId: string | null; taskId: string | null; active: boolean } | null> {
    try {
      const session = await this.fetchSession();
      if (session && session.task_id) {
        this.currentPipelineId = session.pipeline_id ?? this.currentPipelineId;
        this.currentTaskId = session.task_id;
        this.setSessionActive(!!session.is_active);
        this.setSessionStartTime(this.parseStartTime(session.start_time));
        this.persistSession();
      } else {
        this.setSessionActive(false);
      }
    } catch (e) {
      console.error('Failed to refresh CoderBot session', e);
    }
    return this.getCurrentSession();
  }

  /**
   * Reconnects output to a CoderBot session, loading its persisted history once
   * (deduped per session) and resuming live updates.
   */
  public async reconnect(session?: { pipelineId?: string | null; taskId: string | null; active?: boolean }): Promise<void> {
    const target = session ?? this.getCurrentSession();
    if (!target || !target.taskId) {
      await this.refreshSession();
      return;
    }
    if (!this.currentTaskId) {
      this.currentTaskId = target.taskId;
      this.currentPipelineId = target.pipelineId ?? this.currentPipelineId;
    }
    if (target.active) this.setSessionActive(true);
    this.persistSession();

    const key = `${this.currentPipelineId ?? ''}:${this.currentTaskId}`;
    if (this.loadedSessionKey === key) {
      this.emitBlocks();
      return;
    }

    // Share a single in-flight history load so a reconnect storm (many UI
    // refreshes) doesn't issue one GET per call.
    if (!this.historyLoadPromise) {
      this.historyLoadPromise = this.loadHistory(this.currentTaskId, key);
    }
    await this.historyLoadPromise;
  }

  private async loadHistory(taskId: string, key: string): Promise<void> {
    try {
      let events: any[] = [];
      let startTime: number | null = null;
      try {
        const history = await this.fetchSessionHistory(taskId);
        events = history.events ?? [];
        startTime = this.parseStartTime(history.start_time);
      } catch (e) {
        console.error('Failed to load CoderBot session history', e);
      }

      if (startTime !== null) this.setSessionStartTime(startTime);

      // Rebuild the activity log by replaying the same reducer over the persisted
      // events, so past output of this session is preserved after a reload.
      this.blocks = [];
      this.openBlocks.clear();
      this.nextBlockId = 1;
      for (const event of events) {
        this.handleRpcEvent(event);
      }
      this.loadedSessionKey = key;
      this.emitBlocks();
      this.notify('');
    } finally {
      this.historyLoadPromise = null;
    }
  }

  private persistSession() {
    try {
      const data = {
        pipeline_id: this.currentPipelineId,
        task_id: this.currentTaskId,
        active: this.isSessionActive,
      };
      if (!data.task_id) {
        localStorage.removeItem(CoderBotService.SESSION_STORAGE_KEY);
        return;
      }
      localStorage.setItem(CoderBotService.SESSION_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      /* localStorage may be unavailable; the session still lives for this app session. */
    }
  }

  private loadPersistedSession() {
    try {
      const raw = localStorage.getItem(CoderBotService.SESSION_STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && s.task_id) {
        this.currentTaskId = s.task_id;
        this.currentPipelineId = s.pipeline_id || null;
        this.isSessionActive = !!s.active;
      }
    } catch (e) {
      /* ignore malformed storage */
    }
  }

  private async fetchSession(): Promise<{ pipeline_id?: string; task_id?: string; is_active?: boolean; start_time?: string | null } | null> {
    const token = this.authService.getAccessToken();
    const response = await fetch('/api/coderbot/session', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return await response.json();
  }

  private async fetchSessionHistory(taskId: string): Promise<{ events: any[]; start_time?: string | null }> {
    const token = this.authService.getAccessToken();
    const response = await fetch(`/api/coderbot/session/${taskId}/history`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) return { events: [] };
    const data = await response.json();
    return {
      events: Array.isArray(data?.events) ? data.events : [],
      start_time: data?.start_time,
    };
  }

  private setSessionActive(active: boolean) {
    // Only notify on an actual change so re-renders that call setSessionActive()
    // with the same value (e.g. reconnect) don't trigger a notification loop.
    if (this.isSessionActive === active) return;
    this.isSessionActive = active;
    this.stateListeners.forEach(l => l(active));
  }

  private notifySessionChange() {
    this.sessionListeners.forEach(l => l());
  }

  private notify(content: string) {
    this.listeners.forEach(l => l(content));
  }
}
