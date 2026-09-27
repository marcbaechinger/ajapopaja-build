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

/**
 * Frontend half of the notification protocol.
 *
 * The service owns everything a component would otherwise repeat:
 *
 * * subscribes to `NOTIFICATION` and converts payloads into
 *   {@link AppNotification} objects (de-duplicating by id so reconnects or
 *   replayed messages cannot double-present);
 * * presents by kind — `message` as a toast, `confirmation`/`actions` as a
 *   dialog;
 * * sends the chosen action back through the shared WebSocket as an
 *   authenticated `notification_action`;
 * * subscribes to `NOTIFICATION_ACTION_RESULT` and surfaces the outcome.
 *
 * Dismissing a notification is purely local and never sends anything, matching
 * the specification.
 */

import {
  AppNotification,
  NotificationSeverity,
  NotificationType,
} from './domain.ts';
import type { NotificationAction, WSMessage } from './domain.ts';
import type { WebSocketClient } from './WebSocketClient.ts';
import type { AuthService } from './AuthService.ts';
import { NotificationToast } from '../ui/components/NotificationToast.ts';
import { NotificationDialog } from '../ui/components/NotificationDialog.ts';

// Message types (mirrors api/notifications/ws_handler.py).
export const NOTIFICATION = 'NOTIFICATION';
export const NOTIFICATION_ACTION = 'notification_action';
export const NOTIFICATION_ACTION_RESULT = 'NOTIFICATION_ACTION_RESULT';

/** Outcome of a backend action execution, as relayed to the client. */
export interface NotificationActionResult {
  notification_id: string;
  action: string;
  status: string;
  result?: any;
  error?: string | null;
}

export type NotificationResultListener = (result: NotificationActionResult) => void;

export class NotificationService {
  private wsClient: WebSocketClient;
  private authService: AuthService;
  private seen: Set<string> = new Set();
  private unsubscribers: Array<() => void> = [];
  private dialogs: Map<string, NotificationDialog> = new Map();
  private resultListeners: Set<NotificationResultListener> = new Set();

  constructor(wsClient: WebSocketClient, authService: AuthService) {
    this.wsClient = wsClient;
    this.authService = authService;
    // Create the toast container eagerly; guarded for a headless/jsdom DOM.
    NotificationToast.ensureTray();
    this.unsubscribers.push(
      this.wsClient.on(NOTIFICATION, (message) => this.handleNotification(message)),
    );
    this.unsubscribers.push(
      this.wsClient.on(NOTIFICATION_ACTION_RESULT, (message) =>
        this.handleActionResult(message),
      ),
    );
  }

  /** Inbound `NOTIFICATION` handler: normalize, de-duplicate, present. */
  private handleNotification(message: WSMessage): void {
    const notification = new AppNotification(message.payload);
    if (!notification.id) notification.id = message.id || '';
    if (notification.id) {
      if (this.seen.has(notification.id)) return;
      this.seen.add(notification.id);
    }
    this.present(notification);
  }

  /** Presents a notification according to its kind. */
  private present(notification: AppNotification): void {
    switch (notification.type) {
      case NotificationType.MESSAGE:
        NotificationToast.show(notification);
        break;
      case NotificationType.CONFIRMATION:
      case NotificationType.ACTIONS:
        void this.presentDialog(notification);
        break;
      default:
        NotificationToast.show(notification);
        break;
    }
  }

  private async presentDialog(notification: AppNotification): Promise<void> {
    const dialog = new NotificationDialog(notification);
    this.dialogs.set(notification.id, dialog);
    try {
      const action = await dialog.show();
      if (action) {
        this.sendAction(notification, action);
      }
      // `null` means dismissed; the spec says send nothing.
    } finally {
      this.dialogs.delete(notification.id);
    }
  }

  /** Sends a confirmed/selected action to the backend for execution. */
  sendAction(notification: AppNotification, action: NotificationAction): void {
    this.wsClient.send(NOTIFICATION_ACTION, {
      notification_id: notification.id,
      action: action.name,
      data: action.data,
      token: this.authService.getAccessToken(),
    });
  }

  /** Inbound `NOTIFICATION_ACTION_RESULT` handler: surface the outcome. */
  private handleActionResult(message: WSMessage): void {
    const payload = (message.payload || {}) as Partial<NotificationActionResult>;
    const result: NotificationActionResult = {
      notification_id: payload.notification_id ?? message.id ?? '',
      action: payload.action ?? '',
      status: payload.status ?? 'error',
      result: payload.result,
      error: payload.error ?? null,
    };

    const failed =
      result.status !== 'ok' ||
      (result.result &&
        typeof result.result === 'object' &&
        result.result.ok === false);

    if (failed) {
      NotificationToast.show(
        new AppNotification({
          id: `result:${result.notification_id}:${result.action}`,
          type: NotificationType.MESSAGE,
          severity: NotificationSeverity.ERROR,
          title: 'Action failed',
          message:
            result.error ||
            (result.result?.error as string | undefined) ||
            `The action could not be executed (${result.status}).`,
        }),
      );
    } else {
      NotificationToast.show(
        new AppNotification({
          id: `result:${result.notification_id}:${result.action}`,
          type: NotificationType.MESSAGE,
          severity: NotificationSeverity.NORMAL,
          title: 'Action completed',
          message: this.describeResult(result.result),
        }),
      );
    }

    this.resultListeners.forEach((listener) => {
      try {
        listener(result);
      } catch (error) {
        console.error('Notification result listener failed:', error);
      }
    });
  }

  private describeResult(result: any): string {
    if (result === undefined || result === null) return '';
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
      if (typeof result.output === 'string') return result.output;
      if (typeof result.message === 'string') return result.message;
      try {
        return JSON.stringify(result);
      } catch {
        return String(result);
      }
    }
    return String(result);
  }

  /** Registers a listener for action results. Returns an unsubscriber. */
  onActionResult(listener: NotificationResultListener): () => void {
    this.resultListeners.add(listener);
    return () => {
      this.resultListeners.delete(listener);
    };
  }

  /** Removes every WebSocket handler the service registered. */
  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.dialogs.forEach((dialog) => {
      (dialog as unknown as { close: (result: null) => void }).close(null);
    });
    this.dialogs.clear();
    this.seen.clear();
    this.resultListeners.clear();
  }
}
