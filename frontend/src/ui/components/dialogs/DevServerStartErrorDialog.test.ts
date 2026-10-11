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
import { DevServerStartErrorDialog, type DevServerStartErrorDialogProps } from './DevServerStartErrorDialog.ts';

describe('DevServerStartErrorDialog', () => {
  let props: DevServerStartErrorDialogProps;

  beforeEach(() => {
    document.body.innerHTML = '';

    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });

    props = {
      pipelineId: 'p1',
      prId: 'pr1',
      prSubject: 'Implement feature',
      branch: 'feature/x',
      taskId: 't1',
      taskTitle: 'Build the thing',
      error: 'Build failed:\nnpm run build: exit 1',
    };

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders branch, task, pull request, pipeline and error details', async () => {
    const dialog = new DevServerStartErrorDialog(props);
    const showPromise = dialog.show();

    await vi.waitFor(() => {
      const html = document.body.innerHTML;
      expect(html).toContain('feature/x');
      expect(html).toContain('Build the thing');
      expect(html).toContain('t1');
      expect(html).toContain('Implement feature');
      expect(html).toContain('pr1');
      expect(html).toContain('p1');
      expect(html).toContain('Build failed:');
    });

    document.querySelector('#dev-server-error-close-btn')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('escapes HTML in the error message', async () => {
    props.error = 'Build failed:\n<script>alert("xss")</script>';
    const dialog = new DevServerStartErrorDialog(props);
    const showPromise = dialog.show();

    await vi.waitFor(() => {
      const errorEl = document.querySelector('[data-role="dev-server-error"]');
      expect(errorEl).not.toBeNull();
      expect(errorEl!.innerHTML).not.toContain('<script>');
      expect(errorEl!.innerHTML).toContain('&lt;script&gt;');
    });

    document.querySelector('#dev-server-error-close-btn')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('copies the error message to the clipboard', async () => {
    const dialog = new DevServerStartErrorDialog(props);
    const showPromise = dialog.show();

    const copyBtn = await vi.waitFor(() => {
      const btn = document.querySelector('[data-action-copy="error"]') as HTMLButtonElement;
      if (!btn) throw new Error('copy error button not found');
      return btn;
    });
    copyBtn.click();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'Build failed:\nnpm run build: exit 1',
    );
    await vi.waitFor(() => {
      expect(copyBtn.innerHTML).toContain('Copied!');
    });

    document.querySelector('#dev-server-error-close-btn')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('copies all debugging details to the clipboard', async () => {
    const dialog = new DevServerStartErrorDialog(props);
    const showPromise = dialog.show();

    const copyAllBtn = await vi.waitFor(() => {
      const btn = document.querySelector('[data-action-copy="all"]') as HTMLButtonElement;
      if (!btn) throw new Error('copy all button not found');
      return btn;
    });
    copyAllBtn.click();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Pipeline: p1'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Branch: feature/x'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Build the thing (t1)'),
    );

    document.querySelector('#dev-server-error-close-btn')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });
});
