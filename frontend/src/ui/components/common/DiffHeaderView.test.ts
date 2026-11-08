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

import { describe, it, expect, beforeEach } from 'vitest';
import { DiffHeaderView } from './DiffHeaderView.ts';

describe('DiffHeaderView', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  it('renders metadata and aggregate file stats', () => {
    const view = new DiffHeaderView(mount, {
      metadata: {
        label: 'Commit',
        subject: 'Add a feature',
        author: 'Alice',
        createdAt: '2026-04-12T10:00:00Z',
      },
      files: [
        { added: 2, removed: 1 },
        { added: 1, removed: 0 },
      ],
    });
    view.render();

    expect(mount.querySelector('[data-role="diff-header"]')).not.toBeNull();
    expect(mount.querySelector('[data-role="metadata-subject"]')?.textContent).toBe(
      'Add a feature'
    );
    expect(mount.querySelector('[data-role="diff-stats"]')?.textContent).toBe(
      '2 files changed, +3, -1'
    );
    expect(mount.textContent).toContain('Alice');
  });

  it('supports collapsing and expanding the metadata body', () => {
    const view = new DiffHeaderView(mount, {
      metadata: { subject: 'My subject' },
      files: [{ added: 1, removed: 0 }],
    });
    view.render();

    const details = mount.querySelector('[data-role="metadata-header"]') as HTMLDetailsElement;
    const body = mount.querySelector('[data-role="metadata-body"]') as HTMLElement;
    const toggle = mount.querySelector('[data-role="metadata-toggle"]') as HTMLElement;
    expect(details.open).toBe(true);

    toggle.click();
    expect(details.open).toBe(false);
    expect(body.classList.contains('hidden')).toBe(true);

    toggle.click();
    expect(details.open).toBe(true);
    expect(body.classList.contains('hidden')).toBe(false);
  });

  it('renders an optional action button in the summary', () => {
    const view = new DiffHeaderView(mount, {
      metadata: { subject: 'My subject' },
      files: [{ added: 1, removed: 0 }],
      action: {
        label: 'View Diff',
        action: 'open_diff_view',
        attributes: { 'commit-hash': 'abc123' },
      },
    });
    view.render();

    const button = mount.querySelector(
      '[data-action-click="open_diff_view"][data-commit-hash="abc123"]'
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain('View Diff');
  });

  it('removes its DOM and listeners on destroy', () => {
    const view = new DiffHeaderView(mount, { metadata: { subject: 'My subject' } });
    view.render();
    expect(mount.querySelector('[data-role="diff-header"]')).not.toBeNull();

    view.destroy();
    expect(mount.querySelector('[data-role="diff-header"]')).toBeNull();
  });
});
