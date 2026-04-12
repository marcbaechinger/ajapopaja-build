import { View } from '../../core/Navigator.ts';
import { AppContext } from '../../core/AppContext.ts';
import { Pipeline, Task, TaskStatus } from '../../core/domain.ts';

export class PipelineDetailView extends View {
  private container: HTMLElement | null = null;
  private pipelineId: string;
  private pipeline: Pipeline | null = null;
  private context: AppContext;
  private unsubs: (() => void)[] = [];

  constructor(context: AppContext, params: Record<string, string>) {
    super();
    this.context = context;
    this.pipelineId = params.id;
    this.registerActions();
    this.setupWebSocket();
  }

  private setupWebSocket() {
    const handleUpdate = (message: any) => {
      // Refresh if the updated task belongs to this pipeline
      if (message.payload?.pipeline_id === this.pipelineId) {
        this.refreshTasks();
      }
    };

    this.unsubs.push(this.context.wsClient.on('TASK_CREATED', handleUpdate));
    this.unsubs.push(this.context.wsClient.on('TASK_UPDATED', handleUpdate));
    this.unsubs.push(this.context.wsClient.on('TASK_STATUS_UPDATED', handleUpdate));
    this.unsubs.push(this.context.wsClient.on('TASK_COMPLETED', handleUpdate));
    this.unsubs.push(this.context.wsClient.on('TASK_DELETED', (message: any) => {
      if (message.payload?.pipeline_id === this.pipelineId) {
        this.refreshTasks();
      }
    }));
  }

