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
import { Pipeline, TaskStatus, Task, PipelineStatus } from '../../core/domain.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.ts';
import { TaskItem } from '../components/TaskItem.ts';
import { HistoryDialog } from '../components/HistoryDialog.ts';
import { StatsDialog } from '../components/StatsDialog.ts';
import { TaskForm } from '../components/TaskForm.ts';
import { DesignDocDialog } from '../components/DesignDocDialog.ts';
import { TaskColumn } from '../components/TaskColumn.ts';
import { CompletedSection } from '../components/CompletedSection.ts';
import { PipelineStatsView } from '../components/PipelineStatsView.ts';
import { PaginationControl } from '../components/PaginationControl.ts';
import { LogViewerDialog } from '../components/LogViewerDialog.ts';
import EasyMDE from 'easymde';

export class PipelineDetailView extends View {
  private container: HTMLElement | null = null;
  private pipelineId: string;
  private pipeline: Pipeline | null = null;
  private geminiStatus: { running: boolean, log_file: string | null, available: boolean } = { running: false, log_file: null, available: true };
  private vibeStatus: { running: boolean, log_file: string | null, available: boolean } = { running: false, log_file: null, available: true };
  private context: AppContext;
  private unsubs: (() => void)[] = [];
  private activeEditors: Map<string, EasyMDE> = new Map();
  private currentSortOrder: 'execution' | 'newest' | 'status' = 'execution';
  private allLoadedTasks: Task[] = [];
  private collapsedTasks: Set<string> = new Set();
  private isFirstLoad: boolean = true;
  private completedTasksPage: number = 0;
  private completedPageSize: number = 5;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

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
    this.setupWebSocket();
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
    const list = this.container.querySelector(`#${columnId}-list`);
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
    const list = this.container?.querySelector(`#${columnId}-list`);
    if (!list) return;
    if (list.children.length === 0) {
      const meta = this.columnMetadata[columnId];
      if (meta && meta.emptyMessage) {
        list.innerHTML = `<p class="text-app-muted italic text-sm py-4 text-center border-2 border-dashed border-app-border/30 rounded-xl">${meta.emptyMessage}</p>`;
      }
    }
  }

  private removeEmptyMessage(columnId: string) {
    const list = this.container?.querySelector(`#${columnId}-list`);
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

  private setupWebSocket() {
    const handleUpdate = (message: any) => {
      // Refresh if the updated task belongs to this pipeline
      if (message.payload?.pipeline_id === this.pipelineId) {
        this.updateSingleTask(new Task(message.payload));
      }
    };

    const handleCreate = (message: any) => {
      if (message.payload?.pipeline_id === this.pipelineId) {
        const task = new Task(message.payload);
        const taskId = task.id;
        // Only append if it doesn't exist yet
        if (this.container?.querySelector(`[data-view-id="${taskId}"]`)) return;
        
        // Update local cache
        const index = this.allLoadedTasks.findIndex(t => t.id === taskId);
        if (index === -1) {
          this.allLoadedTasks.push(task);
        }
        
        this.insertTaskIntoDOM(task);
      }
    };

    this.unsubs.push(this.context.wsClient.on('PIPELINE_UPDATED', (message: any) => {
      if (message.payload?.id === this.pipelineId || message.payload?._id === this.pipelineId) {
        this.pipeline = new Pipeline(message.payload);
        this.updateHeader();
      }
    }));
    this.unsubs.push(this.context.wsClient.on('TASK_CREATED', handleCreate));
    this.unsubs.push(this.context.wsClient.on('TASK_UPDATED', handleUpdate));
    this.unsubs.push(this.context.wsClient.on('TASK_STATUS_UPDATED', handleUpdate));
    this.unsubs.push(this.context.wsClient.on('TASK_COMPLETED', handleUpdate));
    this.unsubs.push(this.context.wsClient.on('TASK_DELETED', (message: any) => {
      if (message.payload?.pipeline_id === this.pipelineId) {
        const taskId = message.payload.task_id;
        // Update local cache
        this.allLoadedTasks = this.allLoadedTasks.filter(t => t.id !== taskId);
        this.removeTaskFromDOM(taskId);
      }
    }));
    this.unsubs.push(this.context.wsClient.on('GEMINI_PROCESS_STARTED', (message: any) => {
      if (message.payload?.pipeline_id === this.pipelineId) {
        this.geminiStatus.running = true;
        this.updateHeader();
      }
    }));
    this.unsubs.push(this.context.wsClient.on('GEMINI_PROCESS_STOPPED', (message: any) => {
      if (message.payload?.pipeline_id === this.pipelineId) {
        this.geminiStatus.running = false;
        this.updateHeader();
      }
    }));
    this.unsubs.push(this.context.wsClient.on('VIBE_PROCESS_STARTED', (message: any) => {
      if (message.payload?.pipeline_id === this.pipelineId) {
        this.vibeStatus.running = true;
        this.updateHeader();
      }
    }));
    this.unsubs.push(this.context.wsClient.on('VIBE_PROCESS_STOPPED', (message: any) => {
      if (message.payload?.pipeline_id === this.pipelineId) {
        this.vibeStatus.running = false;
        this.updateHeader();
      }
    }));
  }

  private registerActions() {
    this.context.actionRegistry.register('edit_pipeline', () => {
      this.container?.querySelector('#pipeline-view-info')?.classList.add('hidden');
      this.container?.querySelector('#pipeline-edit-info')?.classList.remove('hidden');
    });

    this.context.actionRegistry.register('cancel_edit_pipeline', () => {
      this.container?.querySelector('#pipeline-view-info')?.classList.remove('hidden');
      this.container?.querySelector('#pipeline-edit-info')?.classList.add('hidden');
    });

    this.context.actionRegistry.register('save_pipeline', async () => {
      const editInfo = this.container?.querySelector('#pipeline-edit-info');
      if (!editInfo || !this.pipeline) return;

      const nameInput = editInfo.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      const statusSelect = editInfo.querySelector('select[name="pipeline_status"]') as HTMLSelectElement;
      const workspaceInput = editInfo.querySelector('input[name="workspace_path"]') as HTMLInputElement;
      const geminiCheck = editInfo.querySelector('input[name="manage_gemini"]') as HTMLInputElement;
      const vibeCheck = editInfo.querySelector('input[name="manage_vibe"]') as HTMLInputElement;

      try {
        await this.context.pipelineClient.update(this.pipelineId, this.pipeline.version, {
          name: nameInput.value.trim(),
          status: statusSelect.value as PipelineStatus,
          workspace_path: workspaceInput.value.trim() || undefined,
          manage_gemini: geminiCheck.checked,
          manage_vibe: vibeCheck.checked
        });
        this.container?.querySelector('#pipeline-view-info')?.classList.remove('hidden');
        this.container?.querySelector('#pipeline-edit-info')?.classList.add('hidden');
      } catch (error) {
        alert('Failed to update pipeline');
      }
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
        // WS will refresh
      } catch (error) {
        alert('Failed to save specification');
      }
    });

    this.context.actionRegistry.register('toggle_spec_expand', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      
      const display = container.querySelector('.spec-display');
      if (!display) return;

      const isExpanded = display.classList.toggle('expanded');
      el.textContent = isExpanded ? 'Show Less' : 'Show More';
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

    this.context.actionRegistry.register('edit_design_doc', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;
      
      const taskId = container.getAttribute('data-task-id');
      const textarea = container.querySelector('textarea');
      if (!taskId || !textarea) return;

      container.querySelector('.design-doc-view')?.classList.add('hidden');
      container.querySelector('[data-action-click="toggle_design_doc_expand"]')?.classList.add('hidden');
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
      container.querySelector('[data-action-click="toggle_design_doc_expand"]')?.classList.remove('hidden');
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
  }

  async loadPipeline() {
    try {
      this.pipeline = await this.context.pipelineClient.get(this.pipelineId);
      this.geminiStatus = await this.context.pipelineClient.getGeminiStatus(this.pipelineId);
      this.vibeStatus = await this.context.pipelineClient.getVibeStatus(this.pipelineId);
      this.updateHeader();
    } catch (error) {
      console.error('Error loading pipeline:', error);
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
      this.updateHeaderStats();
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
        ? tasks.map(t => TaskItem.render(t, false, false, this.collapsedTasks.has(t.id!))).join('')
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
    if (!this.container || !this.pipeline) return;
    const infoContainer = this.container.querySelector('#pipeline-info-container');
    if (!infoContainer) return;

    const statusColors: Record<string, string> = {
      'active': 'bg-green-600/20 text-green-400 border-green-600/30',
      'paused': 'bg-amber-600/20 text-amber-400 border-amber-600/30',
      'completed': 'bg-blue-600/20 text-blue-400 border-blue-600/30'
    };

    const geminiStatusHtml = !this.geminiStatus.available ? "" : (this.geminiStatus.running 
      ? `
        <div class="flex items-center gap-2 bg-app-bg px-2 py-1 rounded border border-green-500/30">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span class="text-[10px] font-bold uppercase tracking-widest text-green-400">Gemini Running</span>
          <button data-action-click="open_gemini_logs" class="text-[9px] font-black uppercase tracking-tighter text-app-accent-2 hover:underline cursor-pointer ml-1">View Logs</button>
        </div>
      `
      : `
        <div class="flex items-center gap-2 bg-app-bg px-2 py-1 rounded border border-app-border opacity-60 hover:opacity-100 transition-opacity">
          <span class="h-2 w-2 rounded-full bg-app-muted"></span>
          <span class="text-[10px] font-bold uppercase tracking-widest text-app-muted">Gemini Idle</span>
          <button data-action-click="open_gemini_logs" class="text-[9px] font-black uppercase tracking-tighter text-app-muted hover:text-app-text cursor-pointer ml-1">Logs</button>
        </div>
      `);

    const vibeStatusHtml = !this.vibeStatus.available ? "" : (this.vibeStatus.running 
      ? `
        <div class="flex items-center gap-2 bg-app-bg px-2 py-1 rounded border border-blue-500/30">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span class="text-[10px] font-bold uppercase tracking-widest text-blue-400">Vibe Running</span>
          <button data-action-click="open_vibe_logs" class="text-[9px] font-black uppercase tracking-tighter text-app-accent-2 hover:underline cursor-pointer ml-1">View Logs</button>
        </div>
      `
      : `
        <div class="flex items-center gap-2 bg-app-bg px-2 py-1 rounded border border-app-border opacity-60 hover:opacity-100 transition-opacity">
          <span class="h-2 w-2 rounded-full bg-app-muted"></span>
          <span class="text-[10px] font-bold uppercase tracking-widest text-app-muted">Vibe Idle</span>
          <button data-action-click="open_vibe_logs" class="text-[9px] font-black uppercase tracking-tighter text-app-muted hover:text-app-text cursor-pointer ml-1">Logs</button>
        </div>
      `);

    infoContainer.innerHTML = `
      <div id="pipeline-view-info" class="flex flex-col group relative">
        <div class="flex items-center gap-3">
          <h2 id="pipeline-title" class="text-3xl font-black text-app-accent-1 tracking-tight">${this.pipeline.name}</h2>
          <span class="text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${statusColors[this.pipeline.status] || 'bg-slate-600/20 text-slate-400 border-slate-600/30'}">
            ${this.pipeline.status}
          </span>
          ${geminiStatusHtml}
          ${vibeStatusHtml}
          <button data-action-click="edit_pipeline" class="opacity-0 group-hover:opacity-100 p-1 hover:bg-app-bg text-app-muted hover:text-app-accent-1 rounded transition-all cursor-pointer" title="Edit Pipeline">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-3 mt-2">
          <div class="flex items-center bg-app-bg rounded border border-app-border overflow-hidden">
            <p class="text-app-muted text-[10px] uppercase font-bold tracking-widest px-2 py-1">ID: ${this.pipelineId}</p>
            <button data-action-click="copy_pipeline_id" class="px-2 py-1 bg-app-surface border-l border-app-border text-app-muted hover:text-app-accent-2 transition-colors cursor-pointer group/copy" title="Copy ID">
               <svg class="w-3 h-3 group-hover/copy:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
            </button>
          </div>
          <p class="text-app-muted text-[10px] uppercase font-bold tracking-widest bg-app-bg px-2 py-1 rounded border border-app-border">Workspace: ${this.pipeline.workspace_path || 'Default'}</p>
          <div id="header-stats" class="flex flex-wrap gap-2 text-[10px] uppercase font-bold tracking-wider"></div>
        </div>
      </div>
      <div id="pipeline-edit-info" class="hidden flex flex-col gap-3 bg-app-bg/50 p-4 rounded-xl border border-app-accent-1/30">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Pipeline Name</label>
            <input type="text" name="pipeline_name" value="${this.pipeline.name}" class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1">
          </div>
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Status</label>
            <select name="pipeline_status" class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 cursor-pointer">
              <option value="active" ${this.pipeline.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="paused" ${this.pipeline.status === 'paused' ? 'selected' : ''}>Paused</option>
              <option value="completed" ${this.pipeline.status === 'completed' ? 'selected' : ''}>Completed</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Workspace Path (Optional)</label>
          <input type="text" name="workspace_path" value="${this.pipeline.workspace_path || ''}" placeholder="Default Project Root" class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1">
        </div>
        <div class="flex items-center gap-2 mt-1 px-1">
          <input type="checkbox" name="manage_gemini" id="manage_gemini" ${this.pipeline.manage_gemini ? 'checked' : ''} class="w-4 h-4 rounded border-app-border bg-app-bg text-app-accent-1 focus:ring-app-accent-1 cursor-pointer">
          <label for="manage_gemini" class="text-[10px] font-bold uppercase tracking-wider text-app-text cursor-pointer">Manage Gemini CLI process</label>
        </div>
        <div class="flex items-center gap-2 mt-1 px-1">
          <input type="checkbox" name="manage_vibe" id="manage_vibe" ${this.pipeline.manage_vibe ? 'checked' : ''} class="w-4 h-4 rounded border-app-border bg-app-bg text-app-accent-1 focus:ring-app-accent-1 cursor-pointer">
          <label for="manage_vibe" class="text-[10px] font-bold uppercase tracking-wider text-app-text cursor-pointer">Manage Vibe CLI process</label>
        </div>
        <div class="flex gap-2 justify-end mt-1">
          <button data-action-click="cancel_edit_pipeline" class="px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest text-app-muted hover:bg-app-bg transition-all cursor-pointer">Cancel</button>
          <button data-action-click="save_pipeline" class="px-4 py-1 rounded bg-app-accent-1 text-white text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all shadow-md cursor-pointer">Save Changes</button>
        </div>
      </div>
    `;
    this.updateHeaderStats();
  }

  private updateHeaderStats() {
    if (!this.container) return;
    const statsContainer = this.container.querySelector('#header-stats');
    if (!statsContainer) return;

    const statusCounts: Record<string, number> = {
      [TaskStatus.CREATED]: 0,
      [TaskStatus.SCHEDULED]: 0,
      [TaskStatus.PROPOSED]: 0,
      [TaskStatus.INPROGRESS]: 0,
      [TaskStatus.IMPLEMENTED]: 0,
      [TaskStatus.FAILED]: 0,
      [TaskStatus.DISCARDED]: 0,
    };
    
    let total = 0;
    this.allLoadedTasks.forEach(t => {
      if (!t.deleted && statusCounts[t.status] !== undefined) {
        statusCounts[t.status]++;
        total++;
      }
    });

    if (total === 0) {
      statsContainer.innerHTML = '';
      return;
    }

    const colors: Record<string, string> = {
      [TaskStatus.CREATED]: 'bg-slate-500',
      [TaskStatus.SCHEDULED]: 'bg-blue-500',
      [TaskStatus.PROPOSED]: 'bg-purple-500',
      [TaskStatus.INPROGRESS]: 'bg-amber-500',
      [TaskStatus.IMPLEMENTED]: 'bg-green-500',
      [TaskStatus.FAILED]: 'bg-red-500',
      [TaskStatus.DISCARDED]: 'bg-slate-700',
    };

    statsContainer.innerHTML = Object.entries(statusCounts)
      .filter(([_, count]) => count > 0)
      .map(([status, count]) => `
        <span class="flex items-center text-app-muted border border-app-border rounded px-1.5 py-0.5 bg-app-bg" title="${status}">
          <span class="w-1.5 h-1.5 rounded-full ${colors[status]} mr-1.5"></span>
          ${count}
        </span>
      `).join('');
  }

  render() {
    const user = this.context.authService.getUser();
    return `
      <div class="max-w-[1800px] mx-auto px-6 py-8 flex flex-col gap-8 min-h-screen">
        <header class="flex justify-between items-center bg-app-surface p-6 rounded-2xl shadow-lg border border-app-border shrink-0">
          <div class="flex gap-6 items-center">
            <button onclick="window.location.hash = '#'" class="p-3 hover:bg-app-bg rounded-xl transition-all text-app-muted hover:text-app-accent-1 border border-transparent hover:border-app-border group cursor-pointer" title="Back to Dashboard">
              <svg class="w-6 h-6 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
              </svg>
            </button>
            <div id="pipeline-info-container" class="min-w-[400px]">
              <div class="flex flex-col">
                <h2 id="pipeline-title" class="text-3xl font-black text-app-accent-1 tracking-tight">Loading...</h2>
                <div class="flex flex-wrap items-center gap-3 mt-2">
                  <div class="flex items-center bg-app-bg rounded border border-app-border overflow-hidden">
                    <p class="text-app-muted text-[10px] uppercase font-bold tracking-widest px-2 py-1">ID: ${this.pipelineId}</p>
                    <button data-action-click="copy_pipeline_id" class="px-2 py-1 bg-app-surface border-l border-app-border text-app-muted hover:text-app-accent-2 transition-colors cursor-pointer group/copy" title="Copy ID">
                       <svg class="w-3 h-3 group-hover/copy:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    </button>
                  </div>
                  <div id="header-stats" class="flex flex-wrap gap-2 text-[10px] uppercase font-bold tracking-wider"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="flex gap-4 items-center">
             <button data-action-click="open_search" data-pipeline-id="${this.pipelineId}" class="flex items-center gap-2 bg-app-bg hover:bg-app-surface px-4 py-2 rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group mr-4" title="Global Search (Ctrl+K)">
               <svg class="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
               <span class="text-xs font-bold uppercase tracking-widest">Search</span>
               <span class="text-[10px] bg-app-surface px-1.5 py-0.5 rounded border border-app-border text-app-muted group-hover:text-app-accent-2 group-hover:border-app-accent-2/30 transition-colors ml-1">K</span>
             </button>
             <div class="flex flex-col items-end mr-2">
               <span class="text-sm font-bold text-app-text">${user?.username || 'User'}</span>
               <button data-action-click="perform_logout" class="text-[10px] text-app-muted hover:text-red-400 uppercase font-black tracking-widest transition-colors cursor-pointer">Logout</button>
             </div>
             <button data-action-click="open_stats" class="text-app-accent-2 hover:brightness-110 font-bold transition-all text-sm px-3 py-1.5 rounded-lg border border-app-border bg-app-bg shadow-sm cursor-pointer" title="Keyboard Shortcut: s">
               <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
               Stats
             </button>
          </div>
        </header>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start flex-grow w-full">
          <!-- Column 1: Preparation & Review -->
          <div class="flex flex-col gap-8 min-w-0 lg:min-w-[350px]">
            <div class="bg-app-surface/30 p-6 rounded-3xl border border-app-border/30 flex flex-col">
              ${TaskForm.render()}
              <div id="col-prep" class="space-y-10">
                <!-- Proposed and Created tasks will be rendered here -->
                <p class="text-app-muted animate-pulse text-center py-10">Loading backlog...</p>
              </div>
            </div>
          </div>

          <!-- Column 2: Active Execution -->
          <div class="flex flex-col gap-8 min-w-0 lg:min-w-[350px]">
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

          <!-- Column 3: History & Analytics -->
          <div class="flex flex-col gap-8 min-w-0 lg:min-w-[350px]">
            <div class="bg-app-surface/30 p-6 rounded-3xl border border-app-border/30 flex flex-col">
              <div id="col-history" class="space-y-8">
                <!-- Stats and Completed tasks will be rendered here -->
                <p class="text-app-muted animate-pulse text-center py-10">Loading history...</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.loadPipeline();
    this.refreshTasks();
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
    
    const taskHtml = TaskItem.render(task, columnId === 'backlog-list' || columnId === 'scheduled-list', false, this.collapsedTasks.has(task.id!));
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
      const columnId = el.closest('[id]')?.id;
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
    this.updateHeaderStats();

    if (el) {
      const currentColumnId = el.parentElement?.id;
      const targetColumnId = this.getTaskColumnId(task);

      if (currentColumnId === targetColumnId) {
        // Just update content
        const taskHtml = TaskItem.render(task, targetColumnId === 'backlog-list' || targetColumnId === 'scheduled-list', false, this.collapsedTasks.has(task.id!));
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
