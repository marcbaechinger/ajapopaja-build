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

import type { WSMessage } from './domain.ts';
import { AuthService } from './AuthService.ts';

export type WSHandler = (message: WSMessage) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<WSHandler>> = new Map();
  private reconnectTimeout: number = 2000;
  private maxReconnectTimeout: number = 30000;
  private currentReconnectTimeout: number = 2000;
  private baseUrl: string;
  private authService: AuthService;
  private clientId: string;

  constructor(apiBaseUrl: string, authService: AuthService) {
    // Generate a unique client ID for this session/tab
    this.clientId = Math.random().toString(16).substring(2, 10);
    
    // Derive WS URL from API base URL (e.g., http://host:port/api -> ws://host:port/ws/{clientId})
    const url = new URL(apiBaseUrl);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    // We connect to /ws/{clientId} relative to the host, avoiding the /api prefix
    this.baseUrl = `${protocol}//${url.host}/ws/${this.clientId}`;
    this.authService = authService;
  }


  public connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const token = this.authService.getAccessToken();
    const url = token ? `${this.baseUrl}?token=${token}` : this.baseUrl;

    console.log('Connecting to WebSocket:', this.baseUrl);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('WebSocket Connected');
      this.currentReconnectTimeout = this.reconnectTimeout;
    };

    this.ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        this.notifyHandlers(message);
      } catch (error) {
        console.error('Error parsing WS message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket Closed. Reconnecting in', this.currentReconnectTimeout, 'ms');
      setTimeout(() => {
        this.currentReconnectTimeout = Math.min(this.currentReconnectTimeout * 2, this.maxReconnectTimeout);
        this.connect();
      }, this.currentReconnectTimeout);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
    };
  }

  public on(type: string, handler: WSHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.off(type, handler);
  }

  public off(type: string, handler: WSHandler) {
    this.handlers.get(type)?.delete(handler);
  }

  public send(type: string, payload: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('WebSocket not connected. Message not sent:', type);
    }
  }

  private notifyHandlers(message: WSMessage) {
    // Notify specific type handlers
    this.handlers.get(message.type)?.forEach(handler => handler(message));
    // Notify catch-all handlers if any (using '*' as type)
    this.handlers.get('*')?.forEach(handler => handler(message));
  }
}
