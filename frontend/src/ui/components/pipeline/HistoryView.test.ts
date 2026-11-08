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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HistoryView } from './HistoryView.ts';
import { CommitDiff } from '../../../core/domain.ts';

class FakeRegistry {
  handlers = new Map<string, (event: Event, element: HTMLElement) => void>();
  register(name: string, handler: (event: Event, element: HTMLElement) => void): void {
    this.handlers.set(name, handler);
  }
  get(name: string) {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`No handler for ${name}`);
    return handler;
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const PATCH = [
  'diff --git a/a.txt b/a.txt',
  'index 1111111..2222222 100644',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

const COMMIT = {
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
    getGitLog: vi
      .fn()
      .mockResolvedValue({ commits: [COMMIT], total: 1 }),
    getCommitDiff: vi.fn().mockResolvedValue(
      new CommitDiff({
        commit_hash: COMMIT.hash,
        patch: PATCH,
        subject: 'Add a feature',
        message: 'Add a feature\n\nLonger body explaining it.',
        author: 'Alice',
        created_at: COMMIT.date,
      })
    ),
    pull: vi.fn().mockResolvedValue({ status: 'ok', message: 'Already up to date.' }),
    ...overrides,
  } as any;
}

const rowFor = (root: HTMLElement, hash = COMMIT.hash): HTMLElement => {
  const row = root.querySelector(
    `[data-action-click="history_toggle_commit"][data-commit-hash="${hash}"]`
  ) as HTMLElement | null;
  if (!row) throw new Error(`No row for ${hash}`);
  return row;
};

describe('HistoryView', () => {
  let root: HTMLElement;
  let registry: FakeRegistry;
  let client: any;
  let view: HistoryView;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    registry = new FakeRegistry();
    client = makeClient();
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
  });

  afterEach(() => {
    view.destroy();
  });

  const renderAndLoad = async () => {
    view.render();
    await flush();
    await flush();
  };

  it('shows a loading state before data is fetched', () => {
    view.render();
    expect(root.textContent).toContain('Loading repository history');
  });

  it('renders staged, unstaged and untracked changes', async () => {
    await renderAndLoad();
    const text = root.querySelector('#history-status-strip')!.textContent || '';

    expect(text).toContain('Repository status');
    expect(text).toContain('Staged');
    expect(text).toContain('Unstaged');
    expect(text).toContain('Untracked');
    expect(text).toContain('2');
    expect(text).toContain('1');
    expect(text).toContain('3');
  });

  it('shows an in-sync state when the branch matches origin', async () => {
    await renderAndLoad();
    expect(root.textContent).toContain('In sync with origin');
  });

