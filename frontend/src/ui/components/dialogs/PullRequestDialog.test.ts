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
import { PullRequest, PullRequestStatus } from '../../../core/domain.ts';

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

  it('mounts a DiffView into #pr-diff-container instead of raw patch text', async () => {
    const patch = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
 context
-removed
+added
`;
    const pr = {
      _id: 'pr-diff',
      pipeline_id: 'p1',
      task_id: 't1',
      summary: 'summary',
      subject: 'My subject',
      author: 'Alice',
      branch_name: 'feature/x',
      patch,
      status: PullRequestStatus.OPEN
    };
    const dialog = new PullRequestDialog({
      taskId: 't1',
      pipelineId: 'p1',
      context: makeContext(pr)
    });

    await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());

    const container = dialog['dialog'].querySelector('#pr-diff-container') as HTMLElement;
    expect(container).not.toBeNull();
    expect(container.querySelector('[data-role="diff-view"]')).not.toBeNull();
    expect(container.querySelector('[data-role="file-path"]')?.textContent).toBe('src/foo.ts');
    expect(container.textContent).toContain('added');
    expect(container.textContent).toContain('removed');

    const body = dialog['dialog'].querySelector('#dialog-body-container') as HTMLElement;
    expect(body.querySelector('pre > code')?.textContent ?? '').not.toContain(patch);
  });

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

  it('labels the accept button Merge for a plain open PR', async () => {
    const pr = {
      _id: 'pr3',
      pipeline_id: 'p1',
      task_id: 't1',
      summary: 'summary',
      branch_name: 'feature/x',
      patch: 'patch',
      status: PullRequestStatus.OPEN,
      apply_mode: 'merge'
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
    expect(acceptBtn.textContent).toContain('Merge');
    expect(footer.querySelector('#pr-open-gitea-link')).toBeNull();
  });

  it('labels the accept button according to how the PR will be applied', async () => {
    const cases: any[] = [
      { apply_mode: 'push', label: 'Push' },
      { apply_mode: 'submit', label: 'Submit' },
    ];
    for (const c of cases) {
      const pr = {
        _id: `lab-${c.label}`,
        pipeline_id: 'p1',
        task_id: 't1',
        summary: 'summary',
        branch_name: 'feature/x',
        patch: 'patch',
        status: PullRequestStatus.OPEN,
        apply_mode: c.apply_mode
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
      expect(acceptBtn.textContent).toContain(c.label);
      expect(footer.querySelector('#pr-open-gitea-link')).toBeNull();
    }
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
      apply_mode: 'submit',
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
    expect(acceptBtn.textContent).toContain('Submit');
    expect(footer.querySelector('#pr-open-gitea-link')).toBeNull();
    expect(footer.innerHTML).not.toContain('Open in Gitea');
  });

  it('sends the edited PR summary as the commit message on accept', async () => {
    const pr = {
      _id: 'pr5',
      pipeline_id: 'p1',
      task_id: 't1',
      summary: 'Original summary',
      branch_name: 'feature/x',
      patch: 'patch',
      status: PullRequestStatus.OPEN
    };
    const acceptPullRequest = vi.fn().mockResolvedValue(undefined);
    const context = {
      pullRequestClient: {
        getPullRequestByTask: vi.fn().mockResolvedValue(new PullRequest(pr)),
        getPullRequest: vi.fn().mockResolvedValue(new PullRequest(pr)),
        acceptPullRequest
      },
      onAccept: vi.fn()
    } as any;

    const dialog = new PullRequestDialog({
      taskId: 't1',
      pipelineId: 'p1',
      context,
      onAccept: context.onAccept
    });

    await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());

    // User edits the PR summary in the commit message textarea.
    const summaryInput = dialog['dialog'].querySelector('#pr-summary-input') as HTMLTextAreaElement;
    summaryInput.value = 'Add new feature';

    const footer = dialog['dialog'].querySelector('#dialog-footer-container') as HTMLElement;
    const acceptBtn = footer.querySelector('#pr-accept-btn') as HTMLButtonElement;
    acceptBtn.click();

    await vi.waitFor(() => expect(acceptPullRequest).toHaveBeenCalled());
    expect(acceptPullRequest).toHaveBeenCalledWith('pr5', 'Add new feature', 'revert', false);
  });

  const conflictPr = {
    _id: 'pr-conflict',
    pipeline_id: 'p1',
    task_id: 't1',
    summary: 'summary',
    subject: 'subject',
    branch_name: 'feature/x',
    patch: 'patch',
    status: PullRequestStatus.OPEN,
  };

  const makeConflictContext = (acceptPullRequest: any, syncPullRequests: any) => ({
    pullRequestClient: {
      getPullRequestByTask: vi.fn().mockResolvedValue(new PullRequest(conflictPr)),
      getPullRequest: vi.fn().mockResolvedValue(new PullRequest(conflictPr)),
      acceptPullRequest,
      syncPullRequests,
    },
  }) as any;

  it('offers Sync from Gitea & retry and Accept anyway on a 409 ordering conflict', async () => {
    const conflict = Object.assign(
      new Error('An older pull request for this pipeline is still open (PR old).'),
      { status: 409 },
    );
    const acceptPullRequest = vi.fn().mockRejectedValueOnce(conflict);
    const syncPullRequests = vi.fn().mockResolvedValue({ up_to_date: true, reconciled: [] });
    const context = makeConflictContext(acceptPullRequest, syncPullRequests);

    const dialog = new PullRequestDialog({
      taskId: 't1',
      pipelineId: 'p1',
      context,
    });

    await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());
    (dialog['dialog'].querySelector('#pr-accept-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(dialog['dialog'].querySelector('#pr-sync-retry-btn')).not.toBeNull();
    });
    expect(dialog['dialog'].textContent).toContain('Sync from Gitea & retry');
    expect(dialog['dialog'].textContent).toContain('Accept anyway');
  });

  it('Sync from Gitea & retry syncs then re-attempts the accept', async () => {
    const conflict = Object.assign(
      new Error('An older pull request for this pipeline is still open (PR old).'),
      { status: 409 },
    );
    const acceptPullRequest = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(undefined);
    const syncPullRequests = vi.fn().mockResolvedValue({
      status: 'ok',
      up_to_date: false,
      reconciled: [
        { pr_id: 'old', gitea_pr: 349, remote_state: 'closed', outcome: 'rejected' },
      ],
    });
    const context = makeConflictContext(acceptPullRequest, syncPullRequests);

    const dialog = new PullRequestDialog({
      taskId: 't1',
      pipelineId: 'p1',
      context,
    });

    await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());
    (dialog['dialog'].querySelector('#pr-accept-btn') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(dialog['dialog'].querySelector('#pr-sync-retry-btn')).not.toBeNull(),
    );

    (dialog['dialog'].querySelector('#pr-sync-retry-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(syncPullRequests).toHaveBeenCalledWith('p1'));
    await vi.waitFor(() => expect(acceptPullRequest).toHaveBeenCalledTimes(2));
    // The retry is a normal accept (no force).
    expect(acceptPullRequest).toHaveBeenLastCalledWith('pr-conflict', expect.anything(), 'revert', false);
  });

  it('Accept anyway resends the accept with force=true', async () => {
    const conflict = Object.assign(
      new Error('An older pull request for this pipeline is still open (PR old).'),
      { status: 409 },
    );
    const acceptPullRequest = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(undefined);
    const syncPullRequests = vi.fn();
    const context = makeConflictContext(acceptPullRequest, syncPullRequests);

    const dialog = new PullRequestDialog({
      taskId: 't1',
      pipelineId: 'p1',
      context,
    });

    await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());
    (dialog['dialog'].querySelector('#pr-accept-btn') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(dialog['dialog'].querySelector('#pr-accept-anyway-btn')).not.toBeNull(),
    );

    (dialog['dialog'].querySelector('#pr-accept-anyway-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(acceptPullRequest).toHaveBeenCalledTimes(2));
    expect(acceptPullRequest).toHaveBeenLastCalledWith('pr-conflict', expect.anything(), 'revert', true);
    expect(syncPullRequests).not.toHaveBeenCalled();
  });

  describe('completed pull requests with a cleaned-up patch', () => {
    const terminalPr = (status: string, extra: any = {}) => ({
      _id: `pr-${status}`,
      pipeline_id: 'p1',
      task_id: 't1',
      summary: 'summary',
      subject: 'Completed subject',
      branch_name: 'feature/completed',
      patch: null,
      status,
      ...extra,
    });

    it.each([PullRequestStatus.ACCEPTED, PullRequestStatus.REJECTED])(
      'renders the diff-unavailable explanation and no DiffView for %s',
      async (status) => {
        const dialog = new PullRequestDialog({
          taskId: 't1',
          pipelineId: 'p1',
          context: makeContext(terminalPr(status)),
        });

        await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());

        const body = dialog['dialog'].querySelector('#dialog-body-container') as HTMLElement;
        expect(body.querySelector('#pr-diff-unavailable')).not.toBeNull();
        expect(body.querySelector('#pr-diff-container')).toBeNull();
        expect(body.querySelector('[data-role="diff-view"]')).toBeNull();
        expect(body.textContent).toContain('The diff is no longer stored');
        expect(body.textContent).toContain(status);
        expect(body.textContent).toContain('feature/completed');
        expect(body.textContent).not.toContain('null');
      },
    );

    it('renders no accept/reject buttons for a terminal PR', async () => {
      const dialog = new PullRequestDialog({
        taskId: 't1',
        pipelineId: 'p1',
        context: makeContext(terminalPr(PullRequestStatus.ACCEPTED)),
      });

      await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());

      const footer = dialog['dialog'].querySelector('#dialog-footer-container') as HTMLElement;
      expect(footer.querySelector('#pr-accept-btn')).toBeNull();
      expect(footer.querySelector('#pr-reject-btn')).toBeNull();
      expect(footer.querySelector('#pr-accept-anyway-btn')).toBeNull();
      expect(footer.querySelector('#pr-close-btn')).not.toBeNull();
    });

    it('shows the Gitea link for a terminal PR when remote_pr_url is set', async () => {
      const dialog = new PullRequestDialog({
        taskId: 't1',
        pipelineId: 'p1',
        context: makeContext(terminalPr(PullRequestStatus.REJECTED, {
          remote_pr_url: 'https://host/owner/repo/pulls/7',
        })),
      });

      await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());

      const body = dialog['dialog'].querySelector('#dialog-body-container') as HTMLElement;
      expect(body.textContent).toContain('The diff is no longer stored');
      expect(body.innerHTML).toContain('https://host/owner/repo/pulls/7');

      const footer = dialog['dialog'].querySelector('#dialog-footer-container') as HTMLElement;
      expect(footer.querySelector('#pr-accept-btn')).toBeNull();
      expect(footer.querySelector('#pr-reject-btn')).toBeNull();
      const link = footer.querySelector('#pr-open-gitea-link') as HTMLAnchorElement;
      expect(link).not.toBeNull();
      expect(link.getAttribute('href')).toBe('https://host/owner/repo/pulls/7');
    });
  });

  it('still renders the diff and accept/reject buttons for an OPEN PR with a patch', async () => {
    const patch = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,1 @@
-old
+new
`;
    const dialog = new PullRequestDialog({
      taskId: 't1',
      pipelineId: 'p1',
      context: makeContext({
        _id: 'pr-open-patch',
        pipeline_id: 'p1',
        task_id: 't1',
        summary: 'summary',
        branch_name: 'feature/open',
        patch,
        status: PullRequestStatus.OPEN,
      }),
    });

    await vi.waitFor(() => expect(dialog['pr']).not.toBeNull());

    const body = dialog['dialog'].querySelector('#dialog-body-container') as HTMLElement;
    expect(body.querySelector('#pr-diff-unavailable')).toBeNull();
    expect(body.querySelector('[data-role="diff-view"]')).not.toBeNull();
    expect(body.textContent).toContain('new');

    const footer = dialog['dialog'].querySelector('#dialog-footer-container') as HTMLElement;
    expect(footer.querySelector('#pr-accept-btn')).not.toBeNull();
    expect(footer.querySelector('#pr-reject-btn')).not.toBeNull();
  });
});
