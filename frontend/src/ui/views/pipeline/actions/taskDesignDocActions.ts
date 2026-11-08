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

import { ConfirmationDialog } from '../../../components/dialogs/ConfirmationDialog.ts';
import { DesignDocDialog } from '../../../components/dialogs/DesignDocDialog.ts';
import { DesignDocDiffDialog } from '../../../components/dialogs/DesignDocDiffDialog.ts';
import { TaskItem } from '../../../components/pipeline/TaskItem.ts';
import EasyMDE from 'easymde';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';
import { copyToClipboard } from '../../../utils/clipboard.ts';

/** No shell callbacks are required; every need is satisfied by `ctx`. */
export interface TaskDesignDocActionsDeps {}

/**
 * Registers the design-document actions on the shared action registry:
 * `view_design_doc`, `view_design_doc_history`, `edit_design_doc`,
 * `toggle_edit_design_doc_expand`, `toggle_design_doc_expand`,
 * `toggle_design_doc_toc`, `copy_design_doc`, `cancel_design_doc`,
 * `save_design_doc`, `accept_design` and `reject_design`.
 *
 * The handlers were extracted verbatim from `PipelineDetailView` (P9b). They
 * only need `ctx`: task state comes from `ctx.state.allLoadedTasks`, the
 * EasyMDE editors live in `ctx.state.activeEditors` (ownership is conceptual;
 * the shell's `unmount()` still drains the map) and all repaints happen via the
 * WebSocket after the backend update.
 */
