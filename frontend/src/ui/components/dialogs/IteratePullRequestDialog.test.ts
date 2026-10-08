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
import { IteratePullRequestDialog } from './IteratePullRequestDialog.ts';

describe('IteratePullRequestDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should render the title and a comments textarea', () => {
    const dialog = new IteratePullRequestDialog();
    const dialogElement = dialog['dialog'];

    expect(dialogElement.querySelector('#dialog-body-container')).toBeTruthy();
    expect(dialogElement.querySelector('#iterate-pr-comments')).toBeTruthy();
    expect(dialogElement.querySelector('#iterate-pr-confirm')?.textContent).toContain('Send Comments to CoderBot');
  });

  it('should resolve with the trimmed comments when confirmed', async () => {
    const dialog = new IteratePullRequestDialog();
    const dialogElement = dialog['dialog'];
    dialogElement.showModal = vi.fn();
    dialogElement.close = vi.fn();

    const showPromise = dialog.show();

    const input = dialogElement.querySelector('#iterate-pr-comments') as HTMLTextAreaElement;
    input.value = '  Please fix the edge case and add tests.  ';

    const confirmBtn = dialogElement.querySelector('#iterate-pr-confirm') as HTMLButtonElement;
    confirmBtn.click();

    const result = await showPromise;
    expect(result).toBe('Please fix the edge case and add tests.');
  });

  it('should resolve with null when comments are empty', async () => {
    const dialog = new IteratePullRequestDialog();
    const dialogElement = dialog['dialog'];
    dialogElement.showModal = vi.fn();
    dialogElement.close = vi.fn();

    const showPromise = dialog.show();

    const input = dialogElement.querySelector('#iterate-pr-comments') as HTMLTextAreaElement;
    input.value = '   ';

    const confirmBtn = dialogElement.querySelector('#iterate-pr-confirm') as HTMLButtonElement;
    confirmBtn.click();

    const result = await showPromise;
    expect(result).toBeNull();
  });

  it('should resolve with null on cancel', async () => {
    const dialog = new IteratePullRequestDialog();
    const dialogElement = dialog['dialog'];
    dialogElement.showModal = vi.fn();
    dialogElement.close = vi.fn();

    const showPromise = dialog.show();

    const cancelBtn = dialogElement.querySelector('#iterate-pr-cancel') as HTMLButtonElement;
    cancelBtn.click();

    const result = await showPromise;
    expect(result).toBeNull();
  });
});
