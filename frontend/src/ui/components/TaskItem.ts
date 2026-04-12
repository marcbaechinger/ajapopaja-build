import { Task, TaskStatus } from '../../core/domain.ts';

export class TaskItem {
  static render(task: Task): string {
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
        ${task.design_doc ? `
          <div class="w-full text-xs bg-app-surface p-3 rounded-lg border border-app-border italic text-app-text/60">
            <span class="block font-bold not-italic text-app-accent-2 mb-1">Design Document</span>
            ${task.design_doc}
          </div>
        ` : ''}

        ${task.commit_hash ? `
          <div class="text-xs font-mono text-app-accent-2 bg-app-surface p-2 rounded border border-app-border w-fit">
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
}