  it('shows an out-of-sync state with ahead/behind counts', async () => {
    client = makeClient({
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
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    await renderAndLoad();

    const text = root.textContent || '';
    expect(text).toContain('Out of sync with origin');
    expect(text).toContain('↑1');
    expect(text).toContain('↓2');
  });

  it('shows a not-applicable state when there is no origin remote', async () => {
    client = makeClient({
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
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    await renderAndLoad();

    expect(root.textContent).toContain('No origin remote');
  });

  it('renders compact commit rows with hash, subject, author and date', async () => {
    await renderAndLoad();

    expect(root.textContent).toContain('abcdef1');
    expect(root.textContent).toContain('Add a feature');
    expect(root.textContent).toContain('Alice');
    expect(root.querySelector('[data-role="history-date"]')!.textContent).toContain(
      '2026-04-12'
    );
  });

  it('requests the page size and offset and forwards the repo status call', async () => {
    await renderAndLoad();

    expect(client.getGitStatus).toHaveBeenCalledWith('p1');
    expect(client.getGitLog).toHaveBeenCalledWith('p1', 25, 0);
  });

  it('shows an empty state when the repository has no commits', async () => {
    client = makeClient({
      getGitLog: vi.fn().mockResolvedValue({ commits: [], total: 0 }),
    });
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    await renderAndLoad();

    expect(root.textContent).toContain('No commits available.');
  });

  it('shows a clear error when the status request fails', async () => {
    client = makeClient({
      getGitStatus: vi.fn().mockRejectedValue(new Error('status boom')),
    });
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    await renderAndLoad();

    expect(root.textContent).toContain('status boom');
  });

  it('shows a clear error when the git log request fails', async () => {
    client = makeClient({
      getGitLog: vi.fn().mockRejectedValue(new Error('log boom')),
    });
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    await renderAndLoad();

    expect(root.textContent).toContain('log boom');
  });

  it('renders backend-reported errors without crashing', async () => {
    client = makeClient({
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
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    await renderAndLoad();

    expect(root.textContent).toContain('Failed to read repository status');
  });

  it('lazily loads the commit header on first expansion only', async () => {
    await renderAndLoad();

    const row = rowFor(root);
    registry.get('history_toggle_commit')(new Event('click'), row);
    await flush();
    await flush();

    expect(client.getCommitDiff).toHaveBeenCalledTimes(1);
    expect(client.getCommitDiff).toHaveBeenCalledWith('p1', COMMIT.hash);
    // Only the lightweight header is embedded; the full diff lives in the dialog.
    expect(root.querySelector('[data-role="diff-view"]')).toBeNull();
    expect(root.querySelector('[data-role="diff-header"]')).not.toBeNull();
    expect(root.querySelector('[data-role="metadata-subject"]')!.textContent).toBe(
      'Add a feature'
    );
    expect(root.querySelector('[data-role="diff-stats"]')!.textContent).toContain(
      '1 file changed'
    );

    // Collapse then re-expand: the cached header must not be re-fetched.
    registry.get('history_toggle_commit')(new Event('click'), row);
    registry.get('history_toggle_commit')(new Event('click'), row);
    await flush();

    expect(client.getCommitDiff).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-role="diff-view"]')).toBeNull();
    expect(root.querySelector('[data-role="diff-header"]')).not.toBeNull();
  });

  it('renders a button that opens the commit diff in the dialog', async () => {
    await renderAndLoad();

    const button = root.querySelector(
      '[data-action-click="open_diff_view"][data-commit-hash="' + COMMIT.hash + '"]'
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain('View Diff');
    expect(button.getAttribute('title')).toBe('Open Commit Diff');

    const openDiff = vi.fn();
    registry.register('open_diff_view', openDiff);
    await registry.get('history_open_diff')(new Event('click'), button as any);
    expect(openDiff).toHaveBeenCalled();
  });

  it('shows an error when the commit detail cannot be loaded', async () => {
    client = makeClient({
      getCommitDiff: vi.fn().mockRejectedValue(new Error('diff boom')),
    });
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    await renderAndLoad();

    registry.get('history_toggle_commit')(new Event('click'), rowFor(root));
    await flush();
    await flush();

    expect(root.textContent).toContain('diff boom');
  });

  it('renders pagination and requests the next offset', async () => {
    client = makeClient({
      getGitLog: vi.fn().mockResolvedValue({ commits: [COMMIT], total: 60 }),
    });
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    await renderAndLoad();

    const pagination = root.querySelector('#history-pagination') as HTMLElement;
    expect(pagination.textContent).toContain('Page 1 of 3');

    client.getGitLog.mockClear();
    registry.get('history_git_next_page')(new Event('click'), document.createElement('button'));
    await flush();
    await flush();

    expect(client.getGitLog).toHaveBeenCalledWith('p1', 25, 25);
    expect(root.querySelector('#history-pagination')!.textContent).toContain('Page 2 of 3');
  });

  it('hides pagination when everything fits on one page', async () => {
    await renderAndLoad();
    expect((root.querySelector('#history-pagination') as HTMLElement).innerHTML).toBe('');
  });

  it('renders a pull button in the header', () => {
    view.render();
    const button = root.querySelector('#history-pull-btn') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain('Pull');
  });

  it('pulls from origin and reloads status and log', async () => {
    await renderAndLoad();

    const button = root.querySelector('#history-pull-btn') as HTMLButtonElement;
    registry.get('history_git_pull')(new Event('click'), button);

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledWith('p1'));
    await vi.waitFor(() => expect(client.getGitStatus).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(client.getGitLog).toHaveBeenCalledTimes(2));
  });

  it('shows an error when the backend reports a pull failure', async () => {
    client = makeClient({
      pull: vi.fn().mockResolvedValue({
        status: 'ok',
        message: 'Error executing git command: no remote',
      }),
    });
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    await renderAndLoad();

    registry
      .get('history_git_pull')(
        new Event('click'),
        root.querySelector('#history-pull-btn') as HTMLButtonElement
      );

    await vi.waitFor(() => {
      expect(root.textContent).toContain('Error executing git command');
    });
  });

  it('shows an error when the pull request rejects', async () => {
    client = makeClient({
      pull: vi.fn().mockRejectedValue(new Error('pull boom')),
    });
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    await renderAndLoad();

    registry
      .get('history_git_pull')(
        new Event('click'),
        root.querySelector('#history-pull-btn') as HTMLButtonElement
      );

    await vi.waitFor(() => {
      expect(root.textContent).toContain('pull boom');
    });
  });

  it('disables the pull button while a pull is in progress', async () => {
    let resolvePull: (value: any) => void = () => {};
    client = makeClient({
      pull: vi.fn().mockImplementation(
        () => new Promise((resolve) => { resolvePull = resolve; })
      ),
    });
    view = new HistoryView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    await renderAndLoad();

    const button = root.querySelector('#history-pull-btn') as HTMLButtonElement;
    registry.get('history_git_pull')(new Event('click'), button);

    await vi.waitFor(() => expect(button.disabled).toBe(true));
    expect(button.textContent).toContain('Pulling');

    resolvePull({ status: 'ok', message: 'done' });
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  });

  it('refreshes the current page and status through history_git_load', async () => {
    await renderAndLoad();
    client.getGitStatus.mockClear();
    client.getGitLog.mockClear();

    registry
      .get('history_git_load')(
        new Event('click'),
        root.querySelector('#history-refresh-btn') as HTMLButtonElement
      );
    await flush();
    await flush();

    expect(client.getGitStatus).toHaveBeenCalledWith('p1');
    expect(client.getGitLog).toHaveBeenCalledWith('p1', 25, 0);
  });

  it('tears down mounted DiffViews on destroy', async () => {
    await renderAndLoad();

    registry.get('history_toggle_commit')(new Event('click'), rowFor(root));
    await flush();
    await flush();

    expect((view as any).diffViews.size).toBe(1);

    view.destroy();

    expect((view as any).diffViews.size).toBe(0);
    expect(root.innerHTML).toBe('');
  });
});
