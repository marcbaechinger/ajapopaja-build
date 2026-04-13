import { View } from '../../core/Navigator.ts';
import { AppContext } from '../../core/AppContext.ts';
import { Pipeline, TaskStatus, Task } from '../../core/domain.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.ts';
import { TaskItem } from '../components/TaskItem.ts';
import { HistoryDialog } from '../components/HistoryDialog.ts';
import { StatsDialog } from '../components/StatsDialog.ts';
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
  private completedTasksPage: number = 0;
  private completedPageSize: number = 5;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(context: AppContext, params: Record<string, string>) {
    super();
    this.context = context;
    this.pipelineId = params.id;
    this.registerActions();
    this.setupWebSocket();
    this.setupKeyboardShortcuts();
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
        this.updateSingleTask(message.payload);
      }
    };

    const handleCreate = (message: any) => {
      if (message.payload?.pipeline_id === this.pipelineId) {
        // Only append if it doesn't exist yet
        if (this.container?.querySelector(`[data-view-id="${message.payload._id}"]`)) return;
        
        const listContainer = this.container?.querySelector('#task-list');
        if (!listContainer) return;

        // For created tasks, a full refresh is safest to maintain sort order
        // and handle the "No tasks" placeholder correctly.
        this.refreshTasks();
      }
    };

    this.unsubs.push(this.context.wsClient.on('TASK_CREATED', handleCreate));
    this.unsubs.push(this.context.wsClient.on('TASK_UPDATED', handleUpdate));
    this.unsubs.push(this.context.wsClient.on('TASK_STATUS_UPDATED', handleUpdate));
    this.unsubs.push(this.context.wsClient.on('TASK_COMPLETED', handleUpdate));
    this.unsubs.push(this.context.wsClient.on('TASK_DELETED', (message: any) => {
      if (message.payload?.pipeline_id === this.pipelineId) {
        // Update local cache
        this.allLoadedTasks = this.allLoadedTasks.filter(t => t._id !== message.payload.task_id);
        this.refreshTasks();
      }
    }));
  }

  private updateSingleTask(task: any) {
    if (!this.container) return;

    // Update the local tasks cache
    const index = this.allLoadedTasks.findIndex(t => t._id === task._id);
    if (index !== -1) {
      this.allLoadedTasks[index] = task;
    } else {
      this.allLoadedTasks.push(task);
    }
    this.updateHeaderStats();

    // If task is being edited locally, skip external updates to avoid losing state
    if (this.activeEditors.has(task._id)) {
      console.log('Skipping update for task being edited:', task._id);
      return;
    }

    const taskEl = this.container.querySelector(`[data-view-id="${task._id}"]`);
    if (!taskEl) {
      // If task belongs here but isn't shown, refresh everything
      this.refreshTasks();
      return;
    }

    const isTaskCompleted = ([TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED] as any[]).includes(task.status);
    const wasTaskCompleted = taskEl.closest('#completed-task-list') !== null || taskEl.closest('#last-completed-task') !== null;

    // If moving between open/completed sections
    if (isTaskCompleted !== wasTaskCompleted) {
      this.refreshTasks();
      return;
    }

    // Render new HTML and replace inline
    const temp = document.createElement('div');
    const showOrdering = this.currentSortOrder === 'execution' && !isTaskCompleted;
    const isLastCompleted = taskEl.closest('#last-completed-task') !== null;
    temp.innerHTML = TaskItem.render(task, showOrdering, isLastCompleted, this.collapsedTasks.has(task._id));
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

      const task = this.allLoadedTasks.find(t => t._id === taskId);
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
        this.refreshTasks();
      }
    });

    this.context.actionRegistry.register('next_completed_page', async (e) => {
      e.preventDefault();
      this.completedTasksPage++;
      this.refreshTasks();
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
    const listContainer = this.container.querySelector('#task-list');
    const lastCompletedContainer = this.container.querySelector('#last-completed-task');
    const completedContainer = this.container.querySelector('#completed-task-list');
    const completedCountEl = this.container.querySelector('#completed-count');
    if (!listContainer || !lastCompletedContainer || !completedContainer) return;

    try {
      this.allLoadedTasks = await this.context.taskClient.listByPipeline(this.pipelineId, true);
      this.updateHeaderStats();
      const allTasks = this.allLoadedTasks;
      
      const openTasks = allTasks.filter(t => !t.deleted && !([TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED] as any[]).includes(t.status));
      const completedTasks = allTasks.filter(t => !t.deleted && ([TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED] as any[]).includes(t.status));

      // Sort open tasks
      openTasks.sort((a, b) => {
        if (this.currentSortOrder === 'execution') {
          if (a.order !== b.order) {
            return a.order - b.order; // Primary: User explicit order
          }
          
          // Secondary: Status weight to push active/ready tasks up
          const getStatusWeight = (status: TaskStatus | string) => {
            if (status === TaskStatus.INPROGRESS) return 0;
            if (status === TaskStatus.SCHEDULED) return 1;
            if (status === TaskStatus.CREATED) return 2;
            if (status === TaskStatus.FAILED) return 3;
            return 4;
          };
          
          const weightA = getStatusWeight(a.status);
          const weightB = getStatusWeight(b.status);
          
          if (weightA !== weightB) {
            return weightA - weightB;
          }
          
          // Tertiary: Oldest first (FIFO)
          return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        } else if (this.currentSortOrder === 'newest') {
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        } else {
          // Status sort
          return a.status.localeCompare(b.status);
        }
      });

      // Sort completed tasks by completion time (updated_at)
      completedTasks.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());

      const showOrdering = this.currentSortOrder === 'execution';
      listContainer.innerHTML = openTasks.length > 0 
        ? openTasks.map(t => TaskItem.render(t, showOrdering, false, this.collapsedTasks.has(t._id!))).join('')
        : '<p class="text-app-muted italic">No tasks to be done.</p>';

      if (completedTasks.length > 0) {
        lastCompletedContainer.innerHTML = TaskItem.render(completedTasks[0], false, true, this.collapsedTasks.has(completedTasks[0]._id!));
        const remainingCompleted = completedTasks.slice(1);
        
        const totalPages = Math.ceil(remainingCompleted.length / this.completedPageSize);
        // Ensure page index is valid if tasks were deleted
        if (this.completedTasksPage >= totalPages && totalPages > 0) {
          this.completedTasksPage = totalPages - 1;
        }
        
        const start = this.completedTasksPage * this.completedPageSize;
        const end = start + this.completedPageSize;
        const pageTasks = remainingCompleted.slice(start, end);

        completedContainer.innerHTML = pageTasks.length > 0
          ? pageTasks.map(t => TaskItem.render(t, false, false, this.collapsedTasks.has(t._id!))).join('')
          : '<p class="text-app-muted italic text-xs">No completed tasks yet.</p>';

        if (totalPages > 1) {
          const paginationHtml = `
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
          completedContainer.insertAdjacentHTML('beforeend', paginationHtml);
        }
      } else {
        lastCompletedContainer.innerHTML = '';
        completedContainer.innerHTML = '<p class="text-app-muted italic text-xs">No completed tasks yet.</p>';
      }

      if (completedCountEl) {
        completedCountEl.textContent = `(${completedTasks.length})`;
      }
    } catch (error) {
      listContainer.innerHTML = '<p class="text-red-400">Error loading tasks.</p>';
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
      <div class="space-y-6 max-w-5xl mx-auto px-4 py-8">
        <header class="flex justify-between items-center bg-app-surface p-6 rounded-xl shadow-lg border border-app-border">
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

        <section class="bg-app-surface p-6 rounded-xl shadow-xl border border-app-border w-full">
          <form data-action-submit="create_task" class="flex flex-col md:flex-row gap-4 items-end">
            <div class="flex-grow w-full">
              <label class="block text-sm font-medium text-app-muted mb-1">Add New Task</label>
              <input type="text" id="task-title" placeholder="e.g. Implement User Auth" 
                     class="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2 focus:ring-2 focus:ring-app-accent-1 outline-none text-app-text transition-all">
            </div>
            <button type="submit" 
                    class="w-full md:w-auto bg-app-accent-1 hover:brightness-110 text-white font-bold px-8 py-2 rounded-lg transition-all shadow-lg cursor-pointer h-[42px]">
              Add 
            </button>
          </form>
        </section>
        <section class="bg-app-surface p-6 rounded-xl shadow-xl border border-app-border w-full">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-bold text-app-accent-2">Task Sequence</h3>
            <div class="flex items-center gap-2">
              <label class="text-xs text-app-muted uppercase font-bold tracking-wider">Sort:</label>
              <select data-action-change="change_sort_order" class="bg-app-bg border border-app-border rounded px-2 py-1 text-xs text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 cursor-pointer">
                <option value="execution" ${this.currentSortOrder === 'execution' ? 'selected' : ''}>Execution Order</option>
                <option value="newest" ${this.currentSortOrder === 'newest' ? 'selected' : ''}>Newest First</option>
                <option value="status" ${this.currentSortOrder === 'status' ? 'selected' : ''}>By Status</option>
              </select>
            </div>
          </div>
          
          <div id="task-list" class="space-y-4">
            <p class="text-app-muted animate-pulse">Loading tasks...</p>
          </div>

          <div class="mt-8 pt-6 border-t border-app-border/30">
            <h3 class="text-sm font-bold text-app-muted uppercase tracking-widest mb-4">Last Completed Task</h3>
            <div id="last-completed-task" class="mb-4">
              <!-- Render last completed task here -->
            </div>
            
            <details class="group/completed">
              <summary class="flex items-center gap-2 cursor-pointer list-none text-app-muted hover:text-app-text transition-colors">
                <svg class="w-4 h-4 transition-transform group-open/completed:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                </svg>
                <span class="font-bold text-sm uppercase tracking-widest">Older Completed Tasks <span id="completed-count"></span></span>
              </summary>
              <div id="completed-task-list" class="space-y-4 mt-4 opacity-80">
                <!-- Completed tasks will be rendered here -->
              </div>
            </details>
          </div>
        </section>
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
