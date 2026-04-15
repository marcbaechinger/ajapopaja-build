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

import { Pipeline } from '../domain.ts';
import { BaseClient } from './BaseClient.ts';
import { AuthService } from '../AuthService.ts';

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

  async create(name: string): Promise<Pipeline> {
    const response = await this.fetch(`${this.baseUrl}/pipelines/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    return new Pipeline(await response.json());
  }

  async update(id: string, name: string, version: number): Promise<Pipeline> {
    try {
      const response = await this.fetch(`${this.baseUrl}/pipelines/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, version })
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
}
