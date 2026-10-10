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
import { SuggestedModelDialog } from './SuggestedModelDialog.ts';
import type { AppContext } from '../../../core/AppContext.ts';

describe('SuggestedModelDialog unsetting', () => {
  let getModelOptions: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';

    // JSDOM does not implement the dialog modal methods.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });

    getModelOptions = vi
      .fn()
      .mockResolvedValue({ ollama: [], coderbot: ['gpt-oss:20b', 'qwen3-coder'] });
  });

  const makeContext = () =>
    ({ pipelineClient: { getModelOptions } } as unknown as AppContext);

  const selectOf = (dialog: any): HTMLSelectElement =>
    dialog.dialog.querySelector('#suggested-model-select') as HTMLSelectElement;

  it('constructs before the model catalog has loaded without throwing', () => {
    expect(
      () => new SuggestedModelDialog(makeContext(), 'p1', 'gpt-oss:20b')
    ).not.toThrow();
  });

  it('exposes an unset option and preselects the pinned model', () => {
    const dialog: any = new SuggestedModelDialog(makeContext(), 'p1', 'gpt-oss:20b');
    const values = [...selectOf(dialog).querySelectorAll('option')].map(
      (o) => (o as HTMLOptionElement).value
    );
    expect(values[0]).toBe('');
    expect(values).toContain('gpt-oss:20b');
    expect(selectOf(dialog).value).toBe('gpt-oss:20b');
  });

  it('resolves with an empty string when the unset option is saved', async () => {
    const dialog: any = new SuggestedModelDialog(makeContext(), 'p1', 'gpt-oss:20b');
    const promise = dialog.show();

    selectOf(dialog).value = '';
    (dialog.dialog.querySelector('#suggested-model-save') as HTMLButtonElement).click();

    await expect(promise).resolves.toBe('');
  });

  it('resolves with null when the dialog is cancelled', async () => {
    const dialog: any = new SuggestedModelDialog(makeContext(), 'p1', 'gpt-oss:20b');
    const promise = dialog.show();

    (dialog.dialog.querySelector('#suggested-model-cancel') as HTMLButtonElement).click();

    await expect(promise).resolves.toBeNull();
  });
});
