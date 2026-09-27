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

import type { AppNotification, NotificationSeverity } from '../../core/domain.ts';
import { Icon } from './Icon.ts';

/** Id of the singleton container toasts are appended to. */
export const NOTIFICATION_TRAY_ID = 'notification-tray';

/** Auto-dismiss delay (ms) for normal notifications; 0 means persist. */
export const NORMAL_TOAST_TIMEOUT_MS = 5000;

interface SeverityStyle {
  border: string;
  text: string;
  icon: string;
}

const SEVERITY_STYLES: Record<NotificationSeverity, SeverityStyle> = {
  normal: { border: 'border-app-border', text: 'text-app-text', icon: 'documentation' },
  warning: { border: 'border-amber-500/60', text: 'text-amber-500', icon: 'alert' },
  error: { border: 'border-red-500/60', text: 'text-red-400', icon: 'alert' },
};

/**
 * Transient, non-blocking banner for `message` notifications.
 *
 * A tray container is created once (lazily) and appended to `document.body`,
 * so several toasts can coexist instead of fighting over a single slot.
 * Warning/error notifications persist until dismissed; normal ones auto-dismiss.
 */
export class NotificationToast {
  /** Returns (creating if missing) the shared toast container. */
  static ensureTray(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    let tray = document.getElementById(NOTIFICATION_TRAY_ID);
    if (!tray) {
      tray = document.createElement('div');
      tray.id = NOTIFICATION_TRAY_ID;
      tray.className =
        'fixed top-4 right-4 z-[60] flex flex-col gap-2 w-[22rem] max-w-[90vw] pointer-events-none';
      document.body.appendChild(tray);
    }
    return tray;
  }

  /**
   * Renders a toast for `notification`.
   *
   * @returns The toast element, or `null` when no DOM is available.
   */
  static show(notification: AppNotification): HTMLElement | null {
    const tray = NotificationToast.ensureTray();
    if (!tray) return null;

    const style = SEVERITY_STYLES[notification.severity] ?? SEVERITY_STYLES.normal;
    const toast = document.createElement('div');
    toast.className =
      `pointer-events-auto flex items-start gap-3 rounded-lg border ${style.border} ` +
      'bg-app-surface shadow-xl px-4 py-3 text-sm';
    toast.setAttribute('data-notification-id', notification.id);
    toast.setAttribute('role', 'status');

    const icon = document.createElement('span');
    icon.className = `${style.text} shrink-0 mt-0.5`;
    icon.innerHTML = Icon.render(style.icon, { size: 18 });
    toast.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'grow min-w-0';

    const title = document.createElement('div');
    title.className = `font-bold break-words ${style.text}`;
    title.textContent = notification.title;
    body.appendChild(title);

    if (notification.message) {
      const message = document.createElement('div');
      message.className = 'text-app-text/80 mt-1 break-words whitespace-pre-wrap';
      message.textContent = notification.message;
      body.appendChild(message);
    }
    toast.appendChild(body);

    const close = document.createElement('button');
    close.type = 'button';
    close.className =
      'shrink-0 text-app-muted hover:text-app-text transition-colors cursor-pointer p-0.5 rounded';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.setAttribute('data-notification-toast-close', 'true');
    close.innerHTML = Icon.render('close', { size: 16 });
    toast.appendChild(close);

    const remove = () => {
      toast.remove();
    };
    close.addEventListener('click', remove);

    tray.appendChild(toast);

    if (notification.severity === 'normal') {
      window.setTimeout(remove, NORMAL_TOAST_TIMEOUT_MS);
    }

    return toast;
  }

  /** Removes every toast (used on teardown and between tests). */
  static clear(): void {
    if (typeof document === 'undefined') return;
    document.getElementById(NOTIFICATION_TRAY_ID)?.remove();
  }
}