export function registerTaskDesignDocActions(
  ctx: PipelineDetailCtx,
  _deps: TaskDesignDocActionsDeps,
): void {
  const { actionRegistry } = ctx.context;

  actionRegistry.register('view_design_doc', async (_e, el) => {
    const container = el.closest('.design-doc-container') as HTMLElement;
    if (!container) return;
    const taskId = container.getAttribute('data-task-id');
    if (!taskId) return;
    const task = ctx.state.allLoadedTasks.find(t => t.id === taskId);
    if (task && task.design_doc) {
      new DesignDocDialog('Design Document', task.design_doc).show();
    }
  });

  actionRegistry.register('view_design_doc_history', async (_e, el) => {
    const container = el.closest('.design-doc-container') as HTMLElement;
    if (!container) return;
    const taskId = container.getAttribute('data-task-id');
    if (!taskId) return;
    const task = ctx.state.allLoadedTasks.find(t => t.id === taskId);
    if (task) {
      new DesignDocDiffDialog(ctx.context, task).show();
    }
  });

  actionRegistry.register('edit_design_doc', async (_e, el) => {
    const container = el.closest('.design-doc-container') as HTMLElement;
    if (!container) return;

    const taskId = container.getAttribute('data-task-id');
    const textarea = container.querySelector('textarea');
    if (!taskId || !textarea) return;

    container.querySelector('.design-doc-view')?.classList.add('hidden');
    container.querySelector('.design-doc-actions')?.classList.add('hidden');
    container.querySelector('.design-doc-edit')?.classList.remove('hidden');

    // Initialize EasyMDE
    const editor = new EasyMDE({
      element: textarea,
      spellChecker: false,
      status: false,
      minHeight: "150px",
      toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "code", "table", "|", "preview", "side-by-side", "fullscreen"],
      onFullScreen: (full: boolean) => {
        if (full) {
          container.classList.add('z-[100]');
          // Add a temporary backdrop
          const backdrop = document.createElement('div');
          backdrop.id = 'editor-backdrop';
          backdrop.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[90]';
          document.body.appendChild(backdrop);
        } else {
          container.classList.remove('z-[100]');
          document.getElementById('editor-backdrop')?.remove();
        }
      }
    } as any);

    ctx.state.activeEditors.set(taskId, editor);
    editor.codemirror.focus();
  });

  actionRegistry.register('toggle_edit_design_doc_expand', async (_e, el) => {
    const container = el.closest('.design-doc-container') as HTMLElement;
    if (!container) return;

    const cm = container.querySelector('.CodeMirror');
    if (!cm) return;

    const isExpanded = cm.classList.toggle('expanded-editor');
    el.textContent = isExpanded ? 'Show Less' : 'Show More';
  });

  actionRegistry.register('toggle_design_doc_expand', async (_e, el) => {
    const container = el.closest('.design-doc-container') as HTMLElement;
    if (!container) return;

    const display = container.querySelector('.design-doc-display');
    if (!display) return;

    const isExpanded = display.classList.toggle('expanded');
    el.textContent = isExpanded ? 'Show Less' : 'Show More';
  });

  actionRegistry.register('toggle_design_doc_toc', async (_e, el) => {
    const container = el.closest('.design-doc-container') as HTMLElement | null;
    const taskId = container?.getAttribute('data-task-id');
    const task = taskId
      ? ctx.state.allLoadedTasks.find(t => t.id === taskId)
      : undefined;
    TaskItem.toggleDesignDocToc(el, task?.design_doc ?? '');
  });

  actionRegistry.register('copy_design_doc', async (_e, el) => {
    const container = el.closest('.design-doc-container') as HTMLElement;
    if (!container) return;
    const taskId = container.getAttribute('data-task-id');
    if (!taskId) return;
    const task = ctx.state.allLoadedTasks.find(t => t.id === taskId);
    if (task && task.design_doc) {
      try {
        await copyToClipboard(task.design_doc);
        const originalText = el.innerHTML;
        el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
        setTimeout(() => {
          el.innerHTML = originalText;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
    }
  });

  actionRegistry.register('cancel_design_doc', async (_e, el) => {
    const container = el.closest('.design-doc-container') as HTMLElement;
    if (!container) return;

    const taskId = container.getAttribute('data-task-id');
    if (taskId) {
      const editor = ctx.state.activeEditors.get(taskId);
      if (editor) {
        editor.toTextArea();
        ctx.state.activeEditors.delete(taskId);
      }
    }

    container.querySelector('.design-doc-view')?.classList.remove('hidden');
    container.querySelector('.design-doc-actions')?.classList.remove('hidden');
    const editToggle = container.querySelector('[data-action-click="toggle_edit_design_doc_expand"]');
    if (editToggle) {
      editToggle.classList.remove('hidden');
      editToggle.textContent = 'Show More';
    }
    container.querySelector('.design-doc-edit')?.classList.add('hidden');
  });

  actionRegistry.register('save_design_doc', async (_e, el) => {
    const container = el.closest('.design-doc-container') as HTMLElement;
    if (!container) return;

    const taskId = container.getAttribute('data-task-id');
    const version = parseInt(container.getAttribute('data-version') || '1');
    if (!taskId) return;

    const editor = ctx.state.activeEditors.get(taskId);
    if (!editor) return;

    const designDoc = editor.value().trim();

    try {
      await ctx.context.taskClient.updateDetails(taskId, version, { design_doc: designDoc });
      // After success, destroy editor
      editor.toTextArea();
      ctx.state.activeEditors.delete(taskId);
      // UI refresh will be triggered by WebSocket message TASK_UPDATED
    } catch (error) {
      alert('Failed to save design doc. Please try again.');
    }
  });

  actionRegistry.register('accept_design', async (_e, el) => {
    const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
    const version = parseInt(el.getAttribute('data-version') || '1');
    if (!taskId) return;

    try {
      await ctx.context.taskClient.acceptDesign(taskId, version);
      // Refresh handled by WS
    } catch (error) {
      alert('Failed to accept design');
    }
  });

  actionRegistry.register('reject_design', async (_e, el) => {
    const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
    const version = parseInt(el.getAttribute('data-version') || '1');
    if (!taskId) return;

    const confirmed = await new ConfirmationDialog(
      'Reject Design',
      'Are you sure you want to reject this design? This task will be marked as DISCARDED.',
      'Reject'
    ).show();

    if (!confirmed) return;

    try {
      await ctx.context.taskClient.rejectDesign(taskId, version);
      // Refresh handled by WS
    } catch (error) {
      alert('Failed to reject design');
    }
  });
}
