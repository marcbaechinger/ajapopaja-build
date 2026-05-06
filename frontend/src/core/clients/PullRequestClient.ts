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
import { PullRequest } from '../domain.ts';

export class PullRequestClient extends BaseClient {
  async getPullRequestsByPipeline(pipelineId: string): Promise<PullRequest[]> {
    const response = await this.fetch(`/api/pull_requests/pipeline/${pipelineId}`);
    const data = await response.json();
    return data.map((pr: any) => new PullRequest(pr));
  }

  async getPullRequestByTask(taskId: string): Promise<PullRequest | null> {
    const response = await this.fetch(`/api/pull_requests/task/${taskId}`);
    if (response.status === 404) return null;
    const data = await response.json();
    return data ? new PullRequest(data) : null;
  }

  async getPullRequest(prId: string): Promise<PullRequest | null> {
    const response = await this.fetch(`/api/pull_requests/${prId}`);
    if (response.status === 404) return null;
    const data = await response.json();
    return data ? new PullRequest(data) : null;
  }

  async acceptPullRequest(prId: string, commitMessage?: string, failureStrategy: string = 'revert'): Promise<void> {
    await this.fetch(`/api/pull_requests/${prId}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        commit_message: commitMessage,
        failure_strategy: failureStrategy
      }),
    });
  }

  async rejectPullRequest(prId: string): Promise<void> {
    await this.fetch(`/api/pull_requests/${prId}/reject`, {
      method: 'POST',
    });
  }
}
