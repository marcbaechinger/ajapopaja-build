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

import type { DesignDocContent, DesignDocListResponse } from '../domain.ts';
import { BaseClient } from './BaseClient.ts';
import { AuthService } from '../AuthService.ts';

/**
 * Client for the read-only design-doc library endpoints. It lists the Markdown
 * documents under a pipeline's ``doc_root`` (optionally filtered by a search
 * query) and fetches the raw Markdown of a single document.
 */
export class DesignDocClient extends BaseClient {
  private baseUrl: string;

  constructor(baseUrl: string, authService: AuthService) {
    super(authService);
    this.baseUrl = baseUrl;
  }

  async list(pipelineId: string, query?: string): Promise<DesignDocListResponse> {
    const url = new URL(
      `${this.baseUrl}/pipelines/${pipelineId}/design-docs`
    );
    if (query && query.trim()) {
      url.searchParams.append('q', query.trim());
    }
    const response = await this.fetch(url.toString());
    return await response.json();
  }

  async getContent(pipelineId: string, path: string): Promise<DesignDocContent> {
    const url = new URL(
      `${this.baseUrl}/pipelines/${pipelineId}/design-docs/content`
    );
    url.searchParams.append('path', path);
    const response = await this.fetch(url.toString());
    return await response.json();
  }
}
