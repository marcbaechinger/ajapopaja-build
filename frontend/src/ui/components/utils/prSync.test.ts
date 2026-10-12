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

import { describe, it, expect } from 'vitest';
import { formatPullRequestSyncFeedback } from './prSync.ts';
import { NotificationSeverity } from '../../../core/domain.ts';
import type { PullRequestSyncResult } from '../../../core/clients/PullRequestClient.ts';

const base: PullRequestSyncResult = { up_to_date: true, reconciled: [] };

describe('formatPullRequestSyncFeedback', () => {
  it('reports an up-to-date no-op', () => {
    const feedback = formatPullRequestSyncFeedback(base);
    expect(feedback.title).toBe('Already up to date');
    expect(feedback.severity).toBe(NotificationSeverity.NORMAL);
  });

  it('summarises reconciled pull requests', () => {
    const feedback = formatPullRequestSyncFeedback({
      status: 'ok',
      up_to_date: false,
      reconciled: [
        {
          pr_id: 'a',
          gitea_pr: 350,
          remote_state: 'merged',
          outcome: 'accepted',
        },
        {
          pr_id: 'b',
          gitea_pr: 349,
          remote_state: 'closed',
          outcome: 'rejected',
        },
      ],
    });
    expect(feedback.message).toContain('#350 merged → accepted');
    expect(feedback.message).toContain('#349 closed → rejected');
    expect(feedback.severity).toBe(NotificationSeverity.NORMAL);
  });

  it('explains a busy pipeline', () => {
    const feedback = formatPullRequestSyncFeedback({
      ...base,
      status: 'busy',
    });
    expect(feedback.title).toBe('Sync skipped');
    expect(feedback.message.toLowerCase()).toContain('session is active');
    expect(feedback.severity).toBe(NotificationSeverity.WARNING);
  });

  it('surfaces a sync failure', () => {
    const feedback = formatPullRequestSyncFeedback({
      ...base,
      status: 'sync_failed',
    });
    expect(feedback.title).toBe('Sync failed');
    expect(feedback.severity).toBe(NotificationSeverity.ERROR);
  });
});
