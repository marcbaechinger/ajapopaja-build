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
import { copyToClipboard } from './clipboard.ts';

describe('copyToClipboard', () => {
  const originalExecCommand = document.execCommand;
  let execCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      value: execCommand,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.execCommand = originalExecCommand;
    document.body.innerHTML = '';
  });

  it('uses the async Clipboard API when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await copyToClipboard('hello');

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when the Clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    let copied = '';
    execCommand.mockImplementation(() => {
      copied = document.querySelector('textarea')?.value ?? '';
      return true;
    });

    await copyToClipboard('insecure origin');

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(copied).toBe('insecure origin');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back to execCommand when the Clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await copyToClipboard('fallback');

    expect(writeText).toHaveBeenCalledWith('fallback');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('removes the temporary textarea when execCommand fails', async () => {
    vi.stubGlobal('navigator', {});
    execCommand.mockImplementation(() => {
      throw new Error('copy unsupported');
    });

    await expect(copyToClipboard('text')).rejects.toThrow('copy unsupported');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
