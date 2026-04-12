import { Task } from '../../core/domain.ts';
import { PipelineStatsView } from './PipelineStatsView.ts';

export class StatsDialog {
  private dialog: HTMLDialogElement;
  private tasks: Task[];

  constructor(tasks: Task[]) {
    this.tasks = tasks;
    this.dialog = this.createDialog();
    document.body.appendChild(this.dialog);
  }

  private createDialog(): HTMLDialogElement {
    const dialog = document.createElement('dialog');
    dialog.className = 'bg-app-surface text-app-text p-0 rounded-xl shadow-2xl border border-app-border backdrop:bg-black/50 backdrop:backdrop-blur-sm max-w-2xl w-full fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 max-h-[90vh] overflow-hidden flex flex-col';
    
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
        ${PipelineStatsView.render(this.tasks)}
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

    PipelineStatsView.animateBars(dialog);

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
