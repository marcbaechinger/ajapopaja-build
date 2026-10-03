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
import type { PiSessionSummary } from './clients/CoderBotClient.ts';
import { PiLogReducer } from './PiLogReducer.ts';
import type { RenderBlock } from './PiLogReducer.ts';
import { LocalStorageManager } from './LocalStorageManager.ts';
import { sessionTimestamp } from '../ui/components/utils/relativeTime.ts';
import type { PiSessionService } from '../ui/components/PiView.ts';

export type { PiSessionSummary };

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
export type SessionsListener = (sessions: PiSessionSummary[]) => void;

/** Options accepted by {@link InteractiveCodingService.refreshSessions}. */
export interface RefreshSessionsOptions {
  kind?: string;
  status?: string;
  pipelineId?: string;
  includeDiscarded?: boolean;
}

/** Status grouping weight — Active first, then paused/completed/failed. */
const STATUS_ORDER: Record<string, number> = {
  running: 0,
  starting: 1,
  paused: 2,
  completed: 3,
  failed: 4,
  discarded: 5,
};

function statusWeight(status: string | null | undefined): number {
  return STATUS_ORDER[status ?? ''] ?? 6;
}

function timeValue(session: PiSessionSummary): number {
  const iso = sessionTimestamp(session);
  const ms = iso ? new Date(iso).getTime() : 0;
  return Number.isNaN(ms) ? 0 : ms;
}

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

  // --- Session list / switcher state -------------------------------------
  private sessions: Map<string, PiSessionSummary> = new Map();
  private sessionsLoading = false;
  private sessionsError: string | null = null;
  private switchingUid: string | null = null;
  private pendingResumeUid: string | null = null;
  private resumedSessionUids: Set<string> = new Set();
  private resumeHintUid: string | null = null;
  private sessionsRequest: Promise<PiSessionSummary[]> | null = null;
  private storage = LocalStorageManager.getInstance('interactive');

  private static readonly STORAGE_KEY = 'session';
  private static readonly LEGACY_STORAGE_KEY = 'ajapopaja:interactive:session';

  private listeners: Set<MessageListener> = new Set();
  private stateListeners: Set<SessionStateListener> = new Set();
  private startTimeListeners: Set<StartTimeListener> = new Set();
  private sessionListeners: Set<SessionChangeListener> = new Set();
  private sessionsListeners: Set<SessionsListener> = new Set();

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
    this.wsClient.on('SESSION_UPDATED', (msg) => this.handleSessionUpdated(msg.payload));

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
      const uid = msg.payload?.session_uid;
      if (uid) this.updateSessionStatus(uid, 'failed', { last_error: msg.payload?.message ?? null });
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
    const incomingUid: string | null = payload.session_uid ?? null;
    // A resume replays the persisted history after the start event; never clear
    // that replayed log when the (possibly late) STARTED message arrives for a
    // session we explicitly resumed.
    const isResume =
      incomingUid !== null &&
      (incomingUid === this.pendingResumeUid || this.resumedSessionUids.has(incomingUid));

    if (payload.pipeline_id) {
      this.currentPipelineId = payload.pipeline_id;
    }
    if (payload.session_uid) {
      this.sessionUid = payload.session_uid;
    }

    if (!isResume) {
      // A brand-new session begins: reset the log and session state.
      this.logReducer.clear();
    } else {
      // Consume the guard so a later, unrelated STARTED clears normally.
      this.pendingResumeUid = null;
    }

    this.setStartTime(this.parseStartTime(payload.start_time));
    this.setBusy(false);
    this.setActive(true);
    this.upsertSession(
      {
        uid: incomingUid ?? this.sessionUid ?? '',
        kind: payload.kind ?? 'interactive',
        status: 'running',
        pipeline_id: payload.pipeline_id ?? this.currentPipelineId,
        label: payload.label ?? null,
        last_active_at: new Date().toISOString(),
      } as PiSessionSummary,
      false
    );
    this.persistSession();
    this.notifySessionChange();
    this.notifySessionsChange();
  }

  private handleStopped(payload: any) {
    if (!payload || payload.bot_type !== 'interactive') return;
    if (!this.matches(payload)) return;
    this.setBusy(false);
    this.setActive(false);
    const uid = payload.session_uid ?? this.sessionUid;
    if (uid) this.updateSessionStatus(uid, 'paused', undefined, false);
    this.notifySessionChange();
    this.notifySessionsChange();
  }

  /** Handle an optional server-side session update broadcast (rename, etc.). */
  private handleSessionUpdated(payload: any) {
    if (!payload || !payload.uid) return;
    this.upsertSession(payload as PiSessionSummary);
    this.notifySessionsChange();
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
      const uid = (info as any).uid ?? this.sessionUid;
      if (uid) {
        this.upsertSession({
          uid,
          kind: 'interactive',
          status: info.is_active ? 'running' : 'starting',
          pipeline_id: info.pipeline_id ?? pipelineId,
          last_active_at: new Date().toISOString(),
        } as PiSessionSummary);
      }
    }
    await this.refreshSessions({ kind: 'interactive' });
    this.notifySessionChange();
    this.notifySessionsChange();
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
    const uid = this.sessionUid;
    if (uid) this.updateSessionStatus(uid, 'paused');
    this.notifySessionChange();
    this.notifySessionsChange();
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
    if (uid) this.updateSessionStatus(uid, 'paused');
    this.persistSession();
    this.notifySessionChange();
    this.notifySessionsChange();
  }

  /** Resume a previously paused/completed session and replay its event log. */
  public async resumeSession(uid: string): Promise<void> {
    const client = this.client as any;
    // Guard the replay race: a (possibly late) INTERACTIVE_STARTED for this uid
    // must not wipe the history we are about to replay.
    this.pendingResumeUid = uid;
    this.resumedSessionUids.add(uid);
    let info: PiSessionSummary | null = null;
    try {
      info = client.resumeSession ? await client.resumeSession(uid) : null;
    } catch (e) {
      this.pendingResumeUid = null;
      throw e;
    }
    this.sessionUid = uid;
    if (info?.pipeline_id) this.currentPipelineId = info.pipeline_id;
    this.setStartTime(info?.last_active_at ? this.parseStartTime(info.last_active_at) : Date.now());
    this.setBusy(false);
    this.setActive(true);
    this.upsertSession({
      ...(info ?? ({} as PiSessionSummary)),
      uid,
      kind: (info?.kind as PiSessionSummary['kind']) ?? 'interactive',
      status: 'running',
      pipeline_id: info?.pipeline_id ?? this.currentPipelineId,
      last_active_at: info?.last_active_at ?? new Date().toISOString(),
    } as PiSessionSummary);
    this.persistSession();
    await this.loadSessionHistory(uid);
    await this.refreshSessions({ kind: 'interactive' });
    this.notifySessionChange();
    this.notifySessionsChange();
  }

  /** List durable sessions from the backend (optionally filtered). */
  public async listSessions(options?: RefreshSessionsOptions): Promise<PiSessionSummary[]> {
    const client = this.client as any;
    if (typeof client.listSessions !== 'function') return [];
    const result = await client.listSessions(options);
    return Array.isArray(result) ? result : [];
  }

  /** Replay the persisted raw RPC events of a durable session. */
  public async loadSessionHistory(uid: string): Promise<void> {
    const client = this.client as any;
    if (typeof client.getSessionEvents !== 'function') return;
    let events: any[] = [];
    try {
      const loaded = await client.getSessionEvents(uid);
      events = Array.isArray(loaded) ? loaded : [];
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
    if (!this.sessionUid) {
      this.storage.remove(InteractiveCodingService.STORAGE_KEY);
      return;
    }
    this.storage.put(InteractiveCodingService.STORAGE_KEY, {
      uid: this.sessionUid,
      pipeline_id: this.currentPipelineId,
      updated_at: new Date().toISOString(),
    });
    // Drop the legacy raw key once it has been migrated.
    try {
      localStorage.removeItem(InteractiveCodingService.LEGACY_STORAGE_KEY);
    } catch {
      /* localStorage may be unavailable. */
    }
  }

  /** Read the session UID persisted by a previous page load, or null. */
  public getPersistedSessionUid(): string | null {
    const stored = this.storage.get<{ uid?: string } | null>(
      InteractiveCodingService.STORAGE_KEY,
      null
    );
    if (stored?.uid) return stored.uid;

    // Backwards compatibility with the pre-LocalStorageManager key.
    try {
      const raw = localStorage.getItem(InteractiveCodingService.LEGACY_STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data?.uid ?? null;
    } catch {
      return null;
    }
  }

  /** Refresh the session from the backend (e.g. after a page reload). */
  public async refreshSession(): Promise<InteractiveSessionInfo | null> {
    try {
      const info: any = await this.client.getInteractiveSession();
      if (info && info.is_active) {
        this.currentPipelineId = info.pipeline_id ?? this.currentPipelineId;
        if (info.uid) this.sessionUid = info.uid;
        this.setStartTime(this.parseStartTime(info.start_time));
        this.setBusy(!!info.busy);
        this.setActive(true);
        if (info.uid) {
          this.upsertSession({
            uid: info.uid,
            kind: 'interactive',
            status: 'running',
            pipeline_id: info.pipeline_id ?? this.currentPipelineId,
            last_active_at: new Date().toISOString(),
          } as PiSessionSummary);
        }
      } else {
        this.setBusy(false);
        this.setActive(false);
      }
      this.notifySessionChange();
      this.notifySessionsChange();
    } catch (e) {
      console.error('Failed to refresh interactive session', e);
    }
    return this.getCurrentSession();
  }

  // ---------------------------------------------------------------------------
  // Session cache / switcher API
  // ---------------------------------------------------------------------------

  /**
   * Boot sequence for the session manager: adopt a running session, load the
   * cached list and surface a one-click resume hint for the last session. The
   * hint is never auto-resumed (spawning a process has cost).
   */
  public async initialize(): Promise<void> {
    await this.refreshSession();
    await this.refreshSessions({ kind: 'interactive' });

    if (!this.isSessionActive) {
      const persisted = this.getPersistedSessionUid();
      const record = persisted ? this.sessions.get(persisted) : undefined;
      if (record && record.status !== 'discarded') {
        this.resumeHintUid = record.uid;
      }
    }
    this.notifySessionsChange();
  }

  /**
   * Fetch and merge the durable session list into the cache. Concurrent calls
   * share the same in-flight request.
   */
  public async refreshSessions(opts: RefreshSessionsOptions = {}): Promise<PiSessionSummary[]> {
    if (this.sessionsRequest) return this.sessionsRequest;

    this.sessionsLoading = true;
    this.sessionsError = null;
    this.notifySessionsChange();

    const request = this.listSessions(opts)
      .then((list) => {
        for (const record of Array.isArray(list) ? list : []) {
          if (opts.includeDiscarded === false && record.status === 'discarded') continue;
          this.upsertSession(record, false);
        }
        return this.getSessions();
      })
      .catch((e: unknown) => {
        this.sessionsError = e instanceof Error ? e.message : String(e);
        return this.getSessions();
      })
      .finally(() => {
        this.sessionsLoading = false;
        this.sessionsRequest = null;
        this.notifySessionsChange();
      });

    this.sessionsRequest = request;
    return request;
  }

  /** Cached sessions sorted for display: Active first, newest activity first. */
  public getSessions(): PiSessionSummary[] {
    return Array.from(this.sessions.values()).sort((a, b) => {
      const sw = statusWeight(a.status) - statusWeight(b.status);
      if (sw !== 0) return sw;
      return timeValue(b) - timeValue(a);
    });
  }

  public getSession(uid: string): PiSessionSummary | undefined {
    return this.sessions.get(uid);
  }

  public isSessionsLoading(): boolean {
    return this.sessionsLoading;
  }

  public getSessionsError(): string | null {
    return this.sessionsError;
  }

  /** The uid currently being switched to, or null. */
  public isSwitching(): string | null {
    return this.switchingUid;
  }

  /** The persisted session offered as a resume hint, if any. */
  public getResumeHint(): PiSessionSummary | null {
    if (!this.resumeHintUid) return null;
    return this.sessions.get(this.resumeHintUid) ?? null;
  }

  public dismissResumeHint(): void {
    this.resumeHintUid = null;
    this.notifySessionsChange();
  }

  public onSessionsChange(listener: SessionsListener): () => void {
    this.sessionsListeners.add(listener);
    return () => this.sessionsListeners.delete(listener);
  }

  /**
   * Switch to a session: the backend pauses the current running session and
   * resumes the target atomically. The cache is updated optimistically and then
   * reconciled against the server.
   */
  public async switchSession(uid: string): Promise<void> {
    if (uid === this.sessionUid && this.isSessionActive) return;

    const previous = this.sessionUid;
    this.switchingUid = uid;
    this.notifySessionsChange();
    try {
      await this.resumeSession(uid);
      // The backend pauses the previous session as part of the resume.
      if (previous && previous !== uid && this.sessions.has(previous)) {
        this.updateSessionStatus(previous, 'paused', undefined, false);
      }
      await this.refreshSessions({ kind: 'interactive' });
    } finally {
      this.switchingUid = null;
      this.notifySessionsChange();
    }
  }

  /** Discard a session and its retained workspace. */
  public async discardSession(uid: string): Promise<void> {
    const client = this.client as any;
    if (typeof client.discardSession === 'function') {
      await client.discardSession(uid);
    }
    this.updateSessionStatus(uid, 'discarded', {
      discarded_at: new Date().toISOString(),
    });
    if (this.sessionUid === uid) {
      this.sessionUid = null;
      this.setActive(false);
      this.persistSession();
    }
    this.notifySessionChange();
    this.notifySessionsChange();
  }

  /** Rename a session (Phase 3 backend endpoint). */
  public async renameSession(uid: string, label: string): Promise<void> {
    const client = this.client as any;
    let updated: PiSessionSummary | null = null;
    if (typeof client.updateSessionLabel === 'function') {
      updated = await client.updateSessionLabel(uid, label);
    }
    this.upsertSession((updated ?? { uid, label }) as PiSessionSummary);
    this.notifySessionsChange();
  }

  // -----------------------------------------------------------------------
  // Cache helpers
  // -----------------------------------------------------------------------

  private upsertSession(record: PiSessionSummary, notify: boolean = true): void {
    if (!record || !record.uid) return;
    const existing = this.sessions.get(record.uid);
    const merged: PiSessionSummary = { ...(existing ?? {}), ...record } as PiSessionSummary;
    this.sessions.set(record.uid, merged);
    if (notify) this.notifySessionsChange();
  }

  private updateSessionStatus(
    uid: string,
    status: PiSessionSummary['status'],
    patch?: Partial<PiSessionSummary>,
    notify: boolean = true
  ): void {
    const existing = this.sessions.get(uid);
    if (!existing) return;
    this.sessions.set(uid, { ...existing, status, ...(patch ?? {}) } as PiSessionSummary);
    if (notify) this.notifySessionsChange();
  }

  private notifySessionsChange(): void {
    const list = this.getSessions();
    this.sessionsListeners.forEach((l) => l(list));
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
