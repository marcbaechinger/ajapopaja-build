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
}
