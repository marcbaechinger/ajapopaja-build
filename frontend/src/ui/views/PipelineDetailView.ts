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

import { View } from '../../core/Navigator.ts';
import { AppContext } from '../../core/AppContext.ts';
import { Pipeline, TaskStatus, Task, type GitStatus } from '../../core/domain.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.ts';
import { TaskItem } from '../components/TaskItem.ts';
import { HistoryDialog } from '../components/HistoryDialog.ts';
import { StatsDialog } from '../components/StatsDialog.ts';
import { TaskForm } from '../components/TaskForm.ts';
import { DesignDocDialog } from '../components/DesignDocDialog.ts';
import { DesignDocDiffDialog } from '../components/DesignDocDiffDialog.ts';
import { TaskColumn } from '../components/TaskColumn.ts';
import { CompletedSection } from '../components/CompletedSection.ts';
import { PipelineStatsView } from '../components/PipelineStatsView.ts';
import { PaginationControl } from '../components/PaginationControl.ts';
import { LogViewerDialog } from '../components/LogViewerDialog.ts';
import { DocBotDialog } from '../components/DocBotDialog.ts';
import type { DocBotDialogProps } from '../components/DocBotDialog.ts';
import { PipelineEditDialog } from '../components/PipelineEditDialog.ts';
import { ReviewDialog } from '../components/ReviewDialog.ts';
import { PipelineHeaderView, type DocbotState, type ReviewbotState } from '../components/PipelineHeaderView.ts';
import EasyMDE from 'easymde';

export class PipelineDetailView extends View {
  private container: HTMLElement | null = null;
  private pipelineId: string;
  private pipeline: Pipeline | null = null;
  private geminiStatus: { running: boolean, log_file: string | null, available: boolean } = { running: false, log_file: null, available: true };
  private vibeStatus: { running: boolean, log_file: string | null, available: boolean } = { running: false, log_file: null, available: true };
  private isTwoColumnLayout: boolean = localStorage.getItem('pipeline-layout') === '2-col';
  private context: AppContext;
  private unsubs: (() => void)[] = [];
  private activeEditors: Map<string, EasyMDE> = new Map();
  private currentSortOrder: 'execution' | 'newest' | 'status' = 'execution';
  private allLoadedTasks: Task[] = [];
  private collapsedTasks: Set<string> = new Set();
  private expandedSpecs: Set<string> = new Set();
  private isFirstLoad: boolean = true;
  private completedTasksPage: number = 0;
  private completedPageSize: number = 5;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private gitStatus: GitStatus | undefined = undefined;
  private gitStatusRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private gitStatusRefreshInProgress: boolean = false;
  private gitStatusRefreshPending: boolean = false;
  private pendingReviews: string[] = [];

  private docbotState: DocbotState = {
    status: 'none',
    taskId: null,
  };

  private reviewbotState: ReviewbotState = {
    status: 'none',
    taskId: null,
  };

  private archbotState: { status: 'none' | 'inProgress', taskId: string | null } = {
    status: 'none',
    taskId: null,
  };


  private columnMetadata: Record<string, { title: string, emptyMessage: string }> = {
    'proposed': { title: 'Proposed', emptyMessage: 'No proposed designs.' },
    'backlog': { title: 'Backlog', emptyMessage: 'Backlog is empty.' },
    'inprogress': { title: 'In Progress', emptyMessage: 'No active work.' },
    'failed': { title: 'Failed', emptyMessage: '' },
    'scheduled': { title: 'Queue', emptyMessage: 'Nothing scheduled.' },
  };

  constructor(context: AppContext, params: Record<string, string>) {
    super();
    this.context = context;
    this.pipelineId = params.id;
    this.registerActions();
    this.setupDataManagerSubscriptions();
    this.setupKeyboardShortcuts();
  }

  private getTaskColumnId(task: Task): string {
    switch (task.status) {
      case TaskStatus.PROPOSED: return 'proposed-list';
      case TaskStatus.CREATED: return 'backlog-list';
      case TaskStatus.INPROGRESS: return 'inprogress-list';
      case TaskStatus.FAILED: return 'failed-list';
      case TaskStatus.SCHEDULED: return 'scheduled-list';
      case TaskStatus.IMPLEMENTED:
      case TaskStatus.DISCARDED:
        const completedTasks = this.allLoadedTasks
          .filter(t => !t.deleted && ([TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED] as any[]).includes(t.status))
          .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
        if (completedTasks.length > 0 && completedTasks[0].id === task.id) {
          return 'last-completed-task';
        }
        return 'completed-task-list';
      default: return 'backlog-list';
    }
  }

  private updateColumnHeaderCount(columnId: string) {
    if (!this.container) return;
    const list = this.container.querySelector(`#${columnId}`);
    if (!list) return;

    const count = list.querySelectorAll('[data-view-id]').length;
    const section = list.closest('section');
    if (section) {
      const countEl = section.querySelector('h3 span:last-child');
      if (countEl) {
        countEl.textContent = `(${count})`;
      }
    }
  }

  private ensureEmptyMessage(columnId: string) {
    const list = this.container?.querySelector(`#${columnId}`);
    if (!list) return;
    if (list.children.length === 0) {
      const key = columnId.replace('-list', '');
      const meta = this.columnMetadata[key];
      if (meta && meta.emptyMessage) {
        list.innerHTML = `<p class="text-app-muted italic text-sm py-4 text-center border-2 border-dashed border-app-border/30 rounded-xl">${meta.emptyMessage}</p>`;
      }
    }
  }

