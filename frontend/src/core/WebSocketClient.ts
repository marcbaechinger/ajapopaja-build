import type { WSMessage } from './domain.ts';

export type WSHandler = (message: WSMessage) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<WSHandler>> = new Map();
  private reconnectTimeout: number = 2000;
  private maxReconnectTimeout: number = 30000;
  private currentReconnectTimeout: number = 2000;
  private url: string;

  constructor(_apiBaseUrl: string) {
    // Connect to root /ws to avoid static file mount issues
    this.url = 'ws://localhost:8000/ws/browser';
  }


  public connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    console.log('Connecting to WebSocket:', this.url);
    this.ws = new WebSocket(this.url);

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

  private notifyHandlers(message: WSMessage) {
    // Notify specific type handlers
    this.handlers.get(message.type)?.forEach(handler => handler(message));
    // Notify catch-all handlers if any (using '*' as type)
    this.handlers.get('*')?.forEach(handler => handler(message));
  }
}
