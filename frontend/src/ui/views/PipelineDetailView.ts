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
import { Pipeline, TaskStatus, Task } from '../../core/domain.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.ts';
import { TaskItem } from '../components/TaskItem.ts';
import { HistoryDialog } from '../components/HistoryDialog.ts';
import { StatsDialog } from '../components/StatsDialog.ts';
import { TaskForm } from '../components/TaskForm.ts';
import { TaskColumn } from '../components/TaskColumn.ts';
import { CompletedSection } from '../components/CompletedSection.ts';
import { PipelineStatsView } from '../components/PipelineStatsView.ts';
import EasyMDE from 'easymde';

export class PipelineDetailView extends View {
  private container: HTMLElement | null = null;
  private pipelineId: string;
  private pipeline: Pipeline | null = null;
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

  private getTaskColumnId(status: TaskStatus): string {
    switch (status) {
      case TaskStatus.PROPOSED: return 'proposed-list';
      case TaskStatus.CREATED: return 'backlog-list';
      case TaskStatus.INPROGRESS: return 'inprogress-list';
      case TaskStatus.FAILED: return 'failed-list';
      case TaskStatus.SCHEDULED: return 'scheduled-list';
      case TaskStatus.IMPLEMENTED:
      case TaskStatus.DISCARDED: return 'completed-task-list';
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
        new StatsDialog(this.allLoadedTasks).show();
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
  }

  private insertTaskIntoDOM(task: Task) {
    if (!this.container) return;
    const taskId = task.id!;
    
    // Safety check: remove any existing instances of this task first
    this.removeTaskFromDOM(taskId);

    const listId = this.getTaskColumnId(task.status);
    const list = this.container.querySelector(`#${listId}`);
    
    if (!list) {
      // If the list container doesn't exist (like #failed-list when empty), 
      // it's easier to refresh the column or the whole view.
      this.refreshTasks();
      return;
    }

    this.removeEmptyMessage(listId.replace('-list', ''));

    const isCompleted = ([TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED] as any[]).includes(task.status);
    const showOrdering = this.currentSortOrder === 'execution' && !isCompleted;
    const isLastCompleted = listId === 'last-completed-task';
    
    const temp = document.createElement('div');
    temp.innerHTML = TaskItem.render(task, showOrdering, isLastCompleted, this.collapsedTasks.has(taskId));
    const newNode = temp.firstElementChild;
    if (!newNode) return;

    if (task.status === TaskStatus.SCHEDULED && this.currentSortOrder === 'execution') {
      const items = Array.from(list.querySelectorAll('[data-view-id]'));
      const nextItem = items.find(item => {
        const orderAttr = item.querySelector('[data-order]')?.getAttribute('data-order');
        const order = orderAttr ? parseInt(orderAttr) : Infinity;
        return order > (task.order || 0);
      });
      if (nextItem) {
        list.insertBefore(newNode, nextItem);
      } else {
        list.appendChild(newNode);
      }
    } else if (isCompleted) {
      // Completed tasks have complex logic (Last vs History Feed)
      this.refreshTasks();
      return;
    } else {
      list.appendChild(newNode);
    }

    this.updateColumnHeaderCount(listId.replace('-list', ''));
    this.updateHeaderStats();
    this.updatePipelineHealth();
  }

  private removeTaskFromDOM(taskId: string) {
    if (!this.container) return;
    const taskEls = this.container.querySelectorAll(`[data-view-id="${taskId}"]`);

    // Cleanup editor if exists
    const editor = this.activeEditors.get(taskId);
    if (editor) {
      editor.toTextArea();
      this.activeEditors.delete(taskId);
    }

    if (taskEls.length === 0) return;
    
    taskEls.forEach(taskEl => {
      const list = taskEl.parentElement;
      taskEl.remove();
      if (list && list.id) {
        this.ensureEmptyMessage(list.id.replace('-list', ''));
        this.updateColumnHeaderCount(list.id.replace('-list', ''));
      }
    });

    this.updateHeaderStats();
    this.updatePipelineHealth();
  }

  private updatePipelineHealth() {
    if (!this.container) return;
    const historyContainer = this.container.querySelector('#col-history');
    if (!historyContainer) return;

    // Find the health stats section (it's the first child of col-history)
    const healthSection = historyContainer.querySelector('.bg-app-bg\\/50') as HTMLElement;
    if (healthSection) {
      // Re-render only the inner part of health section
      const statsTitle = healthSection.querySelector('h3');
      healthSection.innerHTML = `
        ${statsTitle ? statsTitle.outerHTML : '<h3 class="text-sm font-black text-app-muted uppercase tracking-widest mb-6 px-1">Pipeline Health</h3>'}
        ${PipelineStatsView.render(this.allLoadedTasks, true)}
      `;
      PipelineStatsView.animateBars(healthSection);
    }
  }

  private updateSingleTask(task: any) {
    if (!this.container) return;

    const taskId = task.id;
    // Update the local tasks cache
    const index = this.allLoadedTasks.findIndex(t => t.id === taskId);
    const oldTask = index !== -1 ? { ...this.allLoadedTasks[index] } : null;
    
    if (index !== -1) {
      this.allLoadedTasks[index] = task;
    } else {
      this.allLoadedTasks.push(task);
    }
    this.updateHeaderStats();
    this.updatePipelineHealth();

    // Auto-expand if task became active, auto-collapse if it became inactive
    const isActive = task.status === TaskStatus.INPROGRESS || task.status === TaskStatus.PROPOSED;
    const wasActive = oldTask ? (oldTask.status === TaskStatus.INPROGRESS || oldTask.status === TaskStatus.PROPOSED) : false;

    if (isActive && !wasActive) {
      this.collapsedTasks.delete(taskId);
    } else if (!isActive && wasActive) {
      this.collapsedTasks.add(taskId);
    }

    // If task is being edited locally, skip external updates to avoid losing state
    if (this.activeEditors.has(taskId)) {
      console.log('Skipping update for task being edited:', taskId);
      return;
    }

    const taskEl = this.container.querySelector(`[data-view-id="${taskId}"]`) as HTMLElement;
    if (!taskEl) {
      this.insertTaskIntoDOM(task);
      return;
    }

    const targetListId = this.getTaskColumnId(task.status);
    const currentList = taskEl.parentElement;
    
    const isTaskCompleted = ([TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED] as any[]).includes(task.status);
    const wasTaskCompleted = taskEl.closest('#completed-task-list') !== null || taskEl.closest('#last-completed-task') !== null;

    // If moving between open/completed sections OR moving between columns
    if (isTaskCompleted !== wasTaskCompleted || (currentList && currentList.id !== targetListId)) {
      this.removeTaskFromDOM(taskId);
      this.insertTaskIntoDOM(task);
      return;
    }

    // Render new HTML and replace inline
    const temp = document.createElement('div');
    const showOrdering = this.currentSortOrder === 'execution' && !isTaskCompleted;
    const isLastCompleted = taskEl.closest('#last-completed-task') !== null;
    temp.innerHTML = TaskItem.render(task, showOrdering, isLastCompleted, this.collapsedTasks.has(taskId));
    const newNode = temp.firstElementChild;
    if (newNode) {
      taskEl.replaceWith(newNode);
    }
  }

  private registerActions() {
    this.context.actionRegistry.register('toggle_task_collapse', async (_e, el) => {
      const taskEl = el.closest('[data-view-id]') as HTMLElement;
      if (!taskEl) return;
      const taskId = taskEl.getAttribute('data-view-id');
      if (!taskId) return;

      if (this.collapsedTasks.has(taskId)) {
        this.collapsedTasks.delete(taskId);
      } else {
        this.collapsedTasks.add(taskId);
      }

      const task = this.allLoadedTasks.find(t => t.id === taskId);
      if (task) {
        this.updateSingleTask(task);
      }
    });

    this.context.actionRegistry.register('open_stats', async (e) => {
      e.preventDefault();
      new StatsDialog(this.allLoadedTasks).show();
    });

    this.context.actionRegistry.register('change_sort_order', async (e) => {
      const select = e.target as HTMLSelectElement;
      this.currentSortOrder = select.value as any;
      this.refreshTasks();
    });

    this.context.actionRegistry.register('prev_completed_page', async (e) => {
      e.preventDefault();
      if (this.completedTasksPage > 0) {
        this.completedTasksPage--;
        this.refreshCompletedTasks();
      }
    });

    this.context.actionRegistry.register('next_completed_page', async (e) => {
      e.preventDefault();
      this.completedTasksPage++;
      this.refreshCompletedTasks();
    });

    this.context.actionRegistry.register('create_task', async (_e, el) => {
      const form = el as HTMLFormElement;
      const titleInput = form.querySelector('#task-title') as HTMLInputElement;

      const title = titleInput.value.trim();

      if (!title) return;

      try {
        await this.context.taskClient.create(this.pipelineId, title);
        titleInput.value = '';
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to create task');
      }
    });

    this.context.actionRegistry.register('edit_spec', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      
      container.querySelector('.spec-view')?.classList.add('hidden');
      container.querySelector('.spec-edit')?.classList.remove('hidden');
      
      const textarea = container.querySelector('textarea');
      textarea?.focus();
    });

    this.context.actionRegistry.register('cancel_spec_edit', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      
      container.querySelector('.spec-view')?.classList.remove('hidden');
      container.querySelector('.spec-edit')?.classList.add('hidden');
    });