  private removeEmptyMessage(columnId: string) {
    const list = this.container?.querySelector(`#${columnId}`);
    if (!list) return;
    const emptyMsg = list.querySelector('p.text-app-muted.italic');
    if (emptyMsg) {
      emptyMsg.remove();
    }
  }

  private setupKeyboardShortcuts() {
    this.keydownHandler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) {
        return;
      }

      // 'h' key for history dialog
      if (e.key === 'h' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        new HistoryDialog(this.allLoadedTasks).show();
      }

      // 's' key for stats dialog
      if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        new StatsDialog(this.allLoadedTasks, this.pipelineId, this.context.pipelineClient).show();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  private setupDataManagerSubscriptions() {
    const dm = this.context.dataManager;

    // Listen for pipeline metadata updates
    this.unsubs.push(dm.on(`pipeline:${this.pipelineId}`, (pipeline: Pipeline) => {
      this.pipeline = pipeline;
      this.updateHeader();
    }));

    // Listen for task updates (created, updated, moved, deleted)
    this.unsubs.push(dm.on(`pipeline:tasks:${this.pipelineId}`, (taskOrDeleted: any) => {
      if (taskOrDeleted.deleted) {
        this.removeTaskFromDOM(taskOrDeleted.id);
        this.allLoadedTasks = this.allLoadedTasks.filter(t => t.id !== taskOrDeleted.id);
      } else {
        const task = taskOrDeleted as Task;
        this.updateSingleTask(task);
        if (task.status === TaskStatus.IMPLEMENTED) {
          this.scheduleRefreshGitStatus();
        }
      }
      this.updateHeader();
    }));

    // Listen for process and bot status updates via specific WS event queries
    const eventHandlers: Record<string, (payload: any) => void> = {
      'GEMINI_PROCESS_STARTED': () => { this.geminiStatus.running = true; },
      'GEMINI_PROCESS_STOPPED': () => { this.geminiStatus.running = false; },
      'VIBE_PROCESS_STARTED': () => { this.vibeStatus.running = true; },
      'VIBE_PROCESS_STOPPED': () => { this.vibeStatus.running = false; },
      'DOCBOT_STARTED': (p) => { this.docbotState = { status: 'inProgress', taskId: p.task_id }; },
      'DOCBOT_COMPLETED': (p) => {
        const result = p.result;
        if (result?.status === 'no_update_needed') {
          this.docbotState = { status: 'noUpdate', taskId: p.task_id, reason: result.reason };
        } else if (result?.status === 'update_needed') {
          if (this.docbotState.status !== 'ready') {
            this.fetchDocBotPreview(p.task_id);
          }
        } else if (this.docbotState.status !== 'ready') {
          this.docbotState = { status: 'none', taskId: null };
        }
      },
      'DOCBOT_PREVIEW_READY': (p) => { this.fetchDocBotPreview(p.task_id); },
      'REVIEWBOT_STARTED': (p) => { this.reviewbotState = { status: 'inProgress', taskId: p.task_id }; },
      'REVIEWBOT_COMPLETED': () => { this.reviewbotState = { status: 'none', taskId: null }; },
      'REVIEWBOT_REVIEW_READY': (p) => {
        this.reviewbotState = { status: 'none', taskId: null };
        const taskId = p.id || p._id || p.task_id;
        if (taskId && !this.pendingReviews.includes(taskId)) {
          this.pendingReviews.push(taskId);
        }
      },

      'ARCHBOT_STARTED': (p) => { this.archbotState = { status: 'inProgress', taskId: p.task_id }; },
      'ARCHBOT_COMPLETED': () => { this.archbotState = { status: 'none', taskId: null }; },
    };

    Object.entries(eventHandlers).forEach(([event, handler]) => {
      this.unsubs.push(dm.on(`ws:${event}:${this.pipelineId}`, (payload) => {
        handler(payload);
        this.updateHeader();
      }));
    });
  }

  private docbotPreviewData: any = null;

