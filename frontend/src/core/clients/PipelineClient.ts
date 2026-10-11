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

import { Pipeline, PipelineStatus, CommitDiff, type GitStatusDetails, type GitLogResponse } from '../domain.ts';
import { BaseClient } from './BaseClient.ts';
import { AuthService } from '../AuthService.ts';

export interface DevServerStatus {
  pipeline_id?: string;
  running: boolean;
  status: string;
  pid: number | null;
  exit_code: number | null;
  run_id: string | null;
  port: number;
  target?: string | null;
  task_id?: string | null;
  branch?: string | null;
}

/** Select-list data for the pipeline model configuration dialog. */
export interface ModelOptions {
  ollama: string[];
  coderbot: string[];
  error?: string | null;
}

export class PipelineClient extends BaseClient {
  private baseUrl: string;

  constructor(baseUrl: string, authService: AuthService) {
    super(authService);
    this.baseUrl = baseUrl;
  }

  async list(includeDeleted: boolean = false): Promise<Pipeline[]> {
    const url = new URL(`${this.baseUrl}/pipelines/`);
    if (includeDeleted) url.searchParams.append('include_deleted', 'true');
    const response = await this.fetch(url.toString());
    const data = await response.json();
    return data.map((p: any) => new Pipeline(p));
  }

  async get(id: string, includeDeleted: boolean = false): Promise<Pipeline> {
    const url = new URL(`${this.baseUrl}/pipelines/${id}`);
    if (includeDeleted) url.searchParams.append('include_deleted', 'true');
    const response = await this.fetch(url.toString());
    return new Pipeline(await response.json());
  }

  async create(payload: {
    name: string;
    workspace_path?: string | null;
    repo_uri?: string | null;
    repo_username?: string | null;
    repo_token?: string | null;
    doc_root?: string;
    test_commands?: string[][] | null;
    lint_commands?: string[][] | null;
    serve_commands?: string[][] | null;
    build_commands?: string[][] | null;
    ollama_model?: string | null;
    one_prompt_model?: string | null;
    assistant_model?: string | null;
    archbot_model?: string | null;
    reviewbot_model?: string | null;
    docbot_model?: string | null;
    specagent_model?: string | null;
    coderbot_model?: string | null;
  }): Promise<Pipeline> {
    const response = await this.fetch(`${this.baseUrl}/pipelines/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return new Pipeline(await response.json());
  }

  async update(id: string, version: number, partial: { name?: string, status?: PipelineStatus, workspace_path?: string | null, repo_uri?: string | null, repo_username?: string | null, repo_token?: string | null, doc_root?: string, test_commands?: string[][] | null, lint_commands?: string[][] | null, serve_commands?: string[][] | null, build_commands?: string[][] | null, ollama_model?: string | null, one_prompt_model?: string | null, assistant_model?: string | null, archbot_model?: string | null, reviewbot_model?: string | null, docbot_model?: string | null, specagent_model?: string | null, coderbot_model?: string | null }): Promise<Pipeline> {
    try {
      const response = await this.fetch(`${this.baseUrl}/pipelines/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, ...partial })
      });
      return new Pipeline(await response.json());
    } catch (e: any) {
      if (e.message?.includes('409') || e.message?.includes('OCC_CONFLICT')) {
        throw new Error('OCC_CONFLICT');
      }
      throw e;
    }
  }

  async delete(id: string): Promise<void> {
    await this.fetch(`${this.baseUrl}/pipelines/${id}`, {
      method: 'DELETE'
    });
  }

  async getDailyStats(id: string): Promise<any[]> {
    const response = await this.fetch(`${this.baseUrl}/pipelines/${id}/stats/daily`);
    return await response.json();
  }

  async getCommitDiff(pipelineId: string, commitHash: string): Promise<CommitDiff> {
    const response = await this.fetch(
      `${this.baseUrl}/pipelines/${pipelineId}/commits/${encodeURIComponent(commitHash)}/diff`
    );
    return new CommitDiff(await response.json());
  }

  async getGitStatus(pipelineId: string): Promise<GitStatusDetails> {
    const response = await this.fetch(`${this.baseUrl}/pipelines/${pipelineId}/git-status`);
    return await response.json();
  }

  async getGitLog(pipelineId: string, limit: number = 50, offset: number = 0): Promise<GitLogResponse> {
    const response = await this.fetch(
      `${this.baseUrl}/pipelines/${pipelineId}/git-log?limit=${limit}&offset=${offset}`
    );
    return await response.json();
  }

  async getModelOptions(pipelineId: string): Promise<ModelOptions> {
    const response = await this.fetch(
      `${this.baseUrl}/pipelines/${pipelineId}/model-options`
    );
    return await response.json();
  }

  async pull(pipelineId: string): Promise<{ status: string; message: string }> {
    const response = await this.fetch(`${this.baseUrl}/pipelines/${pipelineId}/pull`, {
      method: 'POST',
    });
    return await response.json();
  }

  async getDevServerStatus(id: string): Promise<DevServerStatus> {
    const response = await this.fetch(`${this.baseUrl}/pipelines/${id}/dev/status`);
    return await response.json();
  }

  async startDevServer(id: string): Promise<DevServerStatus> {
    const response = await this.fetch(`${this.baseUrl}/pipelines/${id}/dev/start`, {
      method: 'POST',
    });
    return await response.json();
  }

  async startDevServerOnPr(pipelineId: string, prId: string): Promise<DevServerStatus> {
    const response = await this.fetch(
      `${this.baseUrl}/pipelines/${pipelineId}/pull_requests/${prId}/dev/start`,
      { method: 'POST' }
    );
    return await response.json();
  }

  async stopDevServer(id: string): Promise<DevServerStatus> {
    const response = await this.fetch(`${this.baseUrl}/pipelines/${id}/dev/stop`, {
      method: 'POST',
    });
    return await response.json();
  }

  async resetDevServerToDefaultBranch(id: string): Promise<DevServerStatus> {
    const response = await this.fetch(
      `${this.baseUrl}/pipelines/${id}/dev/default-branch`,
      { method: 'POST' },
    );
    return await response.json();
  }
}
