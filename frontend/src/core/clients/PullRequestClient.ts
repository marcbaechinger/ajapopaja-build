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

/** One changed local PR in the summary returned by the sync endpoint. */
export interface PullRequestSyncReconciled {
  pr_id: string;
  gitea_pr?: number | null;
  remote_state?: string;
  outcome?: string;
  task_id?: string;
  task_status?: string;
}

/** Body returned by `POST /api/pipelines/{id}/pull_requests/sync`. */
export interface PullRequestSyncResult {
  /** `ok` | `busy` | `sync_failed` | `already_running`. */
  status?: string;
  up_to_date: boolean;
  reconciled: PullRequestSyncReconciled[];
}

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

  async acceptPullRequest(
    prId: string,
    commitMessage?: string,
    failureStrategy: string = 'revert',
    force: boolean = false,
  ): Promise<void> {
    await this.fetch(`/api/pull_requests/${prId}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        commit_message: commitMessage,
        failure_strategy: failureStrategy,
        force,
      }),
    });
  }

  /**
   * Force an outbound reconciliation of a pipeline's Gitea PR state onto the
   * local PR/task records. Reuses the backend notifier/poller path; only acts
   * on SUBMITTED PRs, so it is safe to call repeatedly.
   */
  async syncPullRequests(pipelineId: string): Promise<PullRequestSyncResult> {
    const response = await this.fetch(
      `/api/pipelines/${pipelineId}/pull_requests/sync`,
      { method: 'POST' },
    );
    const data = await response.json();
    return {
      status: data?.status,
      up_to_date: Boolean(data?.up_to_date),
      reconciled: Array.isArray(data?.reconciled) ? data.reconciled : [],
    };
  }

  async rejectPullRequest(prId: string): Promise<void> {
    await this.fetch(`/api/pull_requests/${prId}/reject`, {
      method: 'POST',
    });
  }

  async iteratePullRequest(prId: string, comments: string): Promise<void> {
    await this.fetch(`/api/pull_requests/${prId}/iterate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comments }),
    });
  }
}
