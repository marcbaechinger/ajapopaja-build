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
import { AuthService } from '../AuthService.ts';

export class EditorClient extends BaseClient {
  private baseUrl: string;

  constructor(baseUrl: string, authService: AuthService) {
    super(authService);
    this.baseUrl = baseUrl;
  }

  async call(command: string, options: Record<string, any>): Promise<void> {
    await this.fetch(`${this.baseUrl}/editor/call/${command}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  }

  async quickfix(taskId: string): Promise<void> {
    return this.call('quickfix', { task_id: taskId });
  }

  async diffViewOpen(pipelineId: string, commitHash: string): Promise<void> {
    return this.call('diff_view_open', { pipeline_id: pipelineId, commit_hash: commitHash });
  }
}
