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

export interface HealthCheckResponse {
  mongodb: { status: string; details: string };
  ollama: { status: string; details: string };
  nvim: { status: string; details: string };
}

export class SystemClient extends BaseClient {
  constructor(authService: AuthService) {
    super(authService);
  }

  async getHealth(): Promise<HealthCheckResponse> {
    try {
      const response = await this.fetch('/api/system/health');
      return await response.json();
    } catch (e) {
      console.error('Failed to fetch health check', e);
      throw e;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const response = await this.fetch('/api/version');
      const data = await response.json();
      return data.version;
    } catch (e) {
      console.error('Failed to fetch version', e);
      return 'unknown';
    }
  }
}
