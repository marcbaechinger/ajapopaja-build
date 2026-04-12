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

        const taskEl = this.container?.querySelector(`[data-view-id="${message.payload.task_id}"]`);
        if (taskEl) {
          const list = taskEl.parentElement;
          const wasLastCompleted = list?.id === 'last-completed-task';
          taskEl.remove();
          
          if (list && list.children.length === 0) {
             if (list.id === 'task-list') {
               list.innerHTML = '<p class="text-app-muted italic">No tasks to be done.</p>';
             } else if (list.id === 'completed-task-list') {
               list.innerHTML = '<p class="text-app-muted italic text-xs">No completed tasks yet.</p>';
             }
          }

          if (wasLastCompleted) {
            // Promote the top of completed-task-list to last-completed-task
            const completedList = this.container?.querySelector('#completed-task-list');
            const topCompleted = completedList?.firstElementChild;
            if (topCompleted && topCompleted.tagName !== 'P') {
              this.container?.querySelector('#last-completed-task')?.appendChild(topCompleted);
              if (completedList?.children.length === 0) {
                completedList.innerHTML = '<p class="text-app-muted italic text-xs">No completed tasks yet.</p>';
              }
            }
          }

          this.updateCompletedCount();
        }
      }
    }));
  }

  private updateCompletedCount() {
    const completedContainer = this.container?.querySelector('#completed-task-list');
    const lastCompletedContainer = this.container?.querySelector('#last-completed-task');
    const completedCountEl = this.container?.querySelector('#completed-count');
    if (completedContainer && lastCompletedContainer && completedCountEl) {
      const countList = completedContainer.querySelectorAll('[data-view-id]').length;
      const countLast = lastCompletedContainer.querySelectorAll('[data-view-id]').length;
      completedCountEl.textContent = `(${countList + countLast})`;
    }
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
      const sourceList = taskEl.parentElement;
      const wasLastCompleted = sourceList?.id === 'last-completed-task';
      taskEl.remove();
      
      // Handle empty source list
      if (sourceList && sourceList.children.length === 0) {
        if (sourceList.id === 'task-list') {
          sourceList.innerHTML = '<p class="text-app-muted italic">No tasks to be done.</p>';
        } else if (sourceList.id === 'completed-task-list') {
          sourceList.innerHTML = '<p class="text-app-muted italic text-xs">No completed tasks yet.</p>';
        }
      }

      if (wasLastCompleted) {
        // Promote from completed list
        const completedList = this.container.querySelector('#completed-task-list');
        const topCompleted = completedList?.firstElementChild;
        if (topCompleted && topCompleted.tagName !== 'P') {
          this.container.querySelector('#last-completed-task')?.appendChild(topCompleted);
          if (completedList?.children.length === 0) {
            completedList.innerHTML = '<p class="text-app-muted italic text-xs">No completed tasks yet.</p>';
          }
        }
      }

      if (isTaskCompleted) {
        // Task became completed: Demote current last-completed to list, and put new task in last-completed
        const lastCompletedContainer = this.container.querySelector('#last-completed-task');
        const completedList = this.container.querySelector('#completed-task-list');
        
        if (lastCompletedContainer && completedList) {
          const currentLast = lastCompletedContainer.firstElementChild;
          if (currentLast && currentLast.tagName !== 'P') {
            if (completedList.querySelector('p.italic')) {
              completedList.innerHTML = '';
            }
            completedList.prepend(currentLast);
          }
          
          const temp = document.createElement('div');
          temp.innerHTML = TaskItem.render(task, false, true);
          const newNode = temp.firstElementChild;
          if (newNode) {
            lastCompletedContainer.innerHTML = ''; // clear any placeholder if we had one
            lastCompletedContainer.appendChild(newNode);
          }
        }
      } else {
        // Task became open (rare)
        const targetList = this.container.querySelector('#task-list');
        if (targetList) {
          if (targetList.querySelector('p.italic')) {
            targetList.innerHTML = '';
          }
          const temp = document.createElement('div');
          temp.innerHTML = TaskItem.render(task, this.currentSortOrder === 'execution', false);
          const newNode = temp.firstElementChild;
          if (newNode) {
             targetList.prepend(newNode);
          }
        }
      }
      
      this.updateCompletedCount();
      return;
    }

    // Render new HTML and replace inline
    const temp = document.createElement('div');
    const showOrdering = this.currentSortOrder === 'execution' && !isTaskCompleted;
    const isLastCompleted = taskEl.closest('#last-completed-task') !== null;
    temp.innerHTML = TaskItem.render(task, showOrdering, isLastCompleted);
    const newNode = temp.firstElementChild;
    if (newNode) {
      taskEl.replaceWith(newNode);
    }
  }

  private registerActions() {
    this.context.actionRegistry.register('open_stats', async (e) => {
      e.preventDefault();
      new StatsDialog(this.allLoadedTasks).show();
    });

    this.context.actionRegistry.register('change_sort_order', async (e) => {
      const select = e.target as HTMLSelectElement;
      this.currentSortOrder = select.value as any;
      this.refreshTasks();
    });

    this.context.actionRegistry.register('create_task', async (e) => {
      e.preventDefault();
      const form = (e.target as HTMLElement).closest('form') as HTMLFormElement;
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
        ? openTasks.map(t => TaskItem.render(t, showOrdering, false)).join('')
        : '<p class="text-app-muted italic">No tasks to be done.</p>';

      if (completedTasks.length > 0) {
        lastCompletedContainer.innerHTML = TaskItem.render(completedTasks[0], false, true);
        const remainingCompleted = completedTasks.slice(1);
        completedContainer.innerHTML = remainingCompleted.length > 0
          ? remainingCompleted.map(t => TaskItem.render(t, false, false)).join('')
          : '<p class="text-app-muted italic text-xs">No completed tasks yet.</p>';
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

  render() {    return `
      <div class="space-y-6 max-w-5xl mx-auto px-4 py-8">
        <header class="flex justify-between items-center bg-app-surface p-6 rounded-xl shadow-lg border border-app-border">
          <div>
            <h2 id="pipeline-title" class="text-3xl font-bold text-app-accent-1">Loading...</h2>
            <p class="text-app-muted text-sm mt-1">Pipeline ID: ${this.pipelineId}</p>
          </div>
          <div class="flex gap-4 items-center">
             <button data-action-click="open_stats" class="text-app-accent-2 hover:brightness-110 font-bold transition-all text-sm px-3 py-1.5 rounded-lg border border-app-border bg-app-bg shadow-sm cursor-pointer" title="Keyboard Shortcut: s">
               <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
               Stats
             </button>
             <button onclick="window.location.hash = '#'" class="text-app-accent-1 hover:brightness-110 font-bold transition-all text-sm px-3 py-1.5 rounded-lg border border-app-border bg-app-bg shadow-sm cursor-pointer" title="Back to Dashboard">
               <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
               </svg>
               Dashboard
             </button>
          </div>
        </header>

        <section class="bg-app-surface p-6 rounded-xl shadow-xl border border-app-border w-full">
          <form id="create-task" class="flex flex-col md:flex-row gap-4 items-end">
            <div class="flex-grow w-full">
              <label class="block text-sm font-medium text-app-muted mb-1">Add New Task</label>
              <input type="text" id="task-title" placeholder="e.g. Implement User Auth" 
                     class="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2 focus:ring-2 focus:ring-app-accent-1 outline-none text-app-text transition-all">
            </div>
            <button type="submit" data-action-click="create_task" 
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
