import { Task, TaskStatus } from '../../core/domain.ts';

export class HistoryDialog {
  private dialog: HTMLDialogElement;
  private tasks: Task[];

  constructor(tasks: Task[]) {
    this.tasks = tasks;
    this.dialog = this.createDialog();
    document.body.appendChild(this.dialog);
  }

  private createDialog(): HTMLDialogElement {
    const dialog = document.createElement('dialog');
    dialog.className = 'bg-app-surface text-app-text p-0 rounded-xl shadow-2xl border border-app-border backdrop:bg-black/50 backdrop:backdrop-blur-sm max-w-2xl w-full fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 max-h-[80vh] overflow-hidden flex flex-col';
    
    const implementedTasks = this.tasks
      .filter(t => !t.deleted && t.status === TaskStatus.IMPLEMENTED)
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());

    dialog.innerHTML = `
      <div class="p-4 border-b border-app-border flex justify-between items-center bg-app-bg shrink-0">
        <h3 class="text-lg font-bold text-app-accent-2 flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          History (--oneline)
        </h3>
        <button id="dialog-close" class="text-app-muted hover:text-app-text transition-colors cursor-pointer p-1 rounded hover:bg-app-surface">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
      <div class="p-0 overflow-y-auto overflow-x-hidden grow custom-scrollbar">
        ${implementedTasks.length > 0 ? `
          <ul class="flex flex-col">
            ${implementedTasks.map(task => `
              <li class="flex items-start gap-3 p-3 hover:bg-app-bg border-b border-app-border/30 transition-colors cursor-default group">
                <div class="text-[10px] font-mono text-app-accent-1 opacity-70 mt-1 shrink-0 whitespace-nowrap">
                  ${task.commit_hash ? task.commit_hash.substring(0, 7) : 'no-hash'}
                </div>
                <div class="flex flex-col min-w-0">
                  <span class="text-sm font-medium text-app-text truncate group-hover:text-app-accent-2 transition-colors">${task.title}</span>
                  <span class="text-[10px] text-app-muted mt-0.5">${new Date(task.updated_at || 0).toLocaleString()}</span>
                </div>
              </li>
            `).join('')}
          </ul>
        ` : `
          <div class="p-8 text-center text-app-muted italic text-sm">
            No history available.
          </div>
        `}
      </div>
    `;

    // Add CSS for custom scrollbar if needed, but Tailwind should suffice.
    
    dialog.querySelector('#dialog-close')?.addEventListener('click', () => this.handleClose());
    
    // Close on backdrop click
    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
      if (!isInDialog) {
        this.handleClose();
      }
    });

    // Handle Escape key
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.handleClose();
    });

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
    }, 100);
  }

  public show() {
    this.dialog.showModal();
  }
}
