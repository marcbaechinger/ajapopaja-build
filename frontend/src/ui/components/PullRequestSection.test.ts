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
import { PullRequestSection } from './PullRequestSection.ts';
import { PullRequest, PullRequestStatus } from '../../core/domain.ts';

describe('PullRequestSection', () => {
  const makePr = (overrides: any = {}): PullRequest => new PullRequest({
    _id: 'pr1',
    pipeline_id: 'p1',
    task_id: 't1',
    summary: 'summary',
    branch_name: 'feature/x',
    patch: 'diff',
    status: PullRequestStatus.OPEN,
    created_at: '2026-04-12T10:00:00Z',
    ...overrides
  });

  it('includes SUBMITTED items as awaiting review', () => {
    const prs = [
      makePr({ _id: 'a', status: PullRequestStatus.SUBMITTED, remote_pr_url: 'https://host/o/r/pulls/1' }),
      makePr({ _id: 'b', status: PullRequestStatus.OPEN }),
      makePr({ _id: 'c', status: PullRequestStatus.ACCEPTED }),
      makePr({ _id: 'd', status: PullRequestStatus.REJECTED })
    ];
    const html = PullRequestSection.render(prs);
    expect(html).toContain('summary');
    expect(html).toContain('Review');
    // Accepted and rejected are not shown.
    expect(html).not.toContain('REJECTED');
  });

  it('shows a Submitted badge for submitted PRs', () => {
    const prs = [
      makePr({ _id: 'a', status: PullRequestStatus.SUBMITTED })
    ];
    const html = PullRequestSection.render(prs);
    expect(html).toContain('Submitted');
  });

  it('returns empty when there are no awaiting-review PRs', () => {
    const prs = [
      makePr({ _id: 'c', status: PullRequestStatus.ACCEPTED })
    ];
    expect(PullRequestSection.render(prs)).toBe('');
  });
});
