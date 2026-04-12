import { Task, TaskStatus } from '../../core/domain.ts';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

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
        ${task.description ? `<p class="text-sm text-app-text/70">${task.description}</p>` : ''}
        
        <div class="design-doc-container w-full text-xs bg-app-surface p-3 rounded-lg border border-app-border transition-all"
             data-task-id="${task._id}" data-version="${task.version}">
          <div class="design-doc-view cursor-pointer group" data-action-click="edit_design_doc">
            <div class="flex justify-between items-center mb-1">
              <span class="font-bold text-app-accent-2">Design Document</span>
              <span class="text-[10px] text-app-muted opacity-0 group-hover:opacity-100 transition-opacity">Click to edit</span>
            </div>
            <div class="design-doc-display prose prose-invert prose-sm max-w-none text-app-text/70 overflow-hidden relative transition-all duration-300">
              ${task.design_doc ? DOMPurify.sanitize(marked.parse(task.design_doc) as string) : '<span class="italic text-app-muted">Click to add design doc...</span>'}
              ${task.design_doc ? '<div class="expand-overlay absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-app-surface to-transparent pointer-events-none"></div>' : ''}
            </div>
          </div>
          ${task.design_doc ? `
            <button data-action-click="toggle_design_doc_expand" class="mt-2 text-[10px] text-app-accent-2 hover:underline cursor-pointer">
              Show More
            </button>
          ` : ''}
          
          <div class="design-doc-edit hidden flex flex-col gap-2">
            <span class="font-bold text-app-accent-2 mb-1">Editing Design Document</span>
            <textarea class="w-full bg-app-bg border border-app-border rounded p-2 text-app-text outline-none focus:ring-1 focus:ring-app-accent-2 min-h-[120px]" 
                      placeholder="Describe the implementation details...">${task.design_doc || ''}</textarea>
            <div class="flex gap-2 justify-end">
              <button data-action-click="cancel_design_doc" class="px-3 py-1 text-app-muted hover:text-app-text transition-colors cursor-pointer">
                Cancel
              </button>
              <button data-action-click="save_design_doc" class="px-4 py-1 bg-app-accent-2 text-white rounded hover:brightness-110 transition-all shadow-md cursor-pointer">
                Save Changes
              </button>
            </div>
          </div>
        </div>

        ${task.commit_hash ? `
          <div class="text-xs font-mono text-app-accent-2 bg-app-surface p-2 rounded border border-app-border w-fit">
            Commit: ${task.commit_hash.substring(0, 7)}
          </div>
        ` : ''}

      </div>
    `;
  }
}
