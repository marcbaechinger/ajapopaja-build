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

import { BaseClient } from './BaseClient.ts';

export interface PiSessionSummary {
  uid: string;
  kind: string;
  status: string;
  owner?: string | null;
  label?: string | null;
  pipeline_id?: string | null;
  task_id?: string | null;
  pull_request_ids?: string[];
  pi_session_id?: string | null;
  pi_session_file?: string | null;
  session_dir?: string | null;
  cwd?: string | null;
  workspace_path?: string | null;
  model?: string | null;
  bot_type?: string;
  base_commit?: string | null;
  branch_name?: string | null;
  resume_count?: number;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
  last_active_at?: string | null;
  discarded_at?: string | null;
}

export class CoderBotClient extends BaseClient {
  async triggerCoderBot(taskId: string): Promise<void> {
    await this.fetch(`/api/coderbot/trigger/${taskId}`, {
      method: 'POST',
    });
  }

  async getSession(): Promise<{ pipeline_id: string; task_id: string; is_active: boolean } | null> {
    const res = await this.fetch(`/api/coderbot/session`, {});
    if (!res.ok) return null;
    return await res.json();
  }

  async getSessionHistory(taskId: string): Promise<any[]> {
    const res = await this.fetch(`/api/coderbot/session/${taskId}/history`, {});
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.events) ? data.events : [];
  }

  // ---------------------------------------------------------------------------
  // Interactive session endpoints
  // ---------------------------------------------------------------------------

  async startInteractiveSession(pipelineId: string): Promise<{
    pipeline_id: string;
    is_active: boolean;
    start_time: string | null;
    busy: boolean;
  }> {
    const res = await this.fetch(`/api/coderbot/interactive/start/${pipelineId}`, {
      method: 'POST',
    });
    return await res.json();
  }

  async sendInteractiveMessage(message: string): Promise<void> {
    await this.fetch(`/api/coderbot/interactive/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  }

  async stopInteractiveSession(): Promise<void> {
    await this.fetch(`/api/coderbot/interactive/stop`, {
      method: 'POST',
    });
  }

  async getInteractiveSession(): Promise<{
    pipeline_id: string;
    is_active: boolean;
    start_time: string | null;
    busy: boolean;
  } | null> {
    const res = await this.fetch(`/api/coderbot/interactive/session`, {});
    if (!res.ok) return null;
    return await res.json();
  }

  // ---------------------------------------------------------------------------
  // Persistent Pi session endpoints
  // ---------------------------------------------------------------------------

  async listSessions(options?: {
    kind?: string;
    status?: string;
    pipelineId?: string;
  }): Promise<PiSessionSummary[]> {
    const params = new URLSearchParams();
    if (options?.kind) params.set('kind', options.kind);
    if (options?.status) params.set('status', options.status);
    if (options?.pipelineId) params.set('pipeline_id', options.pipelineId);
    const query = params.toString();
    const res = await this.fetch(`/api/coderbot/sessions${query ? `?${query}` : ''}`, {});
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.sessions) ? data.sessions : [];
  }

  async createSession(
    pipelineId: string,
    kind: string = 'interactive',
    label?: string
  ): Promise<PiSessionSummary> {
    const res = await this.fetch(`/api/coderbot/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipeline_id: pipelineId, kind, label }),
    });
    return await res.json();
  }

  async getSessionDetail(uid: string): Promise<PiSessionSummary | null> {
    const res = await this.fetch(`/api/coderbot/sessions/${uid}`, {});
    if (!res.ok) return null;
    return await res.json();
  }

  async pauseSession(uid: string): Promise<void> {
    await this.fetch(`/api/coderbot/sessions/${uid}/pause`, { method: 'POST' });
  }

  async resumeSession(uid: string): Promise<PiSessionSummary> {
    const res = await this.fetch(`/api/coderbot/sessions/${uid}/resume`, {
      method: 'POST',
    });
    return await res.json();
  }

  async discardSession(uid: string): Promise<void> {
    await this.fetch(`/api/coderbot/sessions/${uid}/discard`, { method: 'POST' });
  }

  async getSessionEvents(uid: string): Promise<any[]> {
    const res = await this.fetch(`/api/coderbot/sessions/${uid}/history`, {});
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.events) ? data.events : [];
  }

  async sendSessionMessage(uid: string, message: string): Promise<void> {
    await this.fetch(`/api/coderbot/sessions/${uid}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  }
}
