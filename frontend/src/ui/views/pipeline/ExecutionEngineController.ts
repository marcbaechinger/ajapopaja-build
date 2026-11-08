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

import { ExecutionEngineView } from '../../components/pipeline/ExecutionEngineView.ts';
import { PiView } from '../../components/session/PiView.ts';
import { TaskStatus } from '../../../core/domain.ts';
import type { PipelineDetailCtx } from './PipelineDetailCtx.ts';

export interface ExecutionEngineControllerDeps {
  ctx: PipelineDetailCtx;
  /** The view root; the controller queries #execution-engine-view inside it. */
  host: HTMLElement;
  /** Pops the compact log out into the full CoderBot dialog. */
  onOpenCoderBotDialog: () => void;
}

/**
 * Owns the right-sidebar execution engine panel and the embedded CoderBot
 * `PiView` lifecycle.
 *
 * The controller renders the engine overview (`ExecutionEngineView`) into the
 * stable `#execution-engine-view` mount point and keeps the compact CoderBot
 * activity log (`#engine-piview-mount`) in sync with the current session:
 * mounting a `PiView` for this pipeline, reconnecting an existing one, and
 * showing a placeholder or an "other pipeline" notice otherwise.
 */
export class ExecutionEngineController {
  private readonly deps: ExecutionEngineControllerDeps;
  private enginePiView: PiView | null = null;
  private enginePiMountedKey: string | null = null;
  /** Whether all engine sections are collapsed (shared for the group). */
  private sectionsCollapsed: boolean = false;

  constructor(deps: ExecutionEngineControllerDeps) {
    this.deps = deps;
    // The collapse toggle lives in the stable shell and is delegated from the
    // host so it keeps working across section repaints and PiView re-mounts.
    this.deps.host.addEventListener('click', this.handleClick);
  }

  /** Delegated click handler for the sections collapse toggle. */
  private handleClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('#engine-sections-toggle')) return;
    this.toggleSections();
  };

  /** Collapses or expands all engine sections together. */
  toggleSections(): void {
    this.setSectionsCollapsed(!this.sectionsCollapsed);
  }

  /**
   * Sets the shared section collapse state and applies it to the mounted DOM.
   * Collapsed sections free their vertical space so the embedded PiView grows to
   * the full sidebar height.
   */
  setSectionsCollapsed(collapsed: boolean): void {
    this.sectionsCollapsed = collapsed;
    const el = this.deps.host.querySelector('#execution-engine-view');
    if (el) ExecutionEngineView.applySectionsCollapsed(el, collapsed);
  }

  /** Repaints the engine overview and then re-syncs the embedded Pi slot. */
  refresh(): void {
    const el = this.deps.host.querySelector('#execution-engine-view');
    if (!el) return;

    const { allLoadedTasks, historyPage } = this.deps.ctx.state;
    const historyTasks = allLoadedTasks
      .filter(
        (t) =>
          !t.deleted &&
          ([TaskStatus.IMPLEMENTED, TaskStatus.SUBMITTED, TaskStatus.DISCARDED] as any[]).includes(
            t.status
          )
      )
      .sort(
        (a, b) =>
          new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      );
    const props = {
      tasks: allLoadedTasks,
      historyTasks,
      historyPage,
    };

    // The shell (including the stable #engine-piview-section / #engine-piview-mount)
    // is written once. Every later refresh repaints only #engine-sections, so a
    // mounted PiView survives the repaint and its activity log is not reset.
    if (!el.querySelector('#engine-piview-section')) {
      el.innerHTML = ExecutionEngineView.renderShell('', this.sectionsCollapsed);
    }
    const sections = el.querySelector('#engine-sections');
    if (sections) {
      sections.innerHTML = ExecutionEngineView.renderSections(props);
    }

    // Re-render the engine Pi slot based on the current CoderBot session.
    this.updateSlot();
    // Re-assert the collapse state after the sections/PiView were (re)built.
    ExecutionEngineView.applySectionsCollapsed(el, this.sectionsCollapsed);
  }

  /** Render the engine Pi slot based on the running session vs this pipeline. */
  updateSlot(): void {
    this.syncSlot();
    // Re-assert the collapse state so a freshly mounted PiView adopts the full
    // height when the sections are collapsed.
    const el = this.deps.host.querySelector('#execution-engine-view');
    if (el) ExecutionEngineView.applySectionsCollapsed(el, this.sectionsCollapsed);
  }

  private syncSlot(): void {
    const mount = this.deps.host.querySelector('#engine-piview-mount') as HTMLElement | null;
    if (!mount) return;

    const placeholder = `<p class="text-[10px] italic text-app-muted/50 text-center border border-dashed border-app-border/40 rounded-lg py-3">Start a CoderBot to see its output here.</p>`;
    const pipelineId = this.deps.ctx.pipelineId;
    const session = this.deps.ctx.context.coderBotService?.getCurrentSession?.() ?? null;

    if (!session || !session.taskId) {
      this.teardown();
      mount.innerHTML = placeholder;
      return;
    }

    if (session.pipelineId === pipelineId) {
      // Session belongs to this pipeline: connect/resume the PiView. Re-mount
      // when the mounted session changed OR the PiView DOM was wiped by an
      // ExecutionEngineView re-render; otherwise reuse it and just reconnect.
      const key = `${session.pipelineId}:${session.taskId}`;
      const logRendered = !!mount.querySelector('#log-content-container');
      if (!this.enginePiView || this.enginePiMountedKey !== key || !logRendered) {
        this.mountCoderBotPiView(mount);
        this.enginePiMountedKey = key;
      } else {
        this.deps.ctx.context.coderBotService?.reconnect?.();
      }
      return;
    }

    this.teardown();
    if (session.active) {
      mount.innerHTML = `
        <p class="text-[10px] italic text-app-muted/70 text-center border border-dashed border-app-border/40 rounded-lg py-3">CoderBot is running for another pipeline.</p>
        <a href="#/pipeline/${session.pipelineId}" class="block text-center text-[10px] font-bold uppercase tracking-widest text-app-accent-2 hover:underline cursor-pointer mt-1">Open pipeline</a>`;
    } else {
      mount.innerHTML = placeholder;
    }
  }

  /**
   * Refreshes the session from the service, then re-syncs the Pi slot.
   */
  async refreshSlot(): Promise<void> {
    await this.deps.ctx.context.coderBotService?.refreshSession?.();
    this.updateSlot();
  }

  /** Destroys the embedded PiView (if any) and clears the mount key. */
  teardown(): void {
    if (this.enginePiView) {
      this.enginePiView.destroy();
      this.enginePiView = null;
    }
    this.enginePiMountedKey = null;
  }

  /**
   * Full controller teardown: detaches the sections toggle listener in addition
   * to tearing down the embedded PiView. Called when the host view unmounts.
   */
  destroy(): void {
    this.deps.host.removeEventListener('click', this.handleClick);
    this.teardown();
  }

  private mountCoderBotPiView(mount: HTMLElement): void {
    this.teardown();
    mount.innerHTML = '';
    // Defer the initial (potentially large, already-loaded) session history so
    // the rest of the pipeline detail view paints first; the log then fills in on
    // the next animation frame for a snappy page render.
    this.enginePiView = new PiView(this.deps.ctx.context.coderBotService, mount, {
      variant: 'batch',
      logHeightClass: 'h-[38vh]',
      deferInitialRender: true,
      // Pop this compact sidebar log back out into the full CoderBot dialog.
      onOpenDialog: () => this.deps.onOpenCoderBotDialog(),
    });
    this.enginePiView.render();
    this.deps.ctx.context.coderBotService?.reconnect?.();
  }
}
