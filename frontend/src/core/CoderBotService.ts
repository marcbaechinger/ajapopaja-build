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

export type CoderBotListener = (content: string) => void;

/**
 * Service to manage the real-time message history of the CoderBot.
 * It listens for ASSISTANT_STREAM messages and maintains a persistent history
 * for the duration of a bot session.
 */
export class CoderBotService {
  private wsClient: WebSocketClient;
  private messageHistory: string = '';
  private listeners: Set<CoderBotListener> = new Set();
  private currentTaskId: string | null = null;

  constructor(wsClient: WebSocketClient) {
    this.wsClient = wsClient;
    this.setupHandlers();
  }

  private setupHandlers() {
    this.wsClient.on('CODERBOT_STARTED', (msg) => {
      const taskId = msg.payload?.task_id;
      if (taskId !== this.currentTaskId) {
        this.clearHistory();
        this.currentTaskId = taskId;
      }
    });

    this.wsClient.on('ASSISTANT_STREAM', (msg) => {
      if (msg.payload?.bot_type === 'coderbot') {
        const content = msg.payload.content || '';
        this.messageHistory += content;
        this.notify(content);
      }
    });
  }

  public getHistory(): string {
    return this.messageHistory;
  }

  public clearHistory() {
    this.messageHistory = '';
    this.currentTaskId = null;
    this.notify(''); // Notify listeners that history was cleared
  }

  public onMessage(listener: CoderBotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(content: string) {
    this.listeners.forEach(l => l(content));
  }
}
