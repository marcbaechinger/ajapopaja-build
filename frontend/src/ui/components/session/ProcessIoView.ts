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

import type { AppContext } from '../../../core/AppContext.ts';
import type { DevProcessEvent } from '../../../core/DevProcessService.ts';

export interface ProcessIoViewOptions {
  /** Tailwind height class for the log area. Default 'h-[60vh]'. */
  logHeightClass?: string;
  /** Start with follow-mode auto-scroll enabled. Default true. */
  followInitially?: boolean;
  /** Invoked once when the stream terminates with the process exit code. */
  onExited?: (exitCode: number | null) => void;
  /** Invoked whenever a status event updates the process header. */
  onStatus?: (status: string) => void;
}

/**
 * A self-contained, embeddable view that streams and inspects the output of a
 * pipeline's background dev process.
 *
 * It owns the header (process information), the terminal-style log area, the
 * stream subscription and follow-mode, but intentionally NOT dialog framing so
 * it can be embedded anywhere (see `DevServerDialog`).
 */
export class ProcessIoView {
  private container: HTMLElement;
  private context: AppContext;
  private pipelineId: string;
  private options: ProcessIoViewOptions;

  private logContainer: HTMLElement | null = null;
  private output: HTMLElement | null = null;
  private placeholder: HTMLElement | null = null;

  private followMode: boolean;
  private hasOutput = false;
  private exited = false;

  private currentStatus = 'starting';
  private currentPid: number | null = null;
  private currentUser = '';
  private currentPort: number | null = null;
  private currentRunId: string | null = null;
  private currentCommands: string[][] | null = null;
  private currentTaskId: string | null = null;
  private currentBranch = '';
  private currentCommitHash: string | null = null;
  private startedAtMs: number | null = null;

