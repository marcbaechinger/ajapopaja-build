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

/** An elaborated specification awaiting human accept/reject. */
export interface SpecProposal {
  task_id: string;
  pipeline_id: string;
  spec_md: string;
  rationale?: string;
}

/**
 * Client for the SpecAgent endpoints. Mirrors {@link ArchBotClient}: trigger a
 * bot session, fetch an outstanding proposal, and clear a rejected proposal.
 */
export class SpecBotClient extends BaseClient {
  private apiBaseUrl: string;

  constructor(apiBaseUrl: string, authService: AuthService) {
    super(authService);
    this.apiBaseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
  }

  /** Enqueues a SpecAgent session to elaborate the task's specification. */
  async trigger(pipelineId: string, taskId: string): Promise<void> {
    await this.fetch(`${this.apiBaseUrl}/pipelines/${pipelineId}/specagent/trigger/${taskId}`, {
      method: 'POST'
    });
  }

  /** Returns the outstanding elaborated-spec proposal for a task. */
  async getProposal(pipelineId: string, taskId: string): Promise<SpecProposal> {
    const response = await this.fetch(
      `${this.apiBaseUrl}/pipelines/${pipelineId}/specagent/proposal/${taskId}`
    );
    return (await response.json()) as SpecProposal;
  }

  /** Clears a proposal (used on reject, and after an accepted proposal). */
  async rejectProposal(pipelineId: string, taskId: string): Promise<void> {
    await this.fetch(`${this.apiBaseUrl}/pipelines/${pipelineId}/specagent/proposal/${taskId}`, {
      method: 'DELETE'
    });
  }
}