  private async fetchDocBotPreview(taskId: string) {
    try {
      const response = await fetch(`/api/pipelines/${this.pipelineId}/docbot/preview/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${this.context.authService.getAccessToken()}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.docbotPreviewData = data;
        this.docbotState = {
          status: 'ready',
          taskId: data.task_id,
        };
        this.updateHeader();
      }
    } catch (error) {
      console.error('Failed to fetch DocBot preview:', error);
    }
  }

  private openDocBotDialog() {
    const dialogContainer = this.container?.querySelector('#docbot-dialog-container') as HTMLElement;
    if (!dialogContainer || !this.docbotState.taskId || !this.docbotPreviewData) return;

    const props: DocBotDialogProps = {
      taskId: this.docbotState.taskId,
      pipelineId: this.pipelineId,
      diff: this.docbotPreviewData.diff,
      commitMsg: this.docbotPreviewData.commit_msg,
      filename: this.docbotPreviewData.filename,
      context: this.context,
      onClose: () => {
        dialogContainer.innerHTML = '';
      },
      onSuccess: () => {
        this.docbotState = {
          status: 'none',
          taskId: null,
        };
        this.docbotPreviewData = null;
        this.updateHeader();
      }
    };

    new DocBotDialog(dialogContainer, props);
  }

  private registerActions() {
    this.context.actionRegistry.register('edit_pipeline', async () => {
      if (!this.pipeline) return;
      const dialog = new PipelineEditDialog({
        pipeline: this.pipeline,
        pipelineId: this.pipelineId,
        context: this.context
      });
      await dialog.show();
      // After dialog closes, we might want to refresh the header if it was updated
      // The dialog itself calls update on the client, and we'll get a websocket update 
      // or we can refresh manually if needed.
    });

    this.context.actionRegistry.register('trigger_reviewbot', async (_e, el) => {
      const taskId = el.getAttribute('data-task-id');
      if (!taskId) return;

      try {
        await this.context.reviewBotClient.trigger(this.pipelineId, taskId);

        this.reviewbotState = { status: 'inProgress', taskId };
        this.updateHeader();
      } catch (error) {
        console.error('Trigger ReviewBot error:', error);
        alert('Failed to trigger ReviewBot');
      }
    });

    this.context.actionRegistry.register('trigger_archbot', async (_e, el) => {
      const taskId = el.getAttribute('data-task-id');
      if (!taskId) return;

      try {
        await this.context.archBotClient.trigger(this.pipelineId, taskId);
        this.archbotState = { status: 'inProgress', taskId };
        this.updateHeader();
      } catch (error) {
        console.error('Trigger ArchBot error:', error);
        alert('Failed to trigger ArchitectureBot');
      }
    });

    this.context.actionRegistry.register('open_review_dialog', async (_e, el) => {
      const taskId = el.getAttribute('data-task-id');
      if (!taskId) return;

      this.pendingReviews = this.pendingReviews.filter(id => id !== taskId);
      this.updateHeader();

      const task = this.allLoadedTasks.find(t => t.id === taskId);
      if (!task) return;

      const dialog = new ReviewDialog({
        task,
        pipelineId: this.pipelineId,
        context: this.context,
        onDelete: () => {
          // Task will be updated via websocket
        }
      });
      await dialog.show();
    });

    this.context.actionRegistry.register('copy_pipeline_id', async (_e, el) => {
      try {
        await navigator.clipboard.writeText(this.pipelineId);
        const originalHtml = el.innerHTML;
        el.innerHTML = `<svg class="w-3 h-3 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
        setTimeout(() => {
          el.innerHTML = originalHtml;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy pipeline ID:', err);
      }
    });

    this.context.actionRegistry.register('copy_task_id', async (_e, el) => {
      const taskId = el.closest('[data-task-id]')?.getAttribute('data-task-id');
      if (!taskId) return;
      try {
        await navigator.clipboard.writeText(taskId);
        const originalHtml = el.innerHTML;
        el.innerHTML = `<svg class="w-3 h-3 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
        setTimeout(() => {
          el.innerHTML = originalHtml;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy task ID:', err);
      }
    });

    this.context.actionRegistry.register('open_gemini_logs', (e) => {
      e.preventDefault();
      const url = this.context.pipelineClient.getGeminiLogsStreamUrl(this.pipelineId);
      new LogViewerDialog(url, this.context.authService).show();
    });

    this.context.actionRegistry.register('open_vibe_logs', (e) => {
      e.preventDefault();
      const url = this.context.pipelineClient.getVibeLogsStreamUrl(this.pipelineId);
      new LogViewerDialog(url, this.context.authService).show();
    });

    this.context.actionRegistry.register('open_stats', () => {
      new StatsDialog(this.allLoadedTasks, this.pipelineId, this.context.pipelineClient).show();
    });

    this.context.actionRegistry.register('open_history', () => {
      new HistoryDialog(this.allLoadedTasks).show();
    });

    this.context.actionRegistry.register('change_sort_order', async (_e, el) => {
      this.currentSortOrder = (el as HTMLSelectElement).value as any;
      this.refreshTasks();
    });

    this.context.actionRegistry.register('create_task', async (_e, el) => {
      const form = el as HTMLFormElement;
      const titleInput = form.querySelector('input[name="task_title"]') as HTMLInputElement;
      const title = titleInput.value.trim();
      if (!title) return;

      try {
        await this.context.taskClient.create(this.pipelineId, title);
        titleInput.value = '';
        // UI refresh handled via WebSocket
      } catch (error) {
        alert('Failed to create task');
      }
    });

    this.context.actionRegistry.register('prev_completed_page', () => {
      if (this.completedTasksPage > 0) {
        this.completedTasksPage--;
        this.refreshCompletedTasks();
      }
    });

    this.context.actionRegistry.register('next_completed_page', () => {
      this.completedTasksPage++;
      this.refreshCompletedTasks();
    });

    this.context.actionRegistry.register('toggle_task_collapse', (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      if (!taskId) return;

      const body = el.closest('[data-view-id]')?.querySelector('.task-body');
      const icon = el.querySelector('svg.transform');
      if (!body || !icon) return;

      const isHidden = body.classList.toggle('hidden');
      icon.classList.toggle('rotate-90', !isHidden);

      if (isHidden) this.collapsedTasks.add(taskId);
      else this.collapsedTasks.delete(taskId);
    });

    this.context.actionRegistry.register('edit_title', async (_e, el) => {
      const container = el.closest('.title-container') as HTMLElement;
      if (!container) return;
      container.querySelector('.title-view')?.classList.add('hidden');
      container.querySelector('.title-edit')?.classList.remove('hidden');
      const input = container.querySelector('input');
      input?.focus();
      input?.select();
    });

    this.context.actionRegistry.register('cancel_title_edit', async (_e, el) => {
      const container = el.closest('.title-container') as HTMLElement;
      if (!container) return;
      container.querySelector('.title-view')?.classList.remove('hidden');
      container.querySelector('.title-edit')?.classList.add('hidden');
    });

    this.context.actionRegistry.register('save_title', async (_e, el) => {
      const container = el.closest('.title-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      const version = parseInt(container.getAttribute('data-version') || '1');
      const input = container.querySelector('input');
      if (!taskId || !input) return;

      const newTitle = input.value.trim();
      if (!newTitle) return;

      try {
        await this.context.taskClient.updateDetails(taskId, version, { title: newTitle });
        // WS will refresh
      } catch (error) {
        alert('Failed to save title');
      }
    });

    this.context.actionRegistry.register('edit_spec', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      container.querySelector('.spec-view')?.classList.add('hidden');
      container.querySelector('[data-action-click="toggle_spec_expand"]')?.classList.add('hidden');
      container.querySelector('.spec-edit')?.classList.remove('hidden');
      const textarea = container.querySelector('textarea');
      textarea?.focus();
    });

    this.context.actionRegistry.register('cancel_spec_edit', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      container.querySelector('.spec-view')?.classList.remove('hidden');
      container.querySelector('[data-action-click="toggle_spec_expand"]')?.classList.remove('hidden');
      container.querySelector('.spec-edit')?.classList.add('hidden');
    });

    this.context.actionRegistry.register('save_spec', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      const version = parseInt(container.getAttribute('data-version') || '1');
      const textarea = container.querySelector('textarea');
      const wantDesignCheck = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (!taskId || !textarea) return;

      const newSpec = textarea.value.trim();
      const wantDesignDoc = wantDesignCheck.checked;

      try {
        await this.context.taskClient.updateDetails(taskId, version, { spec: newSpec, want_design_doc: wantDesignDoc });
        // Ensure spec is expanded after save
        this.expandedSpecs.add(taskId);
        // WS will refresh
      } catch (error) {
        alert('Failed to save specification');
      }
    });

    this.context.actionRegistry.register('toggle_spec_expand', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      if (!taskId) return;

      const display = container.querySelector('.spec-display');
      if (!display) return;

      const isExpanded = display.classList.toggle('expanded');
      el.textContent = isExpanded ? 'Show Less' : 'Show More';

      if (isExpanded) {
        this.expandedSpecs.add(taskId);
      } else {
        this.expandedSpecs.delete(taskId);
      }
    });

    this.context.actionRegistry.register('view_design_doc', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      if (!taskId) return;
      const task = this.allLoadedTasks.find(t => t.id === taskId);
      if (task && task.design_doc) {
        new DesignDocDialog('Design Document', task.design_doc).show();
      }
    });

    this.context.actionRegistry.register('view_design_doc_history', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      if (!taskId) return;
      const task = this.allLoadedTasks.find(t => t.id === taskId);
      if (task) {
        new DesignDocDiffDialog(this.context, task).show();
      }
    });

    this.context.actionRegistry.register('edit_design_doc', async (_e, el) => {
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

      this.activeEditors.set(taskId, editor);
      editor.codemirror.focus();
    });

    this.context.actionRegistry.register('toggle_edit_design_doc_expand', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;

      const cm = container.querySelector('.CodeMirror');
      if (!cm) return;

      const isExpanded = cm.classList.toggle('expanded-editor');
      el.textContent = isExpanded ? 'Show Less' : 'Show More';
    });

    this.context.actionRegistry.register('toggle_design_doc_expand', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;

      const display = container.querySelector('.design-doc-display');
      if (!display) return;

      const isExpanded = display.classList.toggle('expanded');
      el.textContent = isExpanded ? 'Show Less' : 'Show More';
    });

    this.context.actionRegistry.register('copy_design_doc', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      if (!taskId) return;
      const task = this.allLoadedTasks.find(t => t.id === taskId);
      if (task && task.design_doc) {
        try {
          await navigator.clipboard.writeText(task.design_doc);
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

    this.context.actionRegistry.register('cancel_design_doc', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;

      const taskId = container.getAttribute('data-task-id');
      if (taskId) {
        const editor = this.activeEditors.get(taskId);
        if (editor) {
          editor.toTextArea();
          this.activeEditors.delete(taskId);
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

    this.context.actionRegistry.register('save_design_doc', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;

      const taskId = container.getAttribute('data-task-id');
      const version = parseInt(container.getAttribute('data-version') || '1');
      if (!taskId) return;

      const editor = this.activeEditors.get(taskId);
      if (!editor) return;

      const designDoc = editor.value().trim();

      try {
        await this.context.taskClient.updateDetails(taskId, version, { design_doc: designDoc });
        // After success, destroy editor
        editor.toTextArea();
        this.activeEditors.delete(taskId);
        // UI refresh will be triggered by WebSocket message TASK_UPDATED
      } catch (error) {
        alert('Failed to save design doc. Please try again.');
      }
    });

    this.context.actionRegistry.register('accept_design', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      if (!taskId) return;

      try {
        await this.context.taskClient.acceptDesign(taskId, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to accept design');
      }
    });

    this.context.actionRegistry.register('reject_design', async (_e, el) => {
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
        await this.context.taskClient.rejectDesign(taskId, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to reject design');
      }
    });

    this.context.actionRegistry.register('schedule_task', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      if (!taskId) return;

      try {
        await this.context.taskClient.updateStatus(taskId, TaskStatus.SCHEDULED, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to schedule task');
      }
    });

    this.context.actionRegistry.register('unschedule_task', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      if (!taskId) return;

      try {
        await this.context.taskClient.updateStatus(taskId, TaskStatus.CREATED, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to unschedule task');
      }
    });

    this.context.actionRegistry.register('cancel_progress', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      if (!taskId) return;

      try {
        await this.context.taskClient.updateStatus(taskId, TaskStatus.SCHEDULED, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to cancel progress');
      }
    });

    this.context.actionRegistry.register('move_task_up', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      const currentOrder = parseInt(el.getAttribute('data-order') || '0');
      if (!taskId) return;

      try {
        await this.context.taskClient.updateDetails(taskId, version, { order: currentOrder - 1 });
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to move task');
      }
    });

    this.context.actionRegistry.register('move_task_down', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      const currentOrder = parseInt(el.getAttribute('data-order') || '0');
      if (!taskId) return;

      try {
        await this.context.taskClient.updateDetails(taskId, version, { order: currentOrder + 1 });
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to move task');
      }
    });

    this.context.actionRegistry.register('fail_task', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      if (!taskId) return;

      const confirmed = await new ConfirmationDialog(
        'Mark Task as Failed',
        'Are you sure you want to mark this task as FAILED? This may trigger an automated fix sequence.',
        'Mark Failed'
      ).show();

      if (!confirmed) return;

      try {
        await this.context.taskClient.updateStatus(taskId, TaskStatus.FAILED, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to update task');
      }
    });

    this.context.actionRegistry.register('delete_task', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      if (!taskId) return;

      const confirmed = await new ConfirmationDialog(
        'Delete Task',
        'Are you sure you want to delete this task? This action cannot be undone.',
        'Delete'
      ).show();

      if (!confirmed) return;

      try {
        await this.context.taskClient.delete(taskId);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to delete task');
      }
    });

    this.context.actionRegistry.register('trigger_docbot', async (_e, el) => {
      const taskId = el.dataset.taskId;
      if (!taskId) return;

      const btn = el as HTMLElement;
      btn.classList.add('animate-pulse', 'text-green-500');

      try {
        await this.context.docBotClient.triggerDocBot(this.pipelineId, taskId);
        // Remove pulse after a short delay
        setTimeout(() => btn.classList.remove('animate-pulse', 'text-green-500'), 1000);
      } catch (err) {
        console.error('Failed to trigger DocBot:', err);
        btn.classList.remove('animate-pulse', 'text-green-500');
        btn.classList.add('text-red-500');
        setTimeout(() => btn.classList.remove('text-red-500'), 2000);
      }
    });

    this.context.actionRegistry.register('open_quickfix', async (_e, el) => {
      const taskId = el.dataset.taskId;
      if (!taskId) return;

      const btn = el as HTMLElement;
      btn.classList.add('animate-pulse', 'text-app-accent-2');

      try {
        await this.context.editorClient.quickfix(taskId);
        setTimeout(() => btn.classList.remove('animate-pulse', 'text-app-accent-2'), 1000);
      } catch (err) {
        console.error('Failed to open quickfix:', err);
        btn.classList.remove('animate-pulse', 'text-app-accent-2');
        btn.classList.add('text-red-500');
        setTimeout(() => btn.classList.remove('text-red-500'), 2000);
      }
    });

    this.context.actionRegistry.register('open_diff_view', async (_e, el) => {
      const commitHash = el.dataset.commitHash;
      if (!commitHash) return;

      const btn = el as HTMLElement;
      btn.classList.add('animate-pulse', 'text-app-accent-2');

      try {
        await this.context.editorClient.diffViewOpen(this.pipelineId, commitHash);
        setTimeout(() => btn.classList.remove('animate-pulse', 'text-app-accent-2'), 1000);
      } catch (err) {
        console.error('Failed to open diff view:', err);
        btn.classList.remove('animate-pulse', 'text-app-accent-2');
        btn.classList.add('text-red-500');
        setTimeout(() => btn.classList.remove('text-red-500'), 2000);
      }
    });
    this.context.actionRegistry.register('open_docbot_dialog', () => {
      this.openDocBotDialog();
    });

    this.context.actionRegistry.register('dismiss_docbot_banner', () => {
      this.docbotState = { status: 'none', taskId: null };
      this.docbotPreviewData = null;
      this.updateHeader();
    });

    this.context.actionRegistry.register('refresh_git_status', async (_e, el) => {
      const btn = el as HTMLElement;
      btn.classList.add('animate-pulse', 'border-app-accent-2');
      try {
        this.scheduleRefreshGitStatus();
      } finally {
        setTimeout(() => btn.classList.remove('animate-pulse', 'border-app-accent-2'), 500);
      }
    });

    this.context.actionRegistry.register('toggle_layout', () => {
      this.isTwoColumnLayout = !this.isTwoColumnLayout;
      localStorage.setItem('pipeline-layout', this.isTwoColumnLayout ? '2-col' : '3-col');
      this.reRenderAll();
    });
  }

  private reRenderAll() {
    if (!this.container) return;
    this.container.innerHTML = this.render() as string;
    this.updateHeader();
    this.refreshTasks();
    this.checkOllama();
  }

  async loadPipeline() {
    try {
      this.pipeline = await this.context.pipelineClient.get(this.pipelineId);
      if (this.pipeline) {
        this.context.dataManager.updatePipeline(this.pipeline);
      }
      this.geminiStatus = await this.context.pipelineClient.getGeminiStatus(this.pipelineId);
      this.vibeStatus = await this.context.pipelineClient.getVibeStatus(this.pipelineId);
      this.scheduleRefreshGitStatus();
      this.updateHeader();
    } catch (error) {
      console.error('Error loading pipeline:', error);
    }
  }

  private scheduleRefreshGitStatus() {
    if (this.gitStatusRefreshInProgress) {
      this.gitStatusRefreshPending = true;
      return;
    }
    if (this.gitStatusRefreshTimer) {
      return; // Already scheduled
    }
    this.gitStatusRefreshTimer = setTimeout(() => {
      this.gitStatusRefreshTimer = null;
      this.refreshGitStatusInternal();
    }, 500);
  }

  private async refreshGitStatusInternal() {
    this.gitStatusRefreshInProgress = true;
    try {
      this.gitStatus = await this.context.systemClient.getGitStatus(this.pipelineId);
      this.updateHeader();
    } catch (error) {
      console.error('Failed to refresh git status:', error);
    } finally {
      this.gitStatusRefreshInProgress = false;
      if (this.gitStatusRefreshPending) {
        this.gitStatusRefreshPending = false;
        this.scheduleRefreshGitStatus();
      }
    }
  }

  async refreshTasks() {
    if (!this.container) return;
    const prepContainer = this.container.querySelector('#col-prep');
    const activeContainer = this.container.querySelector('#col-active');
    const historyContainer = this.container.querySelector('#col-history');
    const completedCountEl = this.container.querySelector('#completed-count');

    if (!prepContainer || !activeContainer || !historyContainer) return;

    try {
      this.allLoadedTasks = await this.context.taskClient.listByPipeline(this.pipelineId, true);

      // Update DataManager cache
      this.allLoadedTasks.forEach(task => this.context.dataManager.updateTask(task));

      this.updateHeader();
      const allTasks = this.allLoadedTasks;

      // Handle default task collapsing on first load
      if (this.isFirstLoad && allTasks.length > 0) {
        allTasks.forEach(t => {
          if (t.status !== TaskStatus.INPROGRESS && t.status !== TaskStatus.PROPOSED) {
            this.collapsedTasks.add(t.id!);
          }
        });
        this.isFirstLoad = false;
      }

      const proposedTasks = allTasks.filter(t => !t.deleted && t.status === TaskStatus.PROPOSED);
      const createdTasks = allTasks.filter(t => !t.deleted && t.status === TaskStatus.CREATED);

      const inProgressTasks = allTasks.filter(t => !t.deleted && t.status === TaskStatus.INPROGRESS);
      const scheduledTasks = allTasks.filter(t => !t.deleted && t.status === TaskStatus.SCHEDULED);
      const failedTasks = allTasks.filter(t => !t.deleted && t.status === TaskStatus.FAILED);

      const completedTasks = allTasks.filter(t => !t.deleted && ([TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED] as any[]).includes(t.status));

      // Sort columns
      proposedTasks.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());

      createdTasks.sort((a, b) => this.taskSortFn(a, b));
      inProgressTasks.sort((a, b) => this.taskSortFn(a, b));
      scheduledTasks.sort((a, b) => this.taskSortFn(a, b));
      failedTasks.sort((a, b) => this.taskSortFn(a, b));

      // 1. Render Preparation Column
      prepContainer.innerHTML = `
        ${TaskColumn.render({
        id: 'proposed',
        title: 'Proposed',
        tasks: proposedTasks,
        emptyMessage: 'No proposed designs.',
        collapsedTasks: this.collapsedTasks,
        badge: { text: 'Review', class: 'bg-purple-500/20 text-purple-400 border border-purple-500/30' }
      })}
        ${TaskColumn.render({
        id: 'backlog',
        title: 'Backlog',
        tasks: createdTasks,
        emptyMessage: 'Backlog is empty.',
        showOrdering: this.currentSortOrder === 'execution',
        collapsedTasks: this.collapsedTasks
      })}
      `;

      // 2. Render Active Column
      activeContainer.innerHTML = `
        ${TaskColumn.render({
        id: 'inprogress',
        title: 'In Progress',
        tasks: inProgressTasks,
        emptyMessage: 'No active work.',
        collapsedTasks: this.collapsedTasks,
        badge: { text: 'Running', class: 'bg-amber-500/20 text-amber-400 border-amber-500/30' }
      })}
        ${TaskColumn.render({
        id: 'failed',
        title: 'Failed',
        tasks: failedTasks,
        emptyMessage: '',
        collapsedTasks: this.collapsedTasks,
        badge: { text: 'Attention', class: 'bg-red-500/20 text-red-400 border-red-500/30' }
      })}
        ${TaskColumn.render({
        id: 'scheduled',
        title: 'Queue',
        tasks: scheduledTasks,
        emptyMessage: 'Nothing scheduled.',
        showOrdering: this.currentSortOrder === 'execution',
        collapsedTasks: this.collapsedTasks
      })}
      `;

      // Remove empty failed section if no failed tasks
      if (failedTasks.length === 0) {
        activeContainer.querySelector('#failed-section')?.remove();
      }

      // 3. Render History Column
      // Sort completed tasks by completion time (updated_at)
      completedTasks.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());

      historyContainer.innerHTML = `
        <div class="bg-app-bg/50 p-6 rounded-3xl border border-app-border/50 shadow-sm mb-4">
          <h3 class="text-sm font-black text-app-muted uppercase tracking-widest mb-6 px-1">Pipeline Health</h3>
          ${PipelineStatsView.render(allTasks, undefined, true)}
        </div>
        ${CompletedSection.render({
        lastCompleted: completedTasks.length > 0 ? completedTasks[0] : null,
        totalCompletedCount: completedTasks.length,
        collapsedTasks: this.collapsedTasks
      })}
      `;

      if (completedTasks.length > 0) {
        this.refreshCompletedTasks();
      }

      PipelineStatsView.animateBars(historyContainer as HTMLElement);

      if (completedCountEl) {
        completedCountEl.textContent = `(${completedTasks.length})`;
      }
    } catch (error) {
      prepContainer.innerHTML = '<p class="text-red-400">Error loading tasks.</p>';
      console.error('Error refreshing tasks:', error);
    }
  }

  async refreshCompletedTasks() {
    if (!this.container) return;
    const completedContainer = this.container.querySelector('#completed-task-list');
    const paginationContainer = this.container.querySelector('#completed-pagination');
    if (!completedContainer) return;

    try {
      const { tasks, total_count } = await this.context.taskClient.listCompletedByPipeline(
        this.pipelineId,
        this.completedTasksPage,
        this.completedPageSize
      );

      completedContainer.innerHTML = tasks.length > 0
        ? tasks.map(t => TaskItem.render(t, false, false, this.collapsedTasks.has(t.id!), false, this.expandedSpecs.has(t.id!))).join('')
        : '<p class="text-app-muted italic text-xs">No older completed tasks.</p>';

      if (paginationContainer) {
        paginationContainer.innerHTML = PaginationControl.render({
          currentPage: this.completedTasksPage,
          pageSize: this.completedPageSize,
          totalCount: total_count,
          prevAction: 'prev_completed_page',
          nextAction: 'next_completed_page'
        });
      }
    } catch (error) {
      console.error('Error refreshing completed tasks:', error);
    }
  }

  private updateHeader() {
    if (!this.container) return;
    const headerContainer = this.container.querySelector('#pipeline-header-container');
    if (headerContainer) {
      headerContainer.innerHTML = this.renderHeader();
    }
  }

  private renderHeader(): string {
    if (!this.pipeline) {
      return `
        <header class="flex justify-between items-center bg-app-surface p-6 rounded-2xl shadow-lg border border-app-border shrink-0">
          <div class="flex gap-6 items-center">
            <button onclick="window.location.hash = '#'" class="p-3 hover:bg-app-bg rounded-xl transition-all text-app-muted hover:text-app-accent-1 border border-transparent hover:border-app-border group cursor-pointer" title="Back to Dashboard">
              <svg class="w-6 h-6 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
              </svg>
            </button>
            <div class="min-w-[400px]">
              <h2 class="text-3xl font-black text-app-accent-1 tracking-tight">Loading...</h2>
            </div>
          </div>
        </header>
      `;
    }
    return PipelineHeaderView.render({
      pipeline: this.pipeline!,
      pipelineId: this.pipelineId,
      geminiStatus: this.geminiStatus,
      vibeStatus: this.vibeStatus,
      docbotState: this.docbotState,
      reviewbotState: this.reviewbotState,
      archbotState: this.archbotState,
      user: this.context.authService.getUser(),
      allTasks: this.allLoadedTasks,
      gitStatus: this.gitStatus,
      isTwoColumnLayout: this.isTwoColumnLayout,
      pendingReviews: this.pendingReviews,
    });

  }

  private renderPrepColumn(): string {
    return `
      <div class="flex flex-col gap-8 min-w-0 ${this.isTwoColumnLayout ? '' : 'lg:min-w-[350px]'}">
        <div class="bg-app-surface/30 p-6 rounded-3xl border border-app-border/30 flex flex-col">
          ${TaskForm.render()}
          <div id="col-prep" class="space-y-10">
            <!-- Proposed and Created tasks will be rendered here -->
            <p class="text-app-muted animate-pulse text-center py-10">Loading backlog...</p>
          </div>
        </div>
      </div>
    `;
  }

  private renderActiveColumn(): string {
    return `
      <div class="flex flex-col gap-8 min-w-0 ${this.isTwoColumnLayout ? '' : 'lg:min-w-[350px]'}">
        <div class="bg-app-surface/30 p-6 rounded-3xl border border-app-border/30 flex flex-col">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 px-1">
            <h3 class="text-xl font-black text-app-accent-1 uppercase tracking-tighter shrink-0">Execution Engine</h3>
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <select data-action-change="change_sort_order" class="w-full sm:w-auto bg-app-bg border border-app-border rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 cursor-pointer">
                <option value="execution" ${this.currentSortOrder === 'execution' ? 'selected' : ''}>Execution Order</option>
                <option value="newest" ${this.currentSortOrder === 'newest' ? 'selected' : ''}>Newest First</option>
                <option value="status" ${this.currentSortOrder === 'status' ? 'selected' : ''}>By Status</option>
              </select>
            </div>
          </div>
          <div id="col-active" class="space-y-10">
            <!-- In Progress and Scheduled tasks will be rendered here -->
            <p class="text-app-muted animate-pulse text-center py-10">Loading execution queue...</p>
          </div>
        </div>
      </div>
    `;
  }

  private renderHistoryColumn(): string {
    return `
      <div class="flex flex-col gap-8 min-w-0 ${this.isTwoColumnLayout ? '' : 'lg:min-w-[350px]'}">
        <div class="bg-app-surface/30 p-6 rounded-3xl border border-app-border/30 flex flex-col">
          <div id="col-history" class="space-y-8">
            <!-- Stats and Completed tasks will be rendered here -->
            <p class="text-app-muted animate-pulse text-center py-10">Loading history...</p>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    return `
      <div class="max-w-[1800px] mx-auto px-6 py-8 flex flex-col gap-8 min-h-screen">
        <div id="pipeline-header-container">
          ${this.renderHeader()}
        </div>

        <div class="grid grid-cols-1 ${this.isTwoColumnLayout ? 'lg:grid-cols-2' : 'lg:grid-cols-3'} gap-8 items-start flex-grow w-full">
          <!-- Column 1: Preparation & Review -->
          ${this.renderPrepColumn()}

          ${this.isTwoColumnLayout ?
        `
            <!-- Column 2: Merged Active and History for 2-col layout -->
            <div class="flex flex-col gap-8 min-w-0">
               ${this.renderActiveColumn()}
               ${this.renderHistoryColumn()}
            </div>
            ` :
        `
            <!-- Column 2: Active Execution -->
            ${this.renderActiveColumn()}
            <!-- Column 3: History & Analytics -->
            ${this.renderHistoryColumn()}
            `
      }
        </div>
      </div>
      <div id="docbot-dialog-container"></div>
    `;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.loadPipeline();
    this.refreshTasks();
    this.checkOllama();
  }

  private async checkOllama() {
    if (!this.container) return;
    const isAvailable = await this.context.systemClient.isOllamaAvailable();
    if (!isAvailable) {
      this.container.querySelector('[data-action-click="toggle_assistant"]')?.classList.add('hidden');
    }
  }

  unmount() {
    this.activeEditors.forEach(editor => editor.toTextArea());
    this.activeEditors.clear();
    this.unsubs.forEach(unsub => unsub());
    this.unsubs = [];
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  private taskSortFn(a: Task, b: Task): number {
    if (this.currentSortOrder === 'execution') {
      return a.order - b.order;
    } else if (this.currentSortOrder === 'newest') {
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    } else {
      return a.status.localeCompare(b.status);
    }
  }

  private insertTaskIntoDOM(task: Task) {
    if (!this.container) return;
    const columnId = this.getTaskColumnId(task);
    const list = this.container.querySelector(`#${columnId}`);
    if (!list) return;

    this.removeEmptyMessage(columnId);

    // If moving to last-completed-task, push the current one to history feed
    if (columnId === 'last-completed-task') {
      const existingLastTaskEl = list.firstElementChild as HTMLElement;
      if (existingLastTaskEl && existingLastTaskEl.getAttribute('data-view-id')) {
        const historyFeed = this.container.querySelector('#completed-task-list');
        if (historyFeed) {
          this.removeEmptyMessage('completed-task-list');
          const oldTaskId = existingLastTaskEl.getAttribute('data-view-id');
          const oldTask = this.allLoadedTasks.find(t => t.id === oldTaskId);
          if (oldTask) {
            // Re-render for history feed (without expanded history)
            const historyHtml = TaskItem.render(oldTask, false, false, this.collapsedTasks.has(oldTask.id!), false, this.expandedSpecs.has(oldTask.id!));
            const temp = document.createElement('div');
            temp.innerHTML = historyHtml;
            historyFeed.prepend(temp.firstElementChild as HTMLElement);
          }
          existingLastTaskEl.remove();
        }
      }
    }

    const taskHtml = TaskItem.render(
      task,
      columnId === 'backlog-list' || columnId === 'scheduled-list',
      columnId === 'last-completed-task',
      this.collapsedTasks.has(task.id!),
      false,
      this.expandedSpecs.has(task.id!)
    );
    const temp = document.createElement('div');
    temp.innerHTML = taskHtml;
    const taskEl = temp.firstElementChild as HTMLElement;

    // Simple insertion (at top for now, refreshTasks will handle proper sorting later)
    list.prepend(taskEl);
    this.updateColumnHeaderCount(columnId);
  }

  private removeTaskFromDOM(taskId: string) {
    const el = this.container?.querySelector(`[data-view-id="${taskId}"]`);
    if (el) {
      const columnId = el.parentElement?.id;
      el.remove();
      if (columnId) {
        this.updateColumnHeaderCount(columnId);
        this.ensureEmptyMessage(columnId);
      }
    }
  }

  private updateSingleTask(task: Task) {
    const taskId = task.id;
    const el = this.container?.querySelector(`[data-view-id="${taskId}"]`);

    // Update local cache
    const index = this.allLoadedTasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      this.allLoadedTasks[index] = task;
    } else {
      this.allLoadedTasks.push(task);
    }
    this.updateHeader();

    if (el) {
      const currentColumnId = el.parentElement?.id;
      const targetColumnId = this.getTaskColumnId(task);

      if (currentColumnId === targetColumnId) {
        // Just update content
        const taskHtml = TaskItem.render(
          task,
          targetColumnId === 'backlog-list' || targetColumnId === 'scheduled-list',
          targetColumnId === 'last-completed-task',
          this.collapsedTasks.has(task.id!),
          false,
          this.expandedSpecs.has(task.id!)
        );
        const temp = document.createElement('div');
        temp.innerHTML = taskHtml;
        el.replaceWith(temp.firstElementChild as HTMLElement);
      } else {
        // Move to different column
        el.remove();
        if (currentColumnId) {
          this.updateColumnHeaderCount(currentColumnId);
          this.ensureEmptyMessage(currentColumnId);
        }
        this.insertTaskIntoDOM(task);
      }
    } else {
      // New task or was hidden
      this.insertTaskIntoDOM(task);
    }
  }
}