    this.context.actionRegistry.register('save_spec', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      
      const taskId = container.getAttribute('data-task-id');
      const version = parseInt(container.getAttribute('data-version') || '1');
      if (!taskId) return;

      const spec = (container.querySelector('textarea') as HTMLTextAreaElement).value.trim();
      const want_design_doc = (container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked;

      try {
        await this.context.taskClient.updateDetails(taskId, version, { spec, want_design_doc });
        // UI refresh via WS
      } catch (error) {
        alert('Failed to save specification');
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
          collapsedTasks: this.collapsedTasks
        })}
      `;

      // 2. Render Active Column
      // Sort scheduled and failed tasks according to current sort order
      const sortFn = (a: Task, b: Task) => {
        if (this.currentSortOrder === 'execution') {
          if (a.order !== b.order) return a.order - b.order;
          return new Date(a.scheduled_at || a.created_at || 0).getTime() - new Date(b.scheduled_at || b.created_at || 0).getTime();
        } else if (this.currentSortOrder === 'newest') {
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        } else {
          return a.status.localeCompare(b.status);
        }
      };

      inProgressTasks.sort(sortFn);
      scheduledTasks.sort(sortFn);
      failedTasks.sort(sortFn);

      activeContainer.innerHTML = `
        ${TaskColumn.render({
          id: 'inprogress',
          title: 'In Progress',
          tasks: inProgressTasks,
          emptyMessage: 'No active work.',
          collapsedTasks: this.collapsedTasks,
          badge: { text: 'Running', class: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' }
        })}
        ${TaskColumn.render({
          id: 'failed',
          title: 'Failed',
          tasks: failedTasks,
          emptyMessage: '',
          collapsedTasks: this.collapsedTasks,
          badge: { text: 'Attention', class: 'bg-red-500/20 text-red-400 border border-red-500/30' }
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
          ${PipelineStatsView.render(allTasks, true)}
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
        const totalPages = Math.ceil(total_count / this.completedPageSize);
        if (totalPages > 1) {
          paginationContainer.innerHTML = `
            <div class="flex justify-between items-center mt-6 pt-4 border-t border-app-border/20">
              <button data-action-click="prev_completed_page" ${this.completedTasksPage === 0 ? 'disabled' : ''}
                      class="text-[10px] font-bold uppercase tracking-widest text-app-muted hover:text-app-accent-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                Previous
              </button>
              <span class="text-[10px] font-bold text-app-muted uppercase tracking-widest">Page ${this.completedTasksPage + 1} of ${totalPages}</span>
              <button data-action-click="next_completed_page" ${this.completedTasksPage === totalPages - 1 ? 'disabled' : ''}
                      class="text-[10px] font-bold uppercase tracking-widest text-app-muted hover:text-app-accent-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1">
                Next
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
              </button>
            </div>
          `;
        } else {
          paginationContainer.innerHTML = '';
        }
      }
    } catch (error) {
      console.error('Error refreshing completed tasks:', error);
    }
  }

  private updateHeader() {
    if (!this.container || !this.pipeline) return;
    const titleEl = this.container.querySelector('#pipeline-title');
    if (titleEl) titleEl.textContent = this.pipeline.name;
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
            <div class="flex flex-col">
              <h2 id="pipeline-title" class="text-3xl font-black text-app-accent-1 tracking-tight">Loading...</h2>
              <div class="flex flex-wrap items-center gap-3 mt-2">
                <p class="text-app-muted text-[10px] uppercase font-bold tracking-widest bg-app-bg px-2 py-1 rounded border border-app-border">ID: ${this.pipelineId}</p>
                <div id="header-stats" class="flex flex-wrap gap-2 text-[10px] uppercase font-bold tracking-wider"></div>
              </div>
            </div>
          </div>
          <div class="flex gap-4 items-center">
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
}
