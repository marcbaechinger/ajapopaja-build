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
import { DirectoryListing, FileContent, FileEntry, FileSearchResponse } from '../domain.ts';

/**
 * HTTP client for the pipeline file-browser endpoints.
 *
 * All paths are repository-relative POSIX strings; the client never sends an
 * absolute path. Authentication, token refresh and error mapping are inherited
 * from {@link BaseClient}.
 */
export class FileBrowserClient extends BaseClient {
  private baseUrl: string;

  constructor(baseUrl: string, authService: AuthService) {
    super(authService);
    this.baseUrl = baseUrl;
  }

  async listDirectory(pipelineId: string, path: string = ''): Promise<DirectoryListing> {
    const params = new URLSearchParams({ path });
    const response = await this.fetch(
      `${this.baseUrl}/pipelines/${pipelineId}/files/?${params.toString()}`
    );
    return new DirectoryListing(await response.json());
  }

  async readFile(pipelineId: string, path: string): Promise<FileContent> {
    const params = new URLSearchParams({ path });
    const response = await this.fetch(
      `${this.baseUrl}/pipelines/${pipelineId}/files/content?${params.toString()}`
    );
    return new FileContent(await response.json());
  }

  async getMeta(pipelineId: string, path: string): Promise<FileEntry> {
    const params = new URLSearchParams({ path });
    const response = await this.fetch(
      `${this.baseUrl}/pipelines/${pipelineId}/files/meta?${params.toString()}`
    );
    return new FileEntry(await response.json());
  }

  /**
   * Mint a short-lived, path-bound token for the raw file endpoint. Goes
   * through {@link BaseClient} so it inherits the bearer token and the 401
   * refresh/retry behaviour.
   */
  async createRawFileToken(
    pipelineId: string,
    path: string
  ): Promise<{ token: string; expiresIn: number }> {
    const params = new URLSearchParams({ path });
    const response = await this.fetch(
      `${this.baseUrl}/pipelines/${pipelineId}/files/raw-url?${params.toString()}`,
      { method: 'POST' }
    );
    const data = await response.json();
    return {
      token: String(data?.token ?? ''),
      expiresIn: Number(data?.expires_in ?? 0),
    };
  }

  /**
   * Build the token-bearing URL a browser tab can navigate to directly. The
   * token is URL-encoded because it is a JWT and contains dot-separated
   * segments but no reserved characters that are safe to leave unescaped.
   */
  rawFileUrl(pipelineId: string, token: string): string {
    return `${this.baseUrl}/pipelines/${pipelineId}/files/raw?token=${encodeURIComponent(token)}`;
  }

  /**
   * Search the pipeline repository for filenames/paths. The optional abort
   * signal cancels a superseded as-you-type request.
   */
  async searchFiles(
    pipelineId: string,
    query: string,
    signal?: AbortSignal,
    limit?: number
  ): Promise<FileSearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (limit !== undefined) params.set('limit', String(limit));
    const response = await this.fetch(
      `${this.baseUrl}/pipelines/${pipelineId}/files/search?${params.toString()}`,
      { signal }
    );
    return new FileSearchResponse(await response.json());
  }
}
