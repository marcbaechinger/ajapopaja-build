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
import { ProcessIoView } from './ProcessIoView.ts';
import type { DevProcessEvent } from '../../../core/DevProcessService.ts';

describe('ProcessIoView', () => {
  let mount: HTMLElement;
  let context: any;
  let view: ProcessIoView | null;
  let onEvent: ((event: DevProcessEvent) => void) | null;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    view = null;
    onEvent = null;
    unsubscribe = vi.fn();

    context = {
      devProcessService: {
        subscribe: vi.fn((_pid: string, _runId: string | null, cb: any) => {
          onEvent = cb;
          return unsubscribe;
        }),
      },
      pipelineClient: {
        stopDevServer: vi.fn().mockResolvedValue({}),
      },
    };
  });

  afterEach(() => {
    view?.destroy();
    vi.restoreAllMocks();
  });

  const render = () => {
    view = new ProcessIoView(mount, context, 'p1', {});
    view.render();
    return view;
  };

  it('renders an empty state before any output', () => {
    render();
    const placeholder = mount.querySelector('#process-io-placeholder') as HTMLElement;
    expect(placeholder.textContent).toContain('No output yet');
    expect(placeholder.classList.contains('hidden')).toBe(false);
  });

  it('renders the header fields from a status event', () => {
    render();
    onEvent!({
      type: 'status',
      pid: 123,
      user: 'alice',
      port: 1224,
      status: 'running',
      run_id: 'abcdef1234567890',
      started_at: Date.now() / 1000,
      commands: [['sh', '-c', 'npm run dev']],
    });

    expect(mount.querySelector('#process-io-pid')!.textContent).toContain('123');
    expect(mount.querySelector('#process-io-user')!.textContent).toContain('alice');
    expect(mount.querySelector('#process-io-port')!.textContent).toContain('1224');
    expect(mount.querySelector('#process-io-run')!.textContent).toContain('abcdef12');
    expect(mount.querySelector('#process-io-command')!.textContent).toContain(
      'npm run dev',
    );
    expect(mount.querySelector('#process-io-status')!.textContent).toContain(
      'running',
    );
  });

  it('appends stdout and stderr chunks (stderr in red)', () => {
    render();
    onEvent!({ type: 'chunk', stream: 'stdout', text: 'standard output' });
    onEvent!({ type: 'chunk', stream: 'stderr', text: 'error output' });

    const output = mount.querySelector('#process-io-output') as HTMLElement;
    expect(output.textContent).toContain('standard output');
    expect(output.textContent).toContain('error output');

    const stderrSpan = Array.from(output.querySelectorAll('span')).find(
      (s) => s.textContent === 'error output',
    );
    expect(stderrSpan?.className).toContain('text-red-400');
    // The placeholder is hidden once output arrives.
    expect(
      mount.querySelector('#process-io-placeholder')!.classList.contains('hidden'),
    ).toBe(true);
  });

  it('auto-scrolls in follow mode and stops when toggled off', () => {
    render();
    const log = mount.querySelector('#process-io-log') as HTMLElement;
    Object.defineProperty(log, 'scrollHeight', { value: 500, configurable: true });

    onEvent!({ type: 'chunk', stream: 'stdout', text: 'a' });
    expect(log.scrollTop).toBe(500);

    (mount.querySelector('#process-io-follow') as HTMLButtonElement).click();
    Object.defineProperty(log, 'scrollHeight', { value: 900, configurable: true });
    onEvent!({ type: 'chunk', stream: 'stdout', text: 'b' });
    expect(log.scrollTop).toBe(500);
  });

  it('freezes the stream on exit and shows the exit code', () => {
    render();
    onEvent!({ type: 'exit', exit_code: 0 });

    expect(mount.textContent).toContain('process exited with code 0');
    expect(mount.querySelector('#process-io-status')!.textContent).toContain(
      'exited',
    );

    // A late chunk after exit is still rendered but the exit is not re-applied.
    onEvent!({ type: 'chunk', stream: 'stdout', text: 'late' });
    expect(mount.querySelector('#process-io-output')!.textContent).toContain('late');
  });

  it('shows a failed status pill for a non-zero exit', () => {
    render();
    onEvent!({ type: 'exit', exit_code: 2 });
    expect(mount.querySelector('#process-io-status')!.textContent).toContain(
      'failed',
    );
    expect(mount.textContent).toContain('process exited with code 2');
  });

  it('unsubscribes from the service on destroy', () => {
    render();
    view!.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('renders an error state when subscription fails', () => {
    context.devProcessService.subscribe = vi.fn(() => {
      throw new Error('offline');
    });
    render();
    expect(mount.textContent).toContain('Unable to connect');
  });

  it('stops the process through the pipeline client', async () => {
    render();
    (mount.querySelector('#process-io-stop') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(context.pipelineClient.stopDevServer).toHaveBeenCalledWith('p1');
  });

  it('clears the log and restores the placeholder', () => {
    render();
    onEvent!({ type: 'chunk', stream: 'stdout', text: 'output' });
    (mount.querySelector('#process-io-clear') as HTMLButtonElement).click();
    expect(mount.querySelector('#process-io-output')!.textContent).toBe('');
    expect(
      mount.querySelector('#process-io-placeholder')!.classList.contains('hidden'),
    ).toBe(false);
  });
});
