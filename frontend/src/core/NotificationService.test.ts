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

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import {
  NotificationService,
  NOTIFICATION,
  NOTIFICATION_ACTION,
  NOTIFICATION_ACTION_RESULT,
} from './NotificationService.ts';
import { NotificationToast } from '../ui/components/common/NotificationToast.ts';
import type { WSMessage } from './domain.ts';

type Handler = (message: WSMessage) => void;

function makeWsClient() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    send: vi.fn(),
    on: vi.fn((type: string, handler: Handler) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return () => handlers.get(type)!.delete(handler);
    }),
    emit(type: string, payload: any, id?: string) {
      handlers.get(type)?.forEach((h) => h({ type, id, payload }));
    },
    handlerCount(type: string) {
      return handlers.get(type)?.size ?? 0;
    },
  };
}

function makeAuth(token: string | null = 'tok-123') {
  return { getAccessToken: vi.fn(() => token) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
  // JSDOM does not implement the dialog methods.
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

describe('NotificationService', () => {
  let ws: ReturnType<typeof makeWsClient>;
  let auth: ReturnType<typeof makeAuth>;
  let service: NotificationService;

  beforeEach(() => {
    document.body.innerHTML = '';
    NotificationToast.clear();
    ws = makeWsClient();
    auth = makeAuth();
    service = new NotificationService(ws as any, auth as any);
  });

  afterEach(() => {
    NotificationToast.clear();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('subscribes to NOTIFICATION and NOTIFICATION_ACTION_RESULT', () => {
    expect(ws.handlerCount(NOTIFICATION)).toBe(1);
    expect(ws.handlerCount(NOTIFICATION_ACTION_RESULT)).toBe(1);
  });

  it('presents inbound message notifications as toasts', () => {
    ws.emit(NOTIFICATION, { id: 'n1', type: 'message', title: 'Hello', message: 'World' });

    const toast = document.querySelector('[data-notification-id="n1"]');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain('Hello');
    expect(toast?.textContent).toContain('World');
  });

  it('de-duplicates notifications by id', () => {
    ws.emit(NOTIFICATION, { id: 'n1', type: 'message', title: 'Hello' });
    ws.emit(NOTIFICATION, { id: 'n1', type: 'message', title: 'Hello' });

    expect(document.querySelectorAll('[data-notification-id="n1"]')).toHaveLength(1);
  });

  it('auto-dismisses normal toasts but keeps warning and error toasts', () => {
    vi.useFakeTimers();
    try {
      ws.emit(NOTIFICATION, { id: 'n-normal', type: 'message', severity: 'normal', title: 'A' });
      ws.emit(NOTIFICATION, { id: 'n-warn', type: 'message', severity: 'warning', title: 'B' });
      ws.emit(NOTIFICATION, { id: 'n-error', type: 'message', severity: 'error', title: 'C' });

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('[data-notification-id="n-normal"]')).toBeNull();
      expect(document.querySelector('[data-notification-id="n-warn"]')).not.toBeNull();
      expect(document.querySelector('[data-notification-id="n-error"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens a confirmation dialog and confirming sends the action', async () => {
    ws.emit(NOTIFICATION, {
      id: 'n-conf',
      type: 'confirmation',
      title: 'Pull?',
      message: 'Pull the remote repo',
      actions: [
        { name: 'pull_remote', label: 'Pull', data: { pipeline_id: 'p1' }, style: 'primary' },
      ],
    });

    const button = document.querySelector(
      '[data-notification-action="pull_remote"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button!.click();
    await flush();

    expect(ws.send).toHaveBeenCalledWith(NOTIFICATION_ACTION, {
      notification_id: 'n-conf',
      action: 'pull_remote',
      data: { pipeline_id: 'p1' },
      token: 'tok-123',
    });
  });

  it('renders one button per action and sends the selected one', async () => {
    ws.emit(NOTIFICATION, {
      id: 'n-actions',
      type: 'actions',
      title: 'Choose',
      message: 'Pick one',
      actions: [
        { name: 'first', label: 'First' },
        { name: 'second', label: 'Second', data: { k: 2 }, style: 'danger' },
      ],
    });

    const buttons = document.querySelectorAll('[data-notification-action]');
    expect(buttons).toHaveLength(2);

    (document.querySelector('[data-notification-action="second"]') as HTMLButtonElement).click();
    await flush();

    expect(ws.send).toHaveBeenCalledWith(NOTIFICATION_ACTION, {
      notification_id: 'n-actions',
      action: 'second',
      data: { k: 2 },
      token: 'tok-123',
    });
  });

  it('renders a SpecAgent proposal and sends the selected specagent_* action', async () => {
    ws.emit(NOTIFICATION, {
      id: 'specagent:t1',
      type: 'actions',
      title: 'Specification proposal ready',
      message: 'Task One',
      actions: [
        { name: 'specagent_accept', label: 'Accept', data: { pipeline_id: 'p1', task_id: 't1' }, style: 'primary' },
        { name: 'specagent_reject', label: 'Reject', data: { pipeline_id: 'p1', task_id: 't1' }, style: 'danger' },
        { name: 'specagent_open', label: 'Open', data: { pipeline_id: 'p1', task_id: 't1' } },
      ],
    });

    const buttons = document.querySelectorAll('[data-notification-action]');
    expect(buttons).toHaveLength(3);

    (
      document.querySelector('[data-notification-action="specagent_accept"]') as HTMLButtonElement
    ).click();
    await flush();

    expect(ws.send).toHaveBeenCalledWith(NOTIFICATION_ACTION, {
      notification_id: 'specagent:t1',
      action: 'specagent_accept',
      data: { pipeline_id: 'p1', task_id: 't1' },
      token: 'tok-123',
    });
  });

  it('de-duplicates a re-delivered SpecAgent notification by its stable id', () => {
    const notification = {
      id: 'specagent:t1',
      type: 'actions',
      title: 'Specification proposal ready',
      actions: [{ name: 'specagent_accept', label: 'Accept' }],
    };
    ws.emit(NOTIFICATION, notification);
    ws.emit(NOTIFICATION, notification);

    expect(
      document.querySelectorAll('[data-notification-action="specagent_accept"]'),
    ).toHaveLength(1);
  });

  it('sends nothing when a notification is dismissed', async () => {
    ws.emit(NOTIFICATION, {
      id: 'n-dismiss',
      type: 'confirmation',
      title: 'Pull?',
      message: 'Pull the remote repo',
      actions: [{ name: 'pull_remote', label: 'Pull' }],
    });

    const dismiss = document.querySelector(
      '[data-notification-dismiss]',
    ) as HTMLButtonElement | null;
    expect(dismiss).not.toBeNull();
    dismiss!.click();
    await flush();

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('surfaces NOTIFICATION_ACTION_RESULT to listeners and as a toast', () => {
    const seen: any[] = [];
    service.onActionResult((result) => seen.push(result));

    ws.emit(NOTIFICATION_ACTION_RESULT, {
      notification_id: 'n-conf',
      action: 'pull_remote',
      status: 'ok',
      result: { output: 'Already up to date.' },
      error: null,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].status).toBe('ok');

    const toast = document.querySelector('[data-notification-id^="result:n-conf"]');
    expect(toast?.textContent).toContain('Action completed');
    expect(toast?.textContent).toContain('Already up to date.');
  });

  it('shows an error toast when an action fails', () => {
    ws.emit(NOTIFICATION_ACTION_RESULT, {
      notification_id: 'n-conf',
      action: 'pull_remote',
      status: 'error',
      result: null,
      error: 'boom',
    });

    const toast = document.querySelector('[data-notification-id^="result:n-conf"]');
    expect(toast?.textContent).toContain('Action failed');
    expect(toast?.textContent).toContain('boom');
  });

  it('treats a result with ok=false as a failure', () => {
    ws.emit(NOTIFICATION_ACTION_RESULT, {
      notification_id: 'n-pull',
      action: 'pull_remote',
      status: 'ok',
      result: { ok: false, error: 'not a git repo' },
    });

    const toast = document.querySelector('[data-notification-id^="result:n-pull"]');
    expect(toast?.textContent).toContain('Action failed');
    expect(toast?.textContent).toContain('not a git repo');
  });

  it('dispose removes its WebSocket handlers', () => {
    service.dispose();

    expect(ws.handlerCount(NOTIFICATION)).toBe(0);
    expect(ws.handlerCount(NOTIFICATION_ACTION_RESULT)).toBe(0);

    ws.emit(NOTIFICATION, { id: 'n-after', type: 'message', title: 'Late' });
    expect(document.querySelector('[data-notification-id="n-after"]')).toBeNull();
  });
});
