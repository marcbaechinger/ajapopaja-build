import { Task, TaskStatus } from '../../core/domain.ts';

export class StatsDialog {
  private dialog: HTMLDialogElement;
  private tasks: Task[];

  constructor(tasks: Task[]) {
    this.tasks = tasks;
    this.dialog = this.createDialog();
    document.body.appendChild(this.dialog);
  }

  private getCompletionDuration(task: Task): number | null {
    const created = new Date(task.created_at || 0).getTime();
    let completed = new Date(task.updated_at || 0).getTime();
    
    if (task.history && task.history.length > 0) {
      const implEvent = task.history.find(h => h.to_status === TaskStatus.IMPLEMENTED);
      if (implEvent) {
        completed = new Date(implEvent.timestamp).getTime();
      }
    }
    
    return Math.max(0, completed - created);
  }

  private calculateCompletionTimes(): { avg: string, median: string } {
    const implemented = this.tasks.filter(t => t.status === TaskStatus.IMPLEMENTED);
    if (implemented.length === 0) return { avg: 'N/A', median: 'N/A' };

    const times = implemented.map(t => this.getCompletionDuration(t) || 0).sort((a, b) => a - b);

    const total = times.reduce((sum, t) => sum + t, 0);
    const avg = total / times.length;
    const median = times.length % 2 === 0 
      ? (times[times.length / 2 - 1] + times[times.length / 2]) / 2 
      : times[Math.floor(times.length / 2)];

    return {
      avg: this.formatDuration(avg),
      median: this.formatDuration(median)
    };
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `< 1s`;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private createDialog(): HTMLDialogElement {
    const dialog = document.createElement('dialog');
    dialog.className = 'bg-app-surface text-app-text p-0 rounded-xl shadow-2xl border border-app-border backdrop:bg-black/50 backdrop:backdrop-blur-sm max-w-2xl w-full fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 max-h-[90vh] overflow-hidden flex flex-col';
    
    const statusCounts: Record<string, number> = {
      [TaskStatus.CREATED]: 0,
      [TaskStatus.SCHEDULED]: 0,
      [TaskStatus.INPROGRESS]: 0,
      [TaskStatus.IMPLEMENTED]: 0,
      [TaskStatus.FAILED]: 0,
      [TaskStatus.DISCARDED]: 0,
    };
    
    this.tasks.forEach(t => {
      if (statusCounts[t.status] !== undefined) {
        statusCounts[t.status]++;
      }
    });
    
    const total = this.tasks.length;
    const completionTimes = this.calculateCompletionTimes();

    const colors: Record<string, string> = {
      [TaskStatus.CREATED]: 'bg-slate-600',
      [TaskStatus.SCHEDULED]: 'bg-blue-600',
      [TaskStatus.INPROGRESS]: 'bg-amber-600',
      [TaskStatus.IMPLEMENTED]: 'bg-green-600',
      [TaskStatus.FAILED]: 'bg-red-600',
      [TaskStatus.DISCARDED]: 'bg-slate-800'
    };

    const bars = Object.entries(statusCounts).map(([status, count]) => {
      if (count === 0) return '';
      const percentage = total > 0 ? (count / total) * 100 : 0;
      return `
        <div class="mb-4">
          <div class="flex justify-between text-xs font-bold text-app-muted uppercase tracking-wider mb-1.5">
            <span>${status}</span>
            <span>${count} <span class="opacity-60 font-normal">(${percentage.toFixed(1)}%)</span></span>
          </div>
          <div class="w-full bg-app-bg rounded-full h-2.5 overflow-hidden border border-app-border/50">
            <div class="${colors[status]} h-full rounded-full transition-all duration-1000 ease-out" style="width: 0%;" data-target-width="${percentage}%"></div>
          </div>
        </div>
      `;
    }).join('');

    dialog.innerHTML = `
      <div class="p-6 border-b border-app-border flex justify-between items-center bg-app-bg shrink-0">
        <h3 class="text-xl font-bold text-app-accent-2 flex items-center gap-3">
          <svg class="w-6 h-6 text-app-accent-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
          Pipeline Statistics
        </h3>
        <button id="dialog-close" class="text-app-muted hover:text-app-text transition-colors cursor-pointer p-1.5 rounded-lg hover:bg-app-surface">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
      
      <div class="p-6 overflow-y-auto overflow-x-hidden grow custom-scrollbar bg-app-surface">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div class="bg-app-bg p-4 rounded-xl border border-app-border shadow-sm flex flex-col items-center justify-center text-center">
            <span class="text-xs font-bold text-app-muted uppercase tracking-widest mb-1">Total Tasks</span>
            <span class="text-4xl font-extrabold text-app-text">${total}</span>
          </div>
          <div class="bg-app-bg p-4 rounded-xl border border-app-border shadow-sm flex flex-col items-center justify-center text-center">
            <span class="text-xs font-bold text-app-muted uppercase tracking-widest mb-1">Avg Completion</span>
            <span class="text-2xl font-bold text-app-accent-1">${completionTimes.avg}</span>
          </div>
          <div class="bg-app-bg p-4 rounded-xl border border-app-border shadow-sm flex flex-col items-center justify-center text-center">
            <span class="text-xs font-bold text-app-muted uppercase tracking-widest mb-1">Median Completion</span>
            <span class="text-2xl font-bold text-app-accent-2">${completionTimes.median}</span>
          </div>
        </div>

        <div class="bg-app-bg p-6 rounded-xl border border-app-border shadow-sm">
          <h4 class="text-sm font-bold text-app-text mb-6 flex items-center gap-2">
            <svg class="w-4 h-4 text-app-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"></path></svg>
            Task Distribution
          </h4>
          <div class="space-y-1">
            ${bars || '<p class="text-app-muted italic text-sm text-center">No tasks available.</p>'}
          </div>
        </div>
      </div>
    `;

    dialog.querySelector('#dialog-close')?.addEventListener('click', () => this.handleClose());
    
    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
      if (!isInDialog) {
        this.handleClose();
      }
    });

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.handleClose();
    });

    // Trigger animations after mount
    setTimeout(() => {
      dialog.querySelectorAll<HTMLElement>('[data-target-width]').forEach(el => {
        el.style.width = el.dataset.targetWidth || '0%';
      });
    }, 50);

    return dialog;
  }

  private handleClose() {
    this.dialog.close();
    this.cleanup();
  }

  private cleanup() {
    setTimeout(() => {
      if (this.dialog.parentNode) {
        document.body.removeChild(this.dialog);
      }
    }, 300);
  }

  public show() {
    this.dialog.showModal();
  }
}
