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

import { AuthService } from '../AuthService.ts';

/**
 * Error thrown for a non-2xx API response. It preserves the HTTP status so
 * callers can make decisions based on a specific code (e.g. the 409
 * "older pull request is still open" conflict) while still carrying the
 * server-provided `detail` in `message` for existing alert() call sites.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = message;
  }
}

export class BaseClient {
  protected authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService;
  }

  protected async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers || {});
    const token = this.authService.getAccessToken();
    
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      // Try refresh
      const newToken = await this.authService.refreshToken();
      if (newToken) {
        headers.set('Authorization', `Bearer ${newToken}`);
        response = await fetch(url, { ...options, headers });
      } else {
        // Redirect to login handled by App/Navigator
      }
    }

    if (!response.ok && response.status !== 401) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new ApiError(
        error.detail || `HTTP error! status: ${response.status}`,
        response.status,
      );
    }

    return response;
  }
}
