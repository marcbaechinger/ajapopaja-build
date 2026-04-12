import { View } from '../../core/Navigator.ts';
import { AppContext } from '../../core/AppContext.ts';
import { Pipeline, TaskStatus } from '../../core/domain.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.ts';
import { TaskItem } from '../components/TaskItem.ts';
import EasyMDE from 'easymde';

export class PipelineDetailView extends View {
  private container: HTMLElement | null = null;
  private pipelineId: string;
  private pipeline: Pipeline | null = null;
  private context: AppContext;
  private unsubs: (() => void)[] = [];
  private activeEditors: Map<string, EasyMDE> = new Map();

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
    if (!listContainer) return;

    try {
      const tasks = await this.context.taskClient.listByPipeline(this.pipelineId);
      listContainer.innerHTML = tasks.length > 0 
        ? tasks.map(t => TaskItem.render(t)).join('')
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

  render() {    return `
      <div class="space-y-6 max-w-5xl mx-auto px-4 py-8">
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
          <h3 class="text-xl font-bold mb-4 text-app-accent-2">Task Sequence</h3>
          <div id="task-list" class="space-y-4">
            <p class="text-app-muted animate-pulse">Loading tasks...</p>
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
  }
}
