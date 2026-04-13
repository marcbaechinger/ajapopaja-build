import { Task } from '../../core/domain.ts';
import { TaskItem } from './TaskItem.ts';

export interface TaskColumnOptions {
  id: string;
  title: string;
  tasks: Task[];
  emptyMessage?: string;
  showOrdering?: boolean;
  collapsedTasks: Set<string>;
  badge?: {
    text: string;
    class: string;
  };
}

export class TaskColumn {
  static render(options: TaskColumnOptions): string {
    const { id, title, tasks, emptyMessage = 'No tasks in this category.', showOrdering = false, collapsedTasks, badge } = options;

    const taskHtml = tasks.length > 0
      ? tasks.map(t => TaskItem.render(t, showOrdering, false, collapsedTasks.has(t._id!))).join('')
      : `<p class="text-app-muted italic text-sm py-4 text-center border-2 border-dashed border-app-border/30 rounded-xl">${emptyMessage}</p>`;

    return `
      <section id="${id}-section" class="flex flex-col gap-4 min-w-0">
        <div class="flex justify-between items-center px-1">
          <h3 class="text-lg font-black text-app-text uppercase tracking-tight flex items-center gap-2">
            ${title}
            ${badge ? `<span class="text-[10px] px-2 py-0.5 rounded-full font-black tracking-widest ${badge.class}">${badge.text}</span>` : ''}
            <span class="text-app-muted font-normal text-sm lowercase tracking-normal">(${tasks.length})</span>
          </h3>
        </div>
        
        <div id="${id}-list" class="space-y-4 flex-grow">
          ${taskHtml}
        </div>
      </section>
    `;
  }
}
