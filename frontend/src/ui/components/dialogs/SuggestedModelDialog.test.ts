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

describe('SuggestedModelDialog', () => {
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
      .mockResolvedValue({ ollama: ['gemma3:27b'], coderbot: ['gpt-oss:20b'] });
  });

  const makeContext = () =>
    ({ pipelineClient: { getModelOptions } } as unknown as AppContext);

  const optionsOf = (dialog: any): string[] =>
    [...(dialog.dialog.querySelector('#suggested-model-select') as HTMLSelectElement).querySelectorAll('option')]
      .map((o) => (o as HTMLOptionElement).value);

  it('constructs without throwing before the model catalog has loaded', () => {
    // BaseDialog renders the body from within super(), before the subclass
    // field initializers run. The initial render must tolerate that.
    expect(() => new SuggestedModelDialog(makeContext(), 'p1', null)).not.toThrow();
  });

  it('renders only the default option during the synchronous initial render', () => {
    const dialog: any = new SuggestedModelDialog(makeContext(), 'p1', null);
    expect(optionsOf(dialog)).toEqual(['']);
  });

  it('populates the options from the pipeline model catalog once loaded', async () => {
    const dialog: any = new SuggestedModelDialog(makeContext(), 'p1', null);
    await vi.waitFor(() => {
      expect(optionsOf(dialog)).toContain('gpt-oss:20b');
    });
  });
});