  private registerActions() {
    this.context.actionRegistry.register('create_task', async (e) => {
      e.preventDefault();
      const form = (e.target as HTMLElement).closest('form') as HTMLFormElement;
      const input = form.querySelector('input') as HTMLInputElement;
      const title = input.value.trim();
      
      if (!title) return;

      try {
        await this.context.taskClient.create(this.pipelineId, title);
        input.value = '';
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to create task');
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

      if (!confirm('Are you sure you want to mark this task as FAILED?')) return;

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

      if (!confirm('Are you sure you want to delete this task?')) return;

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
    if (!listContainer) return;

    try {
      const tasks = await this.context.taskClient.listByPipeline(this.pipelineId);
      listContainer.innerHTML = tasks.length > 0 
        ? tasks.map(t => this.renderTaskItem(t)).join('')
        : '<p class="text-app-muted italic">No tasks in this pipeline.</p>';
    } catch (error) {
      listContainer.innerHTML = '<p class="text-red-400">Error loading tasks.</p>';
    }
  }

  private updateHeader() {
    if (!this.container || !this.pipeline) return;
    const titleEl = this.container.querySelector('#pipeline-title');
    if (titleEl) titleEl.textContent = this.pipeline.name;
  }

  private renderTaskItem(task: Task) {
    const statusColors: Record<string, string> = {
      [TaskStatus.CREATED]: 'bg-slate-600 text-slate-300',
      [TaskStatus.SCHEDULED]: 'bg-blue-600 text-white animate-pulse',
      [TaskStatus.INPROGRESS]: 'bg-amber-600 text-white',
      [TaskStatus.IMPLEMENTED]: 'bg-green-600 text-white',
      [TaskStatus.FAILED]: 'bg-red-600 text-white',
      [TaskStatus.DISCARDED]: 'bg-slate-800 text-slate-500'
    };

    const canSchedule = task.status === TaskStatus.CREATED;
    const canFail = ([TaskStatus.INPROGRESS, TaskStatus.IMPLEMENTED] as any[]).includes(task.status);
    const isSystem = task.type === 'system';
    const isInProgress = task.status === TaskStatus.INPROGRESS;

    return `
      <div class="bg-app-bg p-4 rounded-lg border border-app-border flex flex-col gap-3 transition-all hover:border-app-accent-1/30 ${isSystem ? 'border-l-4 border-l-red-500' : ''}" 
           data-view-type="task" data-view-id="${task._id}">
        <div class="flex justify-between items-start">
          <div class="flex flex-col">
            <span class="font-medium text-app-text text-lg">${task.title}</span>
            <span class="text-xs text-app-muted">Order: ${task.order} ${isSystem ? '• System Task' : ''}</span>
          </div>
          <span class="text-xs px-2 py-1 rounded font-bold uppercase ${statusColors[task.status] || 'bg-slate-600'}">
            ${task.status}
          </span>
        </div>
        
        ${task.description ? `<p class="text-sm text-app-text/70">${task.description}</p>` : ''}

        ${task.commit_hash ? `
          <div class="text-xs font-mono text-app-accent-2 bg-app-surface p-2 rounded border border-app-border">
            Commit: ${task.commit_hash.substring(0, 7)}
          </div>
        ` : ''}

        <div class="flex justify-between items-center mt-2">
          <div class="flex gap-1">
            <button data-action-click="move_task_up" data-version="${task.version}" data-order="${task.order}"
                    ${isInProgress ? 'disabled' : ''}
                    class="p-1 hover:bg-app-surface rounded text-app-muted hover:text-app-accent-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="Move Up">
              &uarr;
            </button>
            <button data-action-click="move_task_down" data-version="${task.version}" data-order="${task.order}"
                    ${isInProgress ? 'disabled' : ''}
                    class="p-1 hover:bg-app-surface rounded text-app-muted hover:text-app-accent-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="Move Down">
              &darr;
            </button>
          </div>
          <div class="flex gap-2">
            <button data-action-click="delete_task" 
                    class="p-1.5 hover:bg-red-500/20 text-app-muted hover:text-red-400 rounded transition-all cursor-pointer" title="Delete Task">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
            ${canFail ? `
              <button data-action-click="fail_task" data-version="${task.version}" 
                      class="text-xs text-red-400 hover:text-red-300 px-3 py-1 rounded transition-all cursor-pointer">
                Mark as Failed
              </button>
            ` : ''}
            ${canSchedule ? `
              <button data-action-click="schedule_task" data-version="${task.version}" 
                      class="text-xs bg-app-accent-1 hover:brightness-110 text-white px-3 py-1 rounded transition-all shadow-lg cursor-pointer">
                Schedule Execution
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    return `
      <div class="space-y-8">
        <header class="flex justify-between items-center bg-app-surface p-6 rounded-xl shadow-lg border border-app-border">
          <div>
            <h2 id="pipeline-title" class="text-3xl font-bold text-app-accent-1">Loading...</h2>
            <p class="text-app-muted text-sm mt-1">Pipeline ID: ${this.pipelineId}</p>
          </div>
          <div class="flex gap-4">
             <button onclick="window.location.hash = '#'" class="text-app-muted hover:text-app-text transition-colors">
               &larr; Back to Dashboard
             </button>
          </div>
        </header>

        <main class="grid gap-8 md:grid-cols-3">
          <section class="bg-app-surface p-6 rounded-xl shadow-xl border border-app-border md:col-span-1 h-fit">
            <h3 class="text-xl font-bold mb-4 text-app-accent-1">Add Task</h3>
            <form id="create-task" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-app-muted mb-1">Task Title</label>
                <input type="text" placeholder="e.g. Implement User Auth" class="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2 focus:ring-2 focus:ring-app-accent-1 outline-none text-app-text transition-all">
              </div>
              <button type="submit" data-action-click="create_task" class="w-full bg-app-accent-1 hover:brightness-110 text-white font-bold py-2 rounded-lg transition-all shadow-lg cursor-pointer">
                Add to Pipeline
              </button>
            </form>
          </section>

          <section class="bg-app-surface p-6 rounded-xl shadow-xl border border-app-border md:col-span-2">
            <h3 class="text-xl font-bold mb-4 text-app-accent-2">Task Sequence</h3>
            <div id="task-list" class="space-y-4">
              <p class="text-app-muted animate-pulse">Loading tasks...</p>
            </div>
          </section>
        </main>
      </div>
    `;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.loadPipeline();
    this.refreshTasks();
  }

  unmount() {
    this.unsubs.forEach(unsub => unsub());
    this.unsubs = [];
  }
}
