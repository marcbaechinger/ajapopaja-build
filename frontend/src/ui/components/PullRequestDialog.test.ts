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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PullRequestDialog } from './PullRequestDialog.ts';
import { PullRequest, PullRequestStatus } from '../../core/domain.ts';

describe('PullRequestDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const makeContext = (pr: any) => ({
    pullRequestClient: {
      getPullRequestByTask: vi.fn().mockResolvedValue(new PullRequest(pr)),
      getPullRequest: vi.fn().mockResolvedValue(new PullRequest(pr))
    }
  }) as any;

  it('renders Open in Gitea link when PR is submitted', async () => {
    const pr = {
      _id: 'pr1',
      pipeline_id: 'p1',
      task_id: 't1',
      summary: 'summary',
      branch_name: 'feature/x',
      patch: 'patch',
      status: PullRequestStatus.SUBMITTED,
      remote_pr_url: 'https://host/owner/repo/pulls/42'
    };
    const dialog = new PullRequestDialog({
      taskId: 't1',
      pipelineId: 'p1',
      context: makeContext(pr)
    });

    await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());

    const footer = dialog['dialog'].querySelector('#dialog-footer-container') as HTMLElement;
    expect(footer.innerHTML).toContain('Open in Gitea');
    const link = footer.querySelector('#pr-open-gitea-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://host/owner/repo/pulls/42');
    // No merge button for submitted PRs
    expect(footer.querySelector('#pr-accept-btn')).toBeNull();
  });

  it('renders Open in Gitea link when remote_pr_url is set', async () => {
    const pr = {
      _id: 'pr2',
      pipeline_id: 'p1',
      task_id: 't1',
      summary: 'summary',
      branch_name: 'feature/x',
      patch: 'patch',
      status: PullRequestStatus.OPEN,
      remote_pr_url: 'https://host/owner/repo/pulls/42'
    };
    const dialog = new PullRequestDialog({
      taskId: 't1',
      pipelineId: 'p1',
      context: makeContext(pr)
    });

    await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());

    const footer = dialog['dialog'].querySelector('#dialog-footer-container') as HTMLElement;
    expect(footer.innerHTML).toContain('Open in Gitea');
    expect(footer.querySelector('#pr-accept-btn')).toBeNull();
  });

  it('shows Accept & Apply for a plain open PR', async () => {
    const pr = {
      _id: 'pr3',
      pipeline_id: 'p1',
      task_id: 't1',
      summary: 'summary',
      branch_name: 'feature/x',
      patch: 'patch',
      status: PullRequestStatus.OPEN
    };
    const dialog = new PullRequestDialog({
      taskId: 't1',
      pipelineId: 'p1',
      context: makeContext(pr)
    });

    await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());

    const footer = dialog['dialog'].querySelector('#dialog-footer-container') as HTMLElement;
    const acceptBtn = footer.querySelector('#pr-accept-btn') as HTMLButtonElement;
    expect(acceptBtn).not.toBeNull();
    expect(acceptBtn.textContent).toContain('Accept');
    expect(footer.querySelector('#pr-open-gitea-link')).toBeNull();
  });

  it('shows Accept & Apply for a new OPEN PR even when the backend returns remote_pr_url null', async () => {
    // A brand-new pull request in gitea_pr pipelines has status OPEN and a
    // null remote_pr_url (set only after the PR is submitted to Gitea). The
    // dialog must let the user accept it first rather than showing it as
    // already submitted. Regression for the null -> "null" string bug.
    const pr = {
      _id: 'pr4',
      pipeline_id: 'p1',
      task_id: 't1',
      summary: 'summary',
      branch_name: 'feature/x',
      patch: 'patch',
      status: PullRequestStatus.OPEN,
      remote_pr_url: null
    };
    const dialog = new PullRequestDialog({
      taskId: 't1',
      pipelineId: 'p1',
      context: makeContext(pr)
    });

    await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());

    expect(dialog['pr']!.remote_pr_url).toBeUndefined();
    const footer = dialog['dialog'].querySelector('#dialog-footer-container') as HTMLElement;
    const acceptBtn = footer.querySelector('#pr-accept-btn') as HTMLButtonElement;
    expect(acceptBtn).not.toBeNull();
    expect(acceptBtn.textContent).toContain('Accept');
    expect(footer.querySelector('#pr-open-gitea-link')).toBeNull();
    expect(footer.innerHTML).not.toContain('Open in Gitea');
  });
});
