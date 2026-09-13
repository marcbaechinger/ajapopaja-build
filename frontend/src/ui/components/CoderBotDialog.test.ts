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

vi.mock('./PiView.ts', () => ({
  PiView: vi.fn(function (this: any, service, mount, options) {
    this.service = service;
    this.mount = mount;
    this.options = options;
    this.render = vi.fn();
    this.destroy = vi.fn();
  }),
}));

import { CoderBotDialog } from './CoderBotDialog.ts';
import { PiView } from './PiView.ts';

describe('CoderBotDialog composition', () => {
  let mockService: any;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mockService = {
      getHistory: vi.fn(() => []),
      getCurrentTaskId: vi.fn(() => null),
      isActive: vi.fn(() => false),
      clearHistory: vi.fn(),
      stopSession: vi.fn(async () => {}),
      onBlocks: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      onSessionStateChange: vi.fn(() => () => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('instantiates PiView with the service and calls render()', () => {
    const dialog = new CoderBotDialog(mockService);

    expect(PiView).toHaveBeenCalledTimes(1);
    const piView = (PiView as unknown as ReturnType<typeof vi.fn>).mock.instances[0];
    expect(piView.service).toBe(mockService);
    expect(piView.mount).not.toBeNull();
    expect(piView.mount.id).toBe('coderbot-piview-mount');
    expect(piView.render).toHaveBeenCalledTimes(1);

    // Dialog footer still supplies the Close button.
    expect(dialog['dialog'].querySelector('#dialog-footer-close-btn')).not.toBeNull();
  });

  it('closing the dialog invokes PiView.destroy()', () => {
    const dialog = new CoderBotDialog(mockService);
    const piView = (PiView as unknown as ReturnType<typeof vi.fn>).mock.instances[0];

    (dialog as any).close('result');
    expect(piView.destroy).toHaveBeenCalledTimes(1);
  });
});
