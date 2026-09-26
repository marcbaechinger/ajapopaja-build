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
import { HistoryDialog } from './HistoryDialog.ts';

describe('HistoryDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const commit = {
    hash: 'abcdef1234567890',
    short_hash: 'abcdef1',
    author: 'Alice',
    email: 'alice@example.com',
    date: '2026-04-12T10:00:00Z',
    subject: 'Add a feature',
  };

  function makeClient(overrides: Record<string, any> = {}) {
    return {
      getGitStatus: vi.fn().mockResolvedValue({
        staged: 2,
        unstaged: 1,
        untracked: 3,
        has_origin: true,
        branch: 'main',
        in_sync: true,
        ahead: 0,
        behind: 0,
      }),
      getGitLog: vi.fn().mockResolvedValue({ commits: [commit] }),
      pull: vi.fn().mockResolvedValue({ status: 'ok', message: 'Already up to date.' }),
      ...overrides,
    } as any;
  }

  function render(overrides: Record<string, any> = {}) {
    const dialog = new HistoryDialog('p1', makeClient(overrides));
    return dialog['load']().then(() => dialog);
  }

  const bodyOf = (dialog: HistoryDialog) =>
    dialog['dialog'].querySelector('#dialog-body-container') as HTMLElement;

  it('shows a loading state before data is fetched', () => {
    const dialog = new HistoryDialog('p1', makeClient());
    expect(bodyOf(dialog).textContent).toContain('Loading repository history');
  });

  it('renders staged, unstaged and untracked changes', async () => {
    const dialog = await render();
    const text = bodyOf(dialog).textContent || '';

    expect(text).toContain('Repository status');
    expect(text).toContain('Staged');
    expect(text).toContain('Unstaged');
    expect(text).toContain('Untracked');
    expect(text).toContain('2');
    expect(text).toContain('1');
    expect(text).toContain('3');
  });

  it('shows an in-sync state when the branch matches origin', async () => {
    const dialog = await render();
    expect(bodyOf(dialog).textContent).toContain('In sync with origin');
  });

  it('shows an out-of-sync state with ahead/behind counts', async () => {
    const dialog = await render({
      getGitStatus: vi.fn().mockResolvedValue({
        staged: 0,
        unstaged: 0,
        untracked: 0,
        has_origin: true,
        branch: 'main',
        in_sync: false,
        ahead: 1,
        behind: 2,
      }),
    });
    const text = bodyOf(dialog).textContent || '';
    expect(text).toContain('Out of sync with origin');
    expect(text).toContain('↑1');
    expect(text).toContain('↓2');
  });

  it('shows a not-applicable state when there is no origin remote', async () => {
    const dialog = await render({
      getGitStatus: vi.fn().mockResolvedValue({
        staged: 0,
        unstaged: 0,
        untracked: 0,
        has_origin: false,
        in_sync: null,
        ahead: 0,
        behind: 0,
      }),
    });
    expect(bodyOf(dialog).textContent).toContain('No origin remote');
  });

  it('renders the git log with compact commit information', async () => {
    const dialog = await render();
    const text = bodyOf(dialog).textContent || '';

    expect(text).toContain('Git log');
    expect(text).toContain('abcdef1');
    expect(text).toContain('Add a feature');
    expect(text).toContain('Alice');
  });

  it('shows commits even when there are no working-tree changes', async () => {
    const dialog = await render({
      getGitStatus: vi.fn().mockResolvedValue({
        staged: 0,
        unstaged: 0,
        untracked: 0,
        has_origin: true,
        in_sync: true,
        ahead: 0,
        behind: 0,
      }),
    });
    const text = bodyOf(dialog).textContent || '';
    expect(text).toContain('Add a feature');
    expect(text).toContain('In sync with origin');
  });

  it('shows an empty state when the repository has no commits', async () => {
    const dialog = await render({
      getGitLog: vi.fn().mockResolvedValue({ commits: [] }),
    });
    expect(bodyOf(dialog).textContent).toContain('No commits available.');
  });

  it('shows a clear error when the status request fails', async () => {
    const dialog = await render({
      getGitStatus: vi.fn().mockRejectedValue(new Error('status boom')),
    });
    expect(bodyOf(dialog).textContent).toContain('status boom');
  });

  it('shows a clear error when the git log request fails', async () => {
    const dialog = await render({
      getGitLog: vi.fn().mockRejectedValue(new Error('log boom')),
    });
    expect(bodyOf(dialog).textContent).toContain('log boom');
  });

  it('renders backend-reported errors without crashing', async () => {
    const dialog = await render({
      getGitStatus: vi.fn().mockResolvedValue({
        staged: 0,
        unstaged: 0,
        untracked: 0,
        has_origin: false,
        in_sync: null,
        ahead: 0,
        behind: 0,
        error: 'Failed to read repository status',
      }),
    });
    expect(bodyOf(dialog).textContent).toContain('Failed to read repository status');
  });

  it('fetches status and log for the selected pipeline', async () => {
    const client = makeClient();
    const dialog = new HistoryDialog('pipeline-42', client);
    await dialog['load']();

    expect(client.getGitStatus).toHaveBeenCalledWith('pipeline-42');
    expect(client.getGitLog).toHaveBeenCalledWith('pipeline-42');
  });

  it('renders a pull button in the dialog header', () => {
    const dialog = new HistoryDialog('p1', makeClient());
    const header = dialog['dialog'].querySelector('#dialog-header-actions');
    const button = header?.querySelector('#history-pull-btn') as HTMLButtonElement;

    expect(button).not.toBeNull();
    expect(button.textContent).toContain('Pull');
  });

  it('pulls from origin and reloads status and log when clicked', async () => {
    const client = makeClient();
    const dialog = new HistoryDialog('p1', client);
    await dialog['load']();

    const button = dialog['dialog'].querySelector('#history-pull-btn') as HTMLButtonElement;
    button.click();

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledWith('p1'));
    await vi.waitFor(() => expect(client.getGitStatus).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(client.getGitLog).toHaveBeenCalledTimes(2));
  });

  it('shows an error when the backend reports a pull failure', async () => {
    const client = makeClient({
      pull: vi.fn().mockResolvedValue({
        status: 'ok',
        message: 'Error executing git command: no remote',
      }),
    });
    const dialog = new HistoryDialog('p1', client);
    await dialog['load']();

    (dialog['dialog'].querySelector('#history-pull-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(bodyOf(dialog).textContent).toContain('Error executing git command');
    });
  });

  it('shows an error when the pull request rejects', async () => {
    const client = makeClient({
      pull: vi.fn().mockRejectedValue(new Error('pull boom')),
    });
    const dialog = new HistoryDialog('p1', client);
    await dialog['load']();

    (dialog['dialog'].querySelector('#history-pull-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(bodyOf(dialog).textContent).toContain('pull boom');
    });
  });

  it('disables the pull button while a pull is in progress', async () => {
    let resolvePull: (value: any) => void = () => {};
    const client = makeClient({
      pull: vi.fn().mockImplementation(
        () => new Promise((resolve) => { resolvePull = resolve; })
      ),
    });
    const dialog = new HistoryDialog('p1', client);
    await dialog['load']();

    const button = dialog['dialog'].querySelector('#history-pull-btn') as HTMLButtonElement;
    button.click();

    await vi.waitFor(() => expect(button.disabled).toBe(true));
    expect(button.textContent).toContain('Pulling');

    resolvePull({ status: 'ok', message: 'done' });
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  });
});
