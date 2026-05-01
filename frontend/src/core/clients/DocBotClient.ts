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

import { BaseClient } from './BaseClient';
import { AuthService } from '../AuthService';

export class DocBotClient extends BaseClient {
  private apiBaseUrl: string;

  constructor(apiBaseUrl: string, authService: AuthService) {
    super(authService);
    this.apiBaseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
  }

  /**
   * Commits the reviewed changes proposed by DocBot.
   */
  public async commitChanges(pipelineId: string, taskId: string, commitMsg: string): Promise<void> {
    await this.fetch(`${this.apiBaseUrl}/pipelines/${pipelineId}/docbot/review/commit/${taskId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ commit_msg: commitMsg }),
    });
  }

  /**
   * Reverts the reviewed changes proposed by DocBot.
   */
  public async revertChanges(pipelineId: string, taskId: string): Promise<void> {
    await this.fetch(`${this.apiBaseUrl}/pipelines/${pipelineId}/docbot/review/revert/${taskId}`, {
      method: 'POST',
    });
  }

  /**
   * Cancels the DocBot review, notifying the backend.
   */
  public async cancelReview(pipelineId: string, taskId: string): Promise<void> {
    await this.fetch(`${this.apiBaseUrl}/pipelines/${pipelineId}/docbot/review/cancel/${taskId}`, {
      method: 'POST',
    });
  }
}
