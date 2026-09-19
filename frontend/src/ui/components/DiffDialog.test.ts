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
import { DiffDialog } from './DiffDialog.ts';
import { CommitDiff } from '../../core/domain.ts';

const PATCH = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
 context
-removed
+added
`;

describe('DiffDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const makeContext = (diff: any) => ({
    pipelineClient: {
      getCommitDiff: vi.fn().mockResolvedValue(new CommitDiff(diff)),
    },
  }) as any;

  it('shows a loading state before the diff resolves', () => {
    const context = {
      pipelineClient: {
        getCommitDiff: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    } as any;

    const dialog = new DiffDialog({ context, pipelineId: 'p1', commitHash: 'abc' });

    const body = dialog['dialog'].querySelector('#dialog-body-container') as HTMLElement;
    expect(body.textContent).toContain('Loading Commit Diff');
  });

  it('mounts a DiffView with metadata and per-file stats', async () => {
    const context = makeContext({
      commit_hash: 'abc123',
      patch: PATCH,
      subject: 'My commit',
      author: 'Alice',
      created_at: '2026-01-01T00:00:00Z',
    });

    const dialog = new DiffDialog({ context, pipelineId: 'p1', commitHash: 'abc123' });

    await vi.waitFor(() => expect(dialog['diff']).not.toBeNull());

    const container = dialog['dialog'].querySelector('#diff-dialog-container') as HTMLElement;
    expect(container).not.toBeNull();
    expect(container.querySelector('[data-role="diff-view"]')).not.toBeNull();
    expect(container.querySelector('[data-role="file-path"]')?.textContent).toBe('src/foo.ts');
    expect(container.textContent).toContain('added');
    expect(container.textContent).toContain('removed');

    // Metadata header shows the commit subject and author.
    expect(container.querySelector('[data-role="metadata-subject"]')?.textContent).toBe('My commit');
    expect(container.textContent).toContain('Alice');

    expect(context.pipelineClient.getCommitDiff).toHaveBeenCalledWith('p1', 'abc123');
  });

  it('falls back to the provided title when the commit has no subject', async () => {
    const context = makeContext({ commit_hash: 'abc', patch: PATCH, subject: null });
    const dialog = new DiffDialog({
      context,
      pipelineId: 'p1',
      commitHash: 'abc',
      title: 'Task Title',
    });

    await vi.waitFor(() => expect(dialog['diff']).not.toBeNull());

    const container = dialog['dialog'].querySelector('#diff-dialog-container') as HTMLElement;
    expect(container.querySelector('[data-role="metadata-subject"]')?.textContent).toBe('Task Title');
  });

  it('renders an error message when loading the diff fails', async () => {
    const context = {
      pipelineClient: {
        getCommitDiff: vi.fn().mockRejectedValue(new Error('Commit not found')),
      },
    } as any;

    const dialog = new DiffDialog({ context, pipelineId: 'p1', commitHash: 'nope' });

    await vi.waitFor(() => expect(dialog['error']).not.toBeNull());

    const body = dialog['dialog'].querySelector('#dialog-body-container') as HTMLElement;
    const error = body.querySelector('[data-role="diff-error"]');
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain('Commit not found');
    expect(body.querySelector('#diff-dialog-container')).toBeNull();
  });

  it('renders the "No changes" placeholder for an empty patch', async () => {
    const context = makeContext({ commit_hash: 'abc', patch: '' });
    const dialog = new DiffDialog({ context, pipelineId: 'p1', commitHash: 'abc' });

    await vi.waitFor(() => expect(dialog['diff']).not.toBeNull());

    const container = dialog['dialog'].querySelector('#diff-dialog-container') as HTMLElement;
    expect(container.querySelector('[data-role="diff-empty"]')?.textContent).toContain('No changes');
  });

  it('renders a Close button wired to close()', async () => {
    const context = makeContext({ commit_hash: 'abc', patch: PATCH });
    const dialog = new DiffDialog({ context, pipelineId: 'p1', commitHash: 'abc' });

    await vi.waitFor(() => expect(dialog['diff']).not.toBeNull());

    const closeBtn = dialog['dialog'].querySelector('#diff-close-btn') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    const closeSpy = vi.spyOn(dialog as any, 'close').mockImplementation(() => {});
    closeBtn.click();
    expect(closeSpy).toHaveBeenCalled();
  });
});
