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

import { AppNotification, NotificationSeverity } from '../../../core/domain.ts';
import type { PullRequestSyncResult } from '../../../core/clients/PullRequestClient.ts';
import { NotificationToast } from '../common/NotificationToast.ts';

export interface PullRequestSyncFeedback {
  title: string;
  message: string;
  severity: NotificationSeverity;
}

/**
 * Turn a sync summary into human feedback. Kept separate from the toast so the
 * formatting is unit-testable without a DOM.
 */
export function formatPullRequestSyncFeedback(
  result: PullRequestSyncResult,
): PullRequestSyncFeedback {
  switch (result.status) {
    case 'busy':
      return {
        title: 'Sync skipped',
        message:
          'A coding session is active for this pipeline. Try again once it finishes.',
        severity: NotificationSeverity.WARNING,
      };
    case 'already_running':
      return {
        title: 'Sync already running',
        message: 'Another sync for this pipeline is already in progress.',
        severity: NotificationSeverity.WARNING,
      };
    case 'sync_failed':
      return {
        title: 'Sync failed',
        message: 'Could not read the latest pull-request state from Gitea.',
        severity: NotificationSeverity.ERROR,
      };
    default:
      break;
  }

  if (result.up_to_date || result.reconciled.length === 0) {
    return {
      title: 'Already up to date',
      message: 'No pull-request state changed.',
      severity: NotificationSeverity.NORMAL,
    };
  }

  const parts = result.reconciled.map((entry) => {
    const label =
      entry.gitea_pr != null ? `#${entry.gitea_pr}` : entry.pr_id || 'PR';
    return `${label} ${entry.remote_state ?? 'unknown'} → ${entry.outcome ?? 'changed'}`;
  });
  return {
    title: 'Synced from Gitea',
    message: `Synced: ${parts.join(', ')}`,
    severity: NotificationSeverity.NORMAL,
  };
}

/** Present the sync outcome as a transient toast. */
export function showPullRequestSyncToast(result: PullRequestSyncResult): void {
  const { title, message, severity } = formatPullRequestSyncFeedback(result);
  NotificationToast.show(
    new AppNotification({
      id: `pr-sync:${Date.now()}`,
      type: 'message',
      severity,
      title,
      message,
    }),
  );
}
