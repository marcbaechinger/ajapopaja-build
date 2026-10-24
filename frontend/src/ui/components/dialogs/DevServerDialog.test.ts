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

vi.mock('../session/ProcessIoView.ts', () => ({
  ProcessIoView: vi.fn(function (
    this: any,
    container,
    context,
    pipelineId,
    options = {},
  ) {
    this.container = container;
    this.context = context;
    this.pipelineId = pipelineId;
    this.options = options;
    this.render = vi.fn();
    this.destroy = vi.fn();
  }),
}));

import { DevServerDialog } from './DevServerDialog.ts';
import { ProcessIoView } from '../session/ProcessIoView.ts';

describe('DevServerDialog composition', () => {
  let mockContext: any;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mockContext = {
      devProcessService: { subscribe: vi.fn(() => () => {}) },
      pipelineClient: {
        stopDevServer: vi.fn(),
        getDevServerStatus: vi.fn().mockResolvedValue({}),
        resetDevServerToDefaultBranch: vi.fn().mockResolvedValue({}),
        rebuildDevServer: vi.fn().mockResolvedValue({}),
      },
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

  it('shows the default-branch button when running on another branch', async () => {
    mockContext.pipelineClient.getDevServerStatus.mockResolvedValue({
      task_id: 't1',
      target: 'coderbot/t1',
    });

    const dialog = new DevServerDialog(mockContext, 'p1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = dialog['dialog'].querySelector(
      '#dev-server-dialog-default-branch-btn',
    );
    expect(button).not.toBeNull();
    expect(button?.classList.contains('hidden')).toBe(false);
  });

  it('resets the dev server to the default branch on button click', async () => {
    mockContext.pipelineClient.getDevServerStatus.mockResolvedValue({
      task_id: 't1',
      target: 'coderbot/t1',
    });

    const dialog = new DevServerDialog(mockContext, 'p1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = dialog['dialog'].querySelector(
      '#dev-server-dialog-default-branch-btn',
    ) as HTMLButtonElement;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      mockContext.pipelineClient.resetDevServerToDefaultBranch,
    ).toHaveBeenCalledWith('p1');
  });

  it('hides the rebuild button without a current run or build commands', async () => {
    mockContext.pipelineClient.getDevServerStatus.mockResolvedValue({
      run_id: null,
      build_commands_configured: true,
    });
    let dialog = new DevServerDialog(mockContext, 'p1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    let button = dialog['dialog'].querySelector(
      '#dev-server-dialog-rebuild-btn',
    );
    expect(button?.classList.contains('hidden')).toBe(true);

    mockContext.pipelineClient.getDevServerStatus.mockResolvedValue({
      run_id: 'run-1',
      build_commands_configured: false,
    });
    dialog = new DevServerDialog(mockContext, 'p2');
    await new Promise((resolve) => setTimeout(resolve, 0));

    button = dialog['dialog'].querySelector('#dev-server-dialog-rebuild-btn');
    expect(button?.classList.contains('hidden')).toBe(true);
  });

  it('shows the rebuild button when a run and build commands exist', async () => {
    mockContext.pipelineClient.getDevServerStatus.mockResolvedValue({
      run_id: 'run-1',
      build_commands_configured: true,
      phase: 'running',
    });

    const dialog = new DevServerDialog(mockContext, 'p1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = dialog['dialog'].querySelector(
      '#dev-server-dialog-rebuild-btn',
    ) as HTMLButtonElement;
    expect(button.classList.contains('hidden')).toBe(false);
    expect(button.disabled).toBe(false);
    expect(button.textContent?.trim()).toBe('Rebuild');
  });

  it('rebuilds the dev server and remounts the ProcessIoView', async () => {
    mockContext.pipelineClient.getDevServerStatus.mockResolvedValue({
      run_id: 'run-1',
      build_commands_configured: true,
    });

    const dialog = new DevServerDialog(mockContext, 'p1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const firstInstance = (ProcessIoView as unknown as ReturnType<typeof vi.fn>)
      .mock.instances[0];
    const button = dialog['dialog'].querySelector(
      '#dev-server-dialog-rebuild-btn',
    ) as HTMLButtonElement;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockContext.pipelineClient.rebuildDevServer).toHaveBeenCalledWith(
      'p1',
    );
    expect(firstInstance.destroy).toHaveBeenCalledTimes(1);
    expect(ProcessIoView).toHaveBeenCalledTimes(2);
  });

  it('restores the rebuild button and shows an inline error on failure', async () => {
    mockContext.pipelineClient.getDevServerStatus.mockResolvedValue({
      run_id: 'run-1',
      build_commands_configured: true,
    });
    mockContext.pipelineClient.rebuildDevServer.mockRejectedValue(
      new Error('build service unavailable'),
    );

    const dialog = new DevServerDialog(mockContext, 'p1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = dialog['dialog'].querySelector(
      '#dev-server-dialog-rebuild-btn',
    ) as HTMLButtonElement;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(button.disabled).toBe(false);
    expect(button.textContent?.trim()).toBe('Rebuild');
    const error = dialog['dialog'].querySelector(
      '#dev-server-dialog-error',
    ) as HTMLElement;
    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toContain('build service unavailable');
  });

  it('disables the rebuild button while building and re-enables it afterwards', async () => {
    mockContext.pipelineClient.getDevServerStatus.mockResolvedValue({
      run_id: 'run-1',
      build_commands_configured: true,
      phase: 'running',
    });

    const dialog = new DevServerDialog(mockContext, 'p1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const options = (ProcessIoView as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][3] as { onStatus?: (status: string) => void };
    const button = dialog['dialog'].querySelector(
      '#dev-server-dialog-rebuild-btn',
    ) as HTMLButtonElement;

    options.onStatus?.('building');
    expect(button.disabled).toBe(true);
    expect(button.textContent?.trim()).toBe('Rebuilding…');

    options.onStatus?.('running');
    expect(button.disabled).toBe(false);
    expect(button.textContent?.trim()).toBe('Rebuild');

    options.onStatus?.('build_failed');
    expect(button.disabled).toBe(false);
    expect(button.textContent?.trim()).toBe('Rebuild');
  });
});
