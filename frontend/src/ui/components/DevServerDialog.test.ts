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

vi.mock('./ProcessIoView.ts', () => ({
  ProcessIoView: vi.fn(function (this: any, container, context, pipelineId) {
    this.container = container;
    this.context = context;
    this.pipelineId = pipelineId;
    this.render = vi.fn();
    this.destroy = vi.fn();
  }),
}));

import { DevServerDialog } from './DevServerDialog.ts';
import { ProcessIoView } from './ProcessIoView.ts';

describe('DevServerDialog composition', () => {
  let mockContext: any;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mockContext = {
      devProcessService: { subscribe: vi.fn(() => () => {}) },
      pipelineClient: { stopDevServer: vi.fn() },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('embeds a ProcessIoView into the mount point and renders it', () => {
    const dialog = new DevServerDialog(mockContext, 'p1');

    expect(ProcessIoView).toHaveBeenCalledTimes(1);
    const instance = (ProcessIoView as unknown as ReturnType<typeof vi.fn>).mock
      .instances[0];
    expect(instance.context).toBe(mockContext);
    expect(instance.pipelineId).toBe('p1');
    expect(instance.container.id).toBe('dev-server-pioview-mount');
    expect(instance.render).toHaveBeenCalledTimes(1);

    expect(
      dialog['dialog'].querySelector('#dev-server-dialog-close-btn'),
    ).not.toBeNull();
  });

  it('destroys the ProcessIoView when the dialog closes', () => {
    const dialog = new DevServerDialog(mockContext, 'p1');
    const instance = (ProcessIoView as unknown as ReturnType<typeof vi.fn>).mock
      .instances[0];

    (dialog as any).close('done');
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });
});
