import { Task } from '../../core/domain.ts';
import { TaskItem } from './TaskItem.ts';

export interface CompletedSectionOptions {
  lastCompleted: Task | null;
  totalCompletedCount: number;
  collapsedTasks: Set<string>;
}

export class CompletedSection {
  static render(options: CompletedSectionOptions): string {
    const { lastCompleted, totalCompletedCount, collapsedTasks } = options;

    return `
      <section id="completed-section" class="flex flex-col gap-6">
        <div>
          <h3 class="text-sm font-black text-app-muted uppercase tracking-widest mb-4 px-1 flex justify-between items-center">
            <span>Last Completed</span>
            ${totalCompletedCount > 0 ? `<span class="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20 font-black tracking-widest">${totalCompletedCount} total</span>` : ''}
          </h3>
          <div id="last-completed-task">
            ${lastCompleted 
              ? TaskItem.render(lastCompleted, false, true, collapsedTasks.has(lastCompleted._id!))
              : '<p class="text-app-muted italic text-sm py-4 text-center border border-dashed border-app-border/30 rounded-xl">No tasks completed yet.</p>'}
          </div>
        </div>

        <div class="pt-2">
          <details class="group/completed" open>
            <summary class="flex items-center gap-2 cursor-pointer list-none text-app-muted hover:text-app-text transition-colors mb-4 px-1">
              <svg class="w-4 h-4 transition-transform group-open/completed:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
              </svg>
              <span class="font-black text-[10px] uppercase tracking-widest">History Feed</span>
            </summary>
            
            <div class="bg-app-surface/30 rounded-2xl border border-app-border/30 p-1">
              <div id="completed-task-list" class="space-y-3 p-2">
                <!-- Completed tasks will be rendered here -->
                <p class="text-app-muted italic text-[10px] text-center py-4">Loading history...</p>
              </div>
              <div id="completed-pagination" class="px-2 pb-2"></div>
            </div>
          </details>
        </div>
      </section>
    `;
  }
}
