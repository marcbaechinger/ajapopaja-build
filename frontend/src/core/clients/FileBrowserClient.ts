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
import { DirectoryListing, FileContent, FileEntry } from '../domain.ts';

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
}
