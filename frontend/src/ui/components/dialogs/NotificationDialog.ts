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

import { NotificationType } from '../../../core/domain.ts';
import type { AppNotification, NotificationAction } from '../../../core/domain.ts';
import { BaseDialog } from './dialog_common.ts';

/**
 * Dialog that presents a `confirmation` or `actions` notification.
 *
 * `show()` resolves with the chosen {@link NotificationAction}, or `null` when
 * the user dismisses the dialog (backdrop, Escape, close or Dismiss button).
 * Dismissing is purely local — the caller sends nothing to the backend.
 */
export class NotificationDialog extends BaseDialog<NotificationAction | null> {
  private notification: AppNotification;

  constructor(notification: AppNotification) {
    super({
      title: notification.title || 'Notification',
      canOpenAsChildDialog: true,
      maxWidth: 'max-w-lg',
    });
    this.notification = notification;
    // Re-render now that `notification` is available (super() calls render
    // before instance fields are assigned).
    this.updateContent();
  }

  private updateContent(): void {
    const bodyContainer = this.dialog.querySelector(
      '#dialog-body-container',
    ) as HTMLElement | null;
    if (bodyContainer) bodyContainer.replaceChildren(this.renderBody());

    const footerContainer = this.dialog.querySelector(
      '#dialog-footer-container',
    ) as HTMLElement | null;
    if (footerContainer) footerContainer.replaceChildren(this.renderFooter());
  }

  protected renderBody(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'p-6';
    if (this.notification?.message) {
      const message = document.createElement('p');
      message.className = 'text-app-text/80 whitespace-pre-wrap break-words';
      message.textContent = this.notification.message;
      wrapper.appendChild(message);
    }
    return wrapper;
  }

  protected renderFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'p-6 pt-0 flex flex-wrap justify-end gap-3';
    if (!this.notification) return footer;

    if (this.notification.dismissible) {
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.id = 'notification-dismiss';
      dismiss.setAttribute('data-notification-dismiss', 'true');
      dismiss.className =
        'px-4 py-2 text-app-muted hover:text-app-text transition-colors cursor-pointer font-medium';
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', () => this.close(null));
      footer.appendChild(dismiss);
    }

    this.notification.actions.forEach((action, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `notification-action-${index}`;
      button.setAttribute('data-notification-action', action.name);
      button.setAttribute('data-notification-action-index', String(index));
      button.className = this.buttonClass(this.effectiveStyle(action));
      button.textContent = action.label || action.name;
      button.addEventListener('click', () => this.close(action));
      footer.appendChild(button);
    });

    return footer;
  }

  private effectiveStyle(action: NotificationAction): string {
    if (action.style && action.style !== 'default') return action.style;
    // A confirmation has exactly one action, presented as the primary button.
    if (this.notification.type === NotificationType.CONFIRMATION) return 'primary';
    return 'default';
  }

  private buttonClass(style: string): string {
    const base = 'px-4 py-2 rounded-lg transition-all font-bold cursor-pointer';
    if (style === 'primary') {
      return `${base} bg-app-accent-1 hover:brightness-110 text-app-accent-fg shadow-lg`;
    }
    if (style === 'danger') {
      return `${base} bg-red-600 hover:bg-red-500 text-white shadow-lg`;
    }
    return `${base} bg-app-bg border border-app-border text-app-text hover:bg-app-surface`;
  }

  public async show(): Promise<NotificationAction | null> {
    const result = await super.show();
    return result ?? null;
  }
}
