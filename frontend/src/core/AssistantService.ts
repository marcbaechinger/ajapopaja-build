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

import { WebSocketClient } from './WebSocketClient.ts';
import { AuthService } from './AuthService.ts';

export interface AssistantResponse {
  type: 'chunk' | 'tool_request' | 'error' | 'cleared' | 'assistant_history' | 'thinking';
  content?: string;
  id?: string;
  tool?: string;
  arguments?: any;
  message?: string;
  messages?: any[];
}

export class AssistantService {
  private wsClient: WebSocketClient;
  private authService: AuthService;
  private listeners: ((response: AssistantResponse) => void)[] = [];

  constructor(wsClient: WebSocketClient, authService: AuthService) {
    this.wsClient = wsClient;
    this.authService = authService;
    this.setupHandlers();
  }

  private setupHandlers() {
    this.wsClient.on('assistant_response', (message) => {
      this.notify(message.payload);
    });
    this.wsClient.on('assistant_error', (message) => {
      this.notify({ type: 'error', message: message.payload.message });
    });
  }

  public sendMessage(text: string) {
    this.wsClient.send('assistant_message', {
      text,
      token: this.authService.getAccessToken()
    });
  }

  public confirmTool(toolCallId: string) {
    this.wsClient.send('assistant_confirm', {
      tool_call_id: toolCallId,
      token: this.authService.getAccessToken()
    });
  }

  public rejectTool(toolCallId: string) {
    this.wsClient.send('assistant_reject', {
      tool_call_id: toolCallId,
      token: this.authService.getAccessToken()
    });
  }

  public clearHistory() {
    this.wsClient.send('assistant_clear', {
      token: this.authService.getAccessToken()
    });
  }

  public requestHistory() {
    this.wsClient.send('assistant_load_history', {
      token: this.authService.getAccessToken()
    });
  }

  public onResponse(listener: (response: AssistantResponse) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(response: AssistantResponse) {
    this.listeners.forEach(l => l(response));
  }
}
