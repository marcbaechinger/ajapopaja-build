import { View } from '../../core/Navigator.ts';
import { AppContext } from '../../core/AppContext.ts';
import { Pipeline } from '../../core/domain.ts';

export class DashboardView extends View {
  private container: HTMLElement | null = null;
  private context: AppContext;
  private unsub: (() => void) | null = null;

  constructor(context: AppContext) {
    super();
    this.context = context;
    this.registerActions();
    this.setupWebSocket();
  }

  private setupWebSocket() {
    this.unsub = this.context.wsClient.on('PIPELINE_CREATED', () => {
      this.refreshList();
    });
  }

  private registerActions() {
    this.context.actionRegistry.register('create_pipeline', async (e) => {
      e.preventDefault();
      const form = (e.target as HTMLElement).closest('form') as HTMLFormElement;
      const input = form.querySelector('input') as HTMLInputElement;
      const name = input.value.trim();
      
      if (!name) return;

      try {
        await this.context.pipelineClient.create(name);
        input.value = '';
        // List will be updated via WebSocket
      } catch (error) {
        alert('Failed to create pipeline');
      }
    });
  }

  async refreshList() {
    if (!this.container) return;
    const listContainer = this.container.querySelector('#pipeline-list');
    if (!listContainer) return;

    try {
      console.log('Fetching pipelines from:', this.context.pipelineClient);
      const pipelines = await this.context.pipelineClient.list();
      console.log('Pipelines loaded:', pipelines);
      listContainer.innerHTML = pipelines.length > 0 
        ? pipelines.map(p => this.renderPipelineItem(p)).join('')
        : '<p class="text-app-muted italic">No pipelines created yet.</p>';
    } catch (error) {
      console.error('Error in refreshList:', error);
      listContainer.innerHTML = `<p class="text-red-400">Error loading pipelines: ${error instanceof Error ? error.message : String(error)}</p>`;
    }
  }

  private renderPipelineItem(pipeline: Pipeline) {
    const statusColors: Record<string, string> = {
      'active': 'bg-green-600/20 text-green-400 border-green-600/30',
      'paused': 'bg-amber-600/20 text-amber-400 border-amber-600/30',
      'completed': 'bg-blue-600/20 text-blue-400 border-blue-600/30'
    };

    return `
      <div class="bg-app-bg p-3 rounded-lg border border-app-border flex justify-between items-center transition-all hover:border-app-accent-1 cursor-pointer" 
           data-view-type="pipeline" data-view-id="${pipeline._id}"
           onclick="window.location.hash = '#/pipeline/${pipeline._id}'">
        <div class="flex flex-col">
          <span class="font-medium text-app-text">${pipeline.name}</span>
          <span class="text-[10px] text-app-muted uppercase font-bold mt-1">v${pipeline.version}</span>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${statusColors[pipeline.status] || 'bg-slate-600/20 text-slate-400 border-slate-600/30'}">
          ${pipeline.status}
        </span>
      </div>
    `;
  }

  render() {
    return `
      <main class="grid gap-8 md:grid-cols-2">
        <section class="bg-app-surface p-6 rounded-xl shadow-xl border border-app-border transition-all hover:border-app-accent-1/50">
          <h2 class="text-2xl font-bold mb-4 text-app-accent-1">Create Pipeline</h2>
          <form id="create-pipeline" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-app-muted mb-1">Pipeline Name</label>
              <input type="text" placeholder="e.g. My Feature" class="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2 focus:ring-2 focus:ring-app-accent-1 outline-none text-app-text transition-all">
            </div>
            <button type="submit" data-action-click="create_pipeline" class="w-full bg-app-accent-1 hover:brightness-110 text-white font-bold py-2 rounded-lg transition-all shadow-lg cursor-pointer">
              Create
            </button>
          </form>
        </section>

        <section class="bg-app-surface p-6 rounded-xl shadow-xl border border-app-border transition-all hover:border-app-accent-2/50">
          <h2 class="text-2xl font-bold mb-4 text-app-accent-2">Active Pipelines</h2>
          <div id="pipeline-list" class="space-y-2">
            <p class="text-app-muted animate-pulse">Loading pipelines...</p>
          </div>
        </section>
      </main>
    `;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.refreshList();
  }

  unmount() {
    if (this.unsub) this.unsub();
  }
}
