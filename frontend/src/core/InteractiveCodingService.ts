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
import { CoderBotClient } from './clients/CoderBotClient.ts';
import { PiLogReducer } from './PiLogReducer.ts';
import type { RenderBlock } from './PiLogReducer.ts';
import type { PiSessionService } from '../ui/components/PiView.ts';

export interface InteractiveSessionInfo {
  pipelineId: string | null;
  uid: string | null;
  active: boolean;
  busy: boolean;
}

type SessionStateListener = (active: boolean) => void;
type StartTimeListener = (startTime: number | null) => void;
type SessionChangeListener = () => void;
type MessageListener = (content: string) => void;

/**
 * Service backing the interactive Pi coding session.
 *
 * It implements the same {@link PiSessionService} interface the batch
 * `CoderBotService` exposes, so a `PiView` can be connected to it unchanged.
 * Output arrives over dedicated `INTERACTIVE_*` websocket messages and is
 * filtered by `pipeline_id` **and** `bot_type` so it can never be confused with
 * the batch CoderBot stream (both sessions may run at the same time).
 */
export class InteractiveCodingService implements PiSessionService {
  private wsClient: WebSocketClient;
  private client: CoderBotClient;
  private logReducer = new PiLogReducer();

  private currentPipelineId: string | null = null;
  private sessionUid: string | null = null;
  private isSessionActive: boolean = false;
  private sessionStartTime: number | null = null;
  private busy: boolean = false;

  private static readonly SESSION_STORAGE_KEY = 'ajapopaja:interactive:session';

  private listeners: Set<MessageListener> = new Set();
  private stateListeners: Set<SessionStateListener> = new Set();
  private startTimeListeners: Set<StartTimeListener> = new Set();
  private sessionListeners: Set<SessionChangeListener> = new Set();

  constructor(wsClient: WebSocketClient, authService: AuthService, client: CoderBotClient);
  constructor(wsClient: WebSocketClient, client: CoderBotClient);
  constructor(
    wsClient: WebSocketClient,
    arg2: AuthService | CoderBotClient,
    arg3?: CoderBotClient
  ) {
    this.wsClient = wsClient;
    // Support both `(wsClient, client)` and the `(wsClient, authService, client)`
    // form used by the rest of the services.
    this.client = arg3 ?? (arg2 as CoderBotClient);
    this.setupHandlers();
  }

  private setupHandlers() {
    this.wsClient.on('INTERACTIVE_STARTED', (msg) => this.handleStarted(msg.payload));
    this.wsClient.on('INTERACTIVE_STOPPED', (msg) => this.handleStopped(msg.payload));

    this.wsClient.on('INTERACTIVE_TURN_ENDED', (msg) => {
      if (!this.matches(msg.payload)) return;
      this.setBusy(false);
    });

    this.wsClient.on('INTERACTIVE_ERROR', (msg) => {
      if (!this.matches(msg.payload)) return;
      this.logReducer.addBlock({
        kind: 'error',
        text: `● Interactive error: ${msg.payload?.message ?? 'unknown error'}`,
        error: true,
      });
      this.setBusy(false);
    });

    this.wsClient.on('INTERACTIVE_RPC_EVENT', (msg) => {
      if (!this.matches(msg.payload)) return;
      this.logReducer.handleEvent(msg.payload?.event);
    });
  }

  /**
   * Whether an incoming payload belongs to the current interactive session.
   * Requires the dedicated `interactive` bot type and, when known, the same
   * pipeline id.
   */
  private matches(payload: any): boolean {
    if (!payload || payload.bot_type !== 'interactive') return false;
    const pid = payload.pipeline_id;
    if (this.currentPipelineId && pid && pid !== this.currentPipelineId) return false;
    // When a specific backend session UID is tracked, prefer the matching one.
    const uid = payload.session_uid;
    if (this.sessionUid && uid && uid !== this.sessionUid) return false;
    return true;
  }

  private handleStarted(payload: any) {
    if (!payload || payload.bot_type !== 'interactive') return;
    if (payload.pipeline_id) {
      this.currentPipelineId = payload.pipeline_id;
    }
    if (payload.session_uid) {
      this.sessionUid = payload.session_uid;
    }
    // A brand-new session begins: reset the log and session state.
    this.logReducer.clear();
    this.setStartTime(this.parseStartTime(payload.start_time));
    this.setBusy(false);
    this.setActive(true);
    this.persistSession();
    this.notifySessionChange();
  }

  private handleStopped(payload: any) {
    if (!payload || payload.bot_type !== 'interactive') return;
    if (!this.matches(payload)) return;
    this.setBusy(false);
    this.setActive(false);
    this.notifySessionChange();
  }

  // ---------------------------------------------------------------------------
  // HTTP lifecycle API
  // ---------------------------------------------------------------------------

  /** Start an interactive session for the given pipeline (remote repos only). */
  public async startSession(pipelineId: string): Promise<void> {
    this.currentPipelineId = pipelineId;
    const info = await this.client.startInteractiveSession(pipelineId);
    if (info) {
      // The STARTED websocket event drives most of the state; adopt the HTTP
      // response as an immediate/fallback update.
      this.setActive(!!info.is_active);
      this.setBusy(!!info.busy);
      this.setStartTime(this.parseStartTime(info.start_time));
    }
    this.notifySessionChange();
  }

  /** Send a user message to the active interactive session. */
  public async sendMessage(text: string): Promise<void> {
    if (!this.currentPipelineId) {
      throw new Error('No active interactive session');
    }
    this.setBusy(true);
    try {
      await this.client.sendInteractiveMessage(text);
    } catch (e) {
      this.setBusy(false);
      throw e;
    }
  }

