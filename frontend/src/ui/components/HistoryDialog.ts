import { Task, TaskStatus } from '../../core/domain.ts';
import { BaseDialog } from './dialog_common.ts';

export class HistoryDialog extends BaseDialog {
  private tasks: Task[];

  constructor(tasks: Task[]) {
    super({
      title: 'History (--oneline)',
      maxWidth: 'max-w-2xl',
      iconSvg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
    });
    this.tasks = tasks;
    
    // Refresh body with tasks
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    bodyContainer.innerHTML = this.renderBody() as string;
  }

  protected renderBody(): string {
    if (!this.tasks) return '';
    const implementedTasks = this.tasks
      .filter(t => !t.deleted && t.status === TaskStatus.IMPLEMENTED)
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());

    if (implementedTasks.length === 0) {
      return `
        <div class="p-8 text-center text-app-muted italic text-sm">
          No history available.
        </div>
      `;
    }

    return `
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
    `;
  }
}