  private unsubscribe: (() => void) | null = null;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    container: HTMLElement,
    context: AppContext,
    pipelineId: string,
    options: ProcessIoViewOptions = {},
  ) {
    this.container = container;
    this.context = context;
    this.pipelineId = pipelineId;
    this.options = options;
    this.followMode = options.followInitially ?? true;
  }

  /** Builds the DOM and subscribes to the process's log stream. */
  render(): void {
    this.container.innerHTML = `
      <div class="flex flex-col h-full">
        <div id="process-io-header" class="border-b border-app-border bg-app-surface/50 p-3 flex flex-col gap-2"></div>
        <div id="process-io-log" class="relative bg-black text-green-400 px-4 py-3 font-mono text-[11px] leading-tight overflow-y-auto ${this.options.logHeightClass ?? 'h-[60vh]'} custom-scrollbar selection:bg-app-accent-1/30">
          <div id="process-io-output" class="whitespace-pre-wrap break-all"></div>
          <div id="process-io-placeholder" class="absolute inset-0 flex items-center justify-center text-center px-4 text-app-text/40 text-xs italic pointer-events-none">No output yet — waiting for the process…</div>
        </div>
        <div id="process-io-actions" class="border-t border-app-border bg-app-surface/50 p-3 flex items-center justify-between gap-2"></div>
      </div>
    `;

    this.logContainer = this.container.querySelector('#process-io-log');
    this.output = this.container.querySelector('#process-io-output');
    this.placeholder = this.container.querySelector('#process-io-placeholder');

    this.renderHeader();
    this.renderActions();
    this.subscribe();
  }

  /** Unsubscribes from the stream (and tells the server to stop pumping). */
  destroy(): void {
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch (error) {
        console.error('ProcessIoView: error tearing down subscription', error);
      }
      this.unsubscribe = null;
    }
    this.stopElapsedTimer();
  }

  // ---------------------------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------------------------

  private subscribe(): void {
    try {
      this.unsubscribe = this.context.devProcessService.subscribe(
        this.pipelineId,
        this.currentRunId,
        (event) => this.handleEvent(event),
      );
    } catch (error) {
      console.error('ProcessIoView: failed to subscribe to log stream', error);
      this.showError('Unable to connect to the dev server log stream.');
    }
  }

  private handleEvent(event: DevProcessEvent): void {
    switch (event.type) {
      case 'status':
        this.applyStatus(event);
        break;
      case 'chunk':
        this.appendChunk(event.stream ?? 'stdout', event.text ?? '');
        break;
      case 'exit':
        this.handleExit(event.exit_code ?? null);
        break;
    }
  }

  private applyStatus(event: DevProcessEvent): void {
    if (typeof event.pid === 'number') this.currentPid = event.pid;
    if (typeof event.user === 'string') this.currentUser = event.user;
    if (typeof event.port === 'number') this.currentPort = event.port;
    if (event.run_id !== undefined) this.currentRunId = event.run_id ?? null;
    if (Array.isArray(event.commands)) this.currentCommands = event.commands;
    if (event.task_id !== undefined) this.currentTaskId = event.task_id ?? null;
    if (typeof event.branch === 'string') this.currentBranch = event.branch;
    if (event.commit_hash !== undefined) {
      this.currentCommitHash = event.commit_hash ?? null;
    }
    if (typeof event.status === 'string') this.currentStatus = event.status;
    if (typeof event.started_at === 'number') {
      this.startedAtMs = event.started_at * 1000;
    }
    this.renderHeader();
    this.renderActions();
    this.startElapsedTimer();
    this.options.onStatus?.(this.currentStatus);
  }

  private appendChunk(stream: 'stdout' | 'stderr' | string, text: string): void {
    if (!this.output || !text) return;
    const span = document.createElement('span');
    if (stream === 'stderr') {
      span.className = 'text-red-400';
    }
    span.textContent = text;
    this.output.appendChild(span);

    if (!this.hasOutput) {
      this.hasOutput = true;
      this.placeholder?.classList.add('hidden');
    }
    if (this.followMode) {
      this.scrollToBottom();
    }
  }

  private handleExit(exitCode: number | null): void {
    if (this.exited) return;
    this.exited = true;
    this.stopElapsedTimer();
    if (this.currentStatus !== 'build_failed') {
      this.currentStatus = exitCode === 0 ? 'exited' : 'failed';
    }

    if (this.output) {
      const line = document.createElement('span');
      line.className = exitCode === 0 ? 'text-green-500' : 'text-red-400';
      line.textContent =
        exitCode === null
          ? '\n[process stream ended]\n'
          : `\n[process exited with code ${exitCode}]\n`;
      this.output.appendChild(line);
      this.hasOutput = true;
      this.placeholder?.classList.add('hidden');
      if (this.followMode) this.scrollToBottom();
    }

    this.renderHeader();
    this.options.onExited?.(exitCode);
  }

  private showError(message: string): void {
    if (this.placeholder) {
      this.placeholder.textContent = message;
      this.placeholder.classList.remove('hidden');
    }
  }

  // ---------------------------------------------------------------------------
  // Header / actions
  // ---------------------------------------------------------------------------

  private renderHeader(): void {
    const header = this.container.querySelector('#process-io-header');
    if (!header) return;

    const statusLabel = this.currentStatus || 'starting';
    const branch = this.currentBranch || '—';
    header.innerHTML = `
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[10px] font-bold uppercase tracking-wider text-app-muted">Dev Server</span>
        <span id="process-io-status" class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${this.statusPillClass(statusLabel)}">${ProcessIoView.escape(statusLabel)}</span>
        <span id="process-io-elapsed" class="text-[10px] text-app-muted font-mono">0s</span>
      </div>
      <div class="flex gap-1 min-w-0 text-[10px]">
        <span class="uppercase font-bold text-app-muted shrink-0">Branch</span>
        <span id="process-io-branch" class="text-app-text font-mono truncate" title="${ProcessIoView.escape(branch)}">${ProcessIoView.escape(branch)}</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[10px]">
        <div class="flex gap-1 min-w-0"><span class="uppercase font-bold text-app-muted shrink-0">PID</span><span id="process-io-pid" class="text-app-text font-mono truncate">${this.currentPid ?? '—'}</span></div>
        <div class="flex gap-1 min-w-0"><span class="uppercase font-bold text-app-muted shrink-0">User</span><span id="process-io-user" class="text-app-text truncate">${ProcessIoView.escape(this.currentUser || '—')}</span></div>
        <div class="flex gap-1 min-w-0"><span class="uppercase font-bold text-app-muted shrink-0">Port</span><span id="process-io-port" class="text-app-text font-mono truncate">${this.currentPort ?? '—'}</span></div>
        <div class="flex gap-1 min-w-0"><span class="uppercase font-bold text-app-muted shrink-0">Run</span><span id="process-io-run" class="text-app-text font-mono truncate" title="${ProcessIoView.escape(this.currentRunId ?? '')}">${ProcessIoView.escape(this.shortRunId())}</span></div>
        <div class="flex gap-1 min-w-0"><span class="uppercase font-bold text-app-muted shrink-0">Pipeline</span><span id="process-io-pipeline" class="text-app-text font-mono truncate" title="${ProcessIoView.escape(this.pipelineId)}">${ProcessIoView.escape(this.pipelineId)}</span></div>
        <div class="flex gap-1 min-w-0"><span class="uppercase font-bold text-app-muted shrink-0">Task</span><span id="process-io-task" class="text-app-text font-mono truncate" title="${ProcessIoView.escape(this.currentTaskId ?? '')}">${ProcessIoView.escape(this.currentTaskId || '—')}</span></div>
        <div class="flex gap-1 min-w-0"><span class="uppercase font-bold text-app-muted shrink-0">Commit</span><span id="process-io-commit" class="text-app-text font-mono truncate" title="${ProcessIoView.escape(this.currentCommitHash ?? '')}">${ProcessIoView.escape(this.shortCommitHash())}</span></div>
      </div>
      <div class="flex gap-1 min-w-0 text-[10px]">
        <span class="uppercase font-bold text-app-muted shrink-0">Command</span>
        <code id="process-io-command" class="text-app-text font-mono truncate" title="${ProcessIoView.escape(this.formatCommands())}">${ProcessIoView.escape(this.formatCommands())}</code>
      </div>
    `;
    this.updateElapsed();
  }

  private renderActions(): void {
    const actions = this.container.querySelector('#process-io-actions');
    if (!actions) return;
    actions.innerHTML = `
      <div class="flex gap-2">
        <button id="process-io-follow" type="button" class="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${this.followMode ? 'bg-app-accent-1 text-app-accent-fg hover:brightness-110' : 'bg-app-bg border border-app-border text-app-muted hover:text-app-text'}">Follow Mode: ${this.followMode ? 'ON' : 'OFF'}</button>
        <button id="process-io-clear" type="button" class="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider bg-app-bg border border-app-border text-app-muted hover:text-app-text transition-colors cursor-pointer">Clear</button>
      </div>
      <div class="flex gap-2">
        <button id="process-io-stop" type="button" class="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-500/80 text-white hover:bg-red-500 transition-colors cursor-pointer">Stop</button>
        <button id="process-io-open" type="button" ${this.currentPort == null ? 'disabled' : ''} class="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider bg-app-accent-2 text-app-accent-fg hover:brightness-105 transition-colors cursor-pointer ${this.currentPort == null ? 'opacity-50 cursor-not-allowed' : ''}">Open</button>
      </div>
    `;

    actions.querySelector('#process-io-follow')?.addEventListener('click', () => {
      this.followMode = !this.followMode;
      this.renderActions();
      if (this.followMode) this.scrollToBottom();
    });
    actions.querySelector('#process-io-clear')?.addEventListener('click', () => {
      if (this.output) this.output.innerHTML = '';
      this.hasOutput = false;
      this.placeholder?.classList.remove('hidden');
    });
    actions.querySelector('#process-io-stop')?.addEventListener('click', () => {
      void this.stopProcess();
    });
    actions.querySelector('#process-io-open')?.addEventListener('click', () => {
      this.openProcess();
    });
  }

  private async stopProcess(): Promise<void> {
    try {
      await this.context.pipelineClient?.stopDevServer?.(this.pipelineId);
    } catch (error) {
      console.error('ProcessIoView: failed to stop dev server', error);
    }
  }

  private openProcess(): void {
    if (this.currentPort == null) return;
    const host = window.location.hostname || 'localhost';
    window.open(`http://${host}:${this.currentPort}`, '_blank');
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private scrollToBottom(): void {
    if (!this.logContainer) return;
    this.logContainer.scrollTop = this.logContainer.scrollHeight;
  }

  private startElapsedTimer(): void {
    if (this.startedAtMs == null || this.elapsedTimer != null) return;
    this.elapsedTimer = setInterval(() => this.updateElapsed(), 1000);
    this.updateElapsed();
  }

  private stopElapsedTimer(): void {
    if (this.elapsedTimer != null) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  private updateElapsed(): void {
    const el = this.container.querySelector('#process-io-elapsed');
    if (!el) return;
    if (this.startedAtMs == null) {
      el.textContent = '0s';
      return;
    }
    el.textContent = ProcessIoView.formatElapsed(Date.now() - this.startedAtMs);
  }

  private shortRunId(): string {
    if (!this.currentRunId) return '—';
    return this.currentRunId.length > 8
      ? this.currentRunId.slice(0, 8)
      : this.currentRunId;
  }

  private shortCommitHash(): string {
    if (!this.currentCommitHash) return '—';
    return this.currentCommitHash.length > 8
      ? this.currentCommitHash.slice(0, 8)
      : this.currentCommitHash;
  }

  private formatCommands(): string {
    if (!this.currentCommands || this.currentCommands.length === 0) return '—';
    return this.currentCommands.map((argv) => argv.join(' ')).join(' && ');
  }

  private statusPillClass(status: string): string {
    if (status === 'building') {
      return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
    }
    if (status === 'exited') {
      return 'bg-green-500/10 border-green-500/30 text-green-500';
    }
    if (
      status === 'failed' ||
      status === 'build_failed' ||
      status === 'stopped'
    ) {
      return 'bg-red-500/10 border-red-500/30 text-red-400';
    }
    return 'bg-green-500/10 border-green-500/30 text-green-400';
  }

  private static formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

  private static escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