  /** Stop the active interactive session. */
  public async stopSession(_taskId?: string): Promise<void> {
    await this.client.stopInteractiveSession();
    this.setBusy(false);
    this.setActive(false);
    this.notifySessionChange();
  }

  /**
   * Pause the active interactive session, keeping it resumable on the backend.
   * Unlike :meth:`stopSession` (which uses the legacy endpoint) this targets the
   * durable session UID and persists it for a later resume.
   */
  public async pauseSession(): Promise<void> {
    const uid = this.sessionUid;
    if (uid && typeof (this.client as any).pauseSession === 'function') {
      await (this.client as any).pauseSession(uid);
    } else {
      await this.client.stopInteractiveSession();
    }
    this.setBusy(false);
    this.setActive(false);
    this.persistSession();
    this.notifySessionChange();
  }

  /** Resume a previously paused/completed session and replay its event log. */
  public async resumeSession(uid: string): Promise<void> {
    const client = this.client as any;
    const info = client.resumeSession ? await client.resumeSession(uid) : null;
    this.sessionUid = uid;
    if (info?.pipeline_id) this.currentPipelineId = info.pipeline_id;
    this.setStartTime(info?.last_active_at ? this.parseStartTime(info.last_active_at) : Date.now());
    this.setBusy(false);
    this.setActive(true);
    this.persistSession();
    await this.loadSessionHistory(uid);
    this.notifySessionChange();
  }

  /** List durable sessions from the backend (optionally filtered). */
  public async listSessions(options?: {
    kind?: string;
    status?: string;
    pipelineId?: string;
  }): Promise<any[]> {
    const client = this.client as any;
    if (typeof client.listSessions !== 'function') return [];
    return await client.listSessions(options);
  }

  /** Replay the persisted raw RPC events of a durable session. */
  public async loadSessionHistory(uid: string): Promise<void> {
    const client = this.client as any;
    if (typeof client.getSessionEvents !== 'function') return;
    let events: any[] = [];
    try {
      events = await client.getSessionEvents(uid);
    } catch (e) {
      console.error('Failed to load interactive session history', e);
    }
    const releaseEmits = this.logReducer.suspendEmits();
    try {
      this.logReducer.clear();
      for (const event of events) {
        this.logReducer.handleEvent(event);
      }
    } finally {
      releaseEmits();
    }
  }

  private persistSession() {
    try {
      if (!this.sessionUid) {
        localStorage.removeItem(InteractiveCodingService.SESSION_STORAGE_KEY);
        return;
      }
      localStorage.setItem(
        InteractiveCodingService.SESSION_STORAGE_KEY,
        JSON.stringify({ uid: this.sessionUid, pipeline_id: this.currentPipelineId })
      );
    } catch (e) {
      /* localStorage may be unavailable. */
    }
  }

  /** Read the session UID persisted by a previous page load, or null. */
  public getPersistedSessionUid(): string | null {
    try {
      const raw = localStorage.getItem(InteractiveCodingService.SESSION_STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data?.uid ?? null;
    } catch (e) {
      return null;
    }
  }

  /** Refresh the session from the backend (e.g. after a page reload). */
  public async refreshSession(): Promise<InteractiveSessionInfo | null> {
    try {
      const info = await this.client.getInteractiveSession();
      if (info && info.is_active) {
        this.currentPipelineId = info.pipeline_id ?? this.currentPipelineId;
        this.setStartTime(this.parseStartTime(info.start_time));
        this.setBusy(!!info.busy);
        this.setActive(true);
      } else {
        this.setBusy(false);
        this.setActive(false);
      }
      this.notifySessionChange();
    } catch (e) {
      console.error('Failed to refresh interactive session', e);
    }
    return this.getCurrentSession();
  }

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------

  public getCurrentSession(): InteractiveSessionInfo {
    return {
      pipelineId: this.currentPipelineId,
      uid: this.sessionUid,
      active: this.isSessionActive,
      busy: this.busy,
    };
  }

  public isBusy(): boolean {
    return this.busy;
  }

  private setActive(active: boolean) {
    if (this.isSessionActive === active) return;
    this.isSessionActive = active;
    this.stateListeners.forEach((l) => l(active));
  }

  private setBusy(busy: boolean) {
    if (this.busy === busy) return;
    this.busy = busy;
    this.notifySessionChange();
  }

  private setStartTime(startTime: number | null) {
    this.sessionStartTime = startTime;
    this.startTimeListeners.forEach((l) => l(startTime));
  }

  private parseStartTime(iso?: string | null): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  private notifySessionChange() {
    this.sessionListeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------------------
  // PiSessionService implementation
  // ---------------------------------------------------------------------------

  public getHistory(): RenderBlock[] {
    return this.logReducer.getBlocks();
  }

  /** The reused PiView footer "Stop" calls `stopSession(pipelineId)`. */
  public getCurrentTaskId(): string | null {
    return this.currentPipelineId;
  }

  public isActive(): boolean {
    return this.isSessionActive;
  }

  public getSessionStartTime(): number | null {
    return this.sessionStartTime;
  }

  public onSessionStartTimeChange(listener: StartTimeListener): () => void {
    this.startTimeListeners.add(listener);
    return () => this.startTimeListeners.delete(listener);
  }

  public clearHistory(): void {
    this.logReducer.clear();
  }

  public onBlocks(listener: (blocks: RenderBlock[]) => void): () => void {
    return this.logReducer.onBlocks(listener);
  }

  public onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public onSessionStateChange(listener: SessionStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Subscribe to session identity/busy changes. */
  public onSessionChange(listener: SessionChangeListener): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }
}
