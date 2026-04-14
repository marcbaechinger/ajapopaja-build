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

import { Task, TaskStatus } from '../domain.ts';
import { BaseClient } from './BaseClient.ts';
import { AuthService } from '../AuthService.ts';

export class TaskClient extends BaseClient {
  private baseUrl: string;

  constructor(baseUrl: string, authService: AuthService) {
    super(authService);
    this.baseUrl = baseUrl;
  }

  async listByPipeline(pipelineId: string, includeDeleted: boolean = false): Promise<Task[]> {
    const url = new URL(`${this.baseUrl}/pipelines/${pipelineId}/tasks/`);
    if (includeDeleted) url.searchParams.append('include_deleted', 'true');
    const response = await this.fetch(url.toString());
    return await response.json();
  }

  async listCompletedByPipeline(pipelineId: string, page: number = 0, limit: number = 5): Promise<{tasks: Task[], total_count: number}> {
    const url = new URL(`${this.baseUrl}/pipelines/${pipelineId}/tasks/completed`);
    url.searchParams.append('page', page.toString());
    url.searchParams.append('limit', limit.toString());
    const response = await this.fetch(url.toString());
    return await response.json();
  }

  async get(id: string, includeDeleted: boolean = false): Promise<Task> {
    const url = new URL(`${this.baseUrl}/tasks/${id}`);
    if (includeDeleted) url.searchParams.append('include_deleted', 'true');
    const response = await this.fetch(url.toString());
    return await response.json();
  }

  async create(pipelineId: string, title: string, design_doc?: string, spec?: string, want_design_doc?: boolean): Promise<Task> {
    const response = await this.fetch(`${this.baseUrl}/pipelines/${pipelineId}/tasks/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, pipeline_id: pipelineId, design_doc, spec, want_design_doc })
    });
    return await response.json();
  }

  async updateStatus(id: string, status: TaskStatus, version: number): Promise<Task> {
    try {
      const response = await this.fetch(`${this.baseUrl}/tasks/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, version })
      });
      return await response.json();
    } catch (e: any) {
      if (e.message?.includes('409') || e.message?.includes('OCC_CONFLICT')) {
        throw new Error('OCC_CONFLICT');
      }
      throw e;
    }
  }

  async updateDetails(id: string, version: number, details: Partial<{title: string, description: string, order: number, design_doc: string, spec: string, want_design_doc: boolean}>): Promise<Task> {
    try {
      const response = await this.fetch(`${this.baseUrl}/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, ...details })
      });
      return await response.json();
    } catch (e: any) {
      if (e.message?.includes('409') || e.message?.includes('OCC_CONFLICT')) {
        throw new Error('OCC_CONFLICT');
      }
      throw e;
    }
  }

  async complete(id: string, version: number, commit_hash: string, completion_info: string): Promise<Task> {
    try {
      const response = await this.fetch(`${this.baseUrl}/tasks/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, commit_hash, completion_info })
      });
      return await response.json();
    } catch (e: any) {
      if (e.message?.includes('409') || e.message?.includes('OCC_CONFLICT')) {
        throw new Error('OCC_CONFLICT');
      }
      throw e;
    }
  }

  async acceptDesign(id: string, version: number): Promise<Task> {
    try {
      const response = await this.fetch(`${this.baseUrl}/tasks/${id}/accept-design`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version })
      });
      return await response.json();
    } catch (e: any) {
      if (e.message?.includes('409') || e.message?.includes('OCC_CONFLICT')) {
        throw new Error('OCC_CONFLICT');
      }
      throw e;
    }
  }

  async rejectDesign(id: string, version: number): Promise<Task> {
    try {
      const response = await this.fetch(`${this.baseUrl}/tasks/${id}/reject-design`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version })
      });
      return await response.json();
    } catch (e: any) {
      if (e.message?.includes('409') || e.message?.includes('OCC_CONFLICT')) {
        throw new Error('OCC_CONFLICT');
      }
      throw e;
    }
  }

  async getNextTask(pipelineId: string): Promise<Task | null> {
    const response = await this.fetch(`${this.baseUrl}/pipelines/${pipelineId}/tasks/next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    return await response.json();
  }

  async delete(id: string): Promise<void> {
    await this.fetch(`${this.baseUrl}/tasks/${id}`, {
      method: 'DELETE'
    });
  }
}
