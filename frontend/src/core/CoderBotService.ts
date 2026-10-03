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
import { PiLogReducer } from './PiLogReducer.ts';
import type { RenderBlock } from './PiLogReducer.ts';

export type { RenderBlock, BlockKind } from './PiLogReducer.ts';

export type CoderBotListener = (content: string) => void;

type BlockListener = (blocks: RenderBlock[]) => void;

/**
 * Service to manage the real-time activity log of the CoderBot.
 *
 * It subscribes to the structured `CODERBOT_RPC_EVENT` stream (the raw Pi RPC event
 * forwarded by the backend) and reduces it into a list of stable `RenderBlock`s that
 * the UI renders. The reduction itself lives in the shared {@link PiLogReducer},
 * which the interactive coding service reuses for an identical log rendering.
 * Legacy `ASSISTANT_STREAM` handling is preserved for bots other than CoderBot.
 */
export class CoderBotService {
  private wsClient: WebSocketClient;
  private authService: AuthService;
  private messageHistory: string = '';
  /** Shared RPC-event -> RenderBlock reducer. */
  private logReducer = new PiLogReducer();
  private listeners: Set<CoderBotListener> = new Set();
  private stateListeners: Set<(active: boolean) => void> = new Set();
  private sessionListeners: Set<() => void> = new Set();
  private currentTaskId: string | null = null;
  private currentPipelineId: string | null = null;
  private currentSessionUid: string | null = null;
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
      this.currentSessionUid = msg.payload?.session_uid ?? this.currentSessionUid;
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
        this.logReducer.handleEvent(msg.payload?.event);
      }
    });

    // Post-run test verification broadcast. Rendered as a distinct, boxed block
    // so the user can see whether the mandatory test suite passed or failed.
    this.wsClient.on('CODERBOT_VERIFICATION', (msg) => {
      if (msg.payload?.bot_type === 'coderbot') {
        this.logReducer.addVerificationBlock(msg.payload.result);
      }
    });

    // Broadcast emitted right before the post-run verification commands start,
    // so PiView can tell the user the mandatory test suite is now running.
    this.wsClient.on('CODERBOT_VERIFICATION_STARTED', (msg) => {
      if (msg.payload?.bot_type === 'coderbot') {
        this.logReducer.addBlock({
          kind: 'notice',
          text: '● Verification: running tests…',
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns the structured activity log blocks. */
  public getHistory(): RenderBlock[] {
    return this.logReducer.getBlocks();
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
    this.logReducer.clear();
    this.messageHistory = '';
    this.currentTaskId = null;
    this.notify('');
  }

  public onMessage(listener: CoderBotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to structured activity-log changes. Receives the full block list. */
  public onBlocks(listener: BlockListener): () => void {
    return this.logReducer.onBlocks(listener);
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
  public getCurrentSession(): { pipelineId: string | null; taskId: string | null; sessionUid?: string; active: boolean } | null {
    if (!this.currentTaskId) return null;
    return {
      pipelineId: this.currentPipelineId,
      taskId: this.currentTaskId,
      sessionUid: this.currentSessionUid ?? undefined,
      active: this.isSessionActive,
    };
  }

  /**
   * Resume a persisted batch session and enqueue a follow-up instruction.
   *
   * The backend respawns Pi with the session's native conversation file and the
   * retained workspace so the agent continues with its original context. The
   * resulting run produces a new commit and pull request linked to the same UID.
   */
  public async resumeSession(uid: string, message: string): Promise<void> {
    const token = this.authService.getAccessToken();
    const response = await fetch(`/api/coderbot/sessions/${uid}/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || 'Failed to resume CoderBot session');
    }
    const data = await response.json().catch(() => null);
    if (data?.task_id) this.currentTaskId = data.task_id;
    if (data?.pipeline_id) this.currentPipelineId = data.pipeline_id;
    this.currentSessionUid = uid;
    this.setSessionActive(true);
    this.persistSession();
    this.notifySessionChange();
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
        if (session.session_uid) this.currentSessionUid = session.session_uid;
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
      this.logReducer.emit();
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
      // The session start time is now delivered by the /session endpoint straight
      // from the backend's in-memory CoderBotManager (no longer read back from the
      // session log files), so it is adopted here cheaply rather than through the
      // history replay. Doing it first means the running-since display is anchored
      // to the real session start as soon as the history load resolves.
      try {
        const session = await this.fetchSession();
        if (session?.start_time) {
          this.setSessionStartTime(this.parseStartTime(session.start_time));
        }
      } catch (e) {
        console.error('Failed to adopt CoderBot session start time', e);
      }

      let events: any[] = [];
      try {
        events = await this.fetchSessionHistory(taskId);
      } catch (e) {
        console.error('Failed to load CoderBot session history', e);
      }

      // Rebuild the activity log by replaying the same reducer over the persisted
      // events, so past output of this session is preserved after a reload.
      //
      // Notification is suspended during the replay: a long session contains one
      // persisted event per streamed token, so emitting per event would make every
      // listener (e.g. PiView) reconcile the whole, ever-growing log once per token
      // (O(n²)), freezing the main thread. Instead we emit exactly one snapshot
      // once the replay has finished.
      const releaseEmits = this.logReducer.suspendEmits();
      try {
        this.logReducer.clear();
        for (const event of events) {
          this.logReducer.handleEvent(event);
        }
      } finally {
        releaseEmits();
      }
      this.loadedSessionKey = key;
      this.notify('');
    } finally {
      this.historyLoadPromise = null;
    }
  }

  private persistSession() {
    try {
      const data: Record<string, unknown> = {
        pipeline_id: this.currentPipelineId,
        task_id: this.currentTaskId,
        active: this.isSessionActive,
      };
      if (this.currentSessionUid) data.session_uid = this.currentSessionUid;
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
        this.currentSessionUid = s.session_uid || null;
        this.isSessionActive = !!s.active;
      }
    } catch (e) {
      /* ignore malformed storage */
    }
  }

  private async fetchSession(): Promise<{ pipeline_id?: string; task_id?: string; session_uid?: string; is_active?: boolean; start_time?: string | null } | null> {
    const token = this.authService.getAccessToken();
    const response = await fetch('/api/coderbot/session', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return await response.json();
  }

  private async fetchSessionHistory(taskId: string): Promise<any[]> {
    const token = this.authService.getAccessToken();
    const response = await fetch(`/api/coderbot/session/${taskId}/history`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.events) ? data.events : [];
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
