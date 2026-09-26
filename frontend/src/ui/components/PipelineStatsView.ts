/**
 * Copyright 2026 Marc Baechinger
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Task, TaskStatus } from '../../core/domain.ts';
import { Icon } from './Icon.ts';

export class PipelineStatsView {
  /**
   * Calculate the total time a task spent IN_PROGRESS.
   *
   * Walks the task's status history (sorted by timestamp) and sums the time
   * from each IN_PROGRESS transition until the task transitions out of it into
   * any other status.
   */
  static getInProgressTime(task: Task): number {
    let inProgressTime = 0;
    let lastInprogressStart: number | null = null;

    if (!task.history || task.history.length === 0) {
      return 0;
    }

    const sortedHistory = [...task.history].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (const event of sortedHistory) {
      const timestamp = new Date(event.timestamp).getTime();

      if (event.to_status === TaskStatus.INPROGRESS) {
        lastInprogressStart = timestamp;
      } else if (lastInprogressStart !== null) {
        inProgressTime += timestamp - lastInprogressStart;
        lastInprogressStart = null;
      }
    }

    return inProgressTime;
  }

  static calculateMetrics(tasks: Task[]): {
    work: { avg: string, median: string, total: string }
  } {
    // Which tasks contribute to the work-time statistics is determined by the
    // task's history, NOT by its current status. Any task that has completed at
    // least one IN_PROGRESS interval has a non-zero in-progress time and must be
    // included, no matter which state it currently sits in (IMPLEMENTED,
    // PULL_REQUEST_AVAILABLE, SUBMITTED, DISCARDED, FAILED, back to SCHEDULED,
    // or even IN_PROGRESS with a trailing open interval). Filtering on the
    // current status silently dropped those tasks and produced wrong averages
    // and medians. Tasks that never completed an IN_PROGRESS interval have no
    // measurable work time and are excluded.
    const workTimes = tasks
      .map(t => this.getInProgressTime(t))
      .filter(time => time > 0)
      .sort((a, b) => a - b);

    if (workTimes.length === 0) return {
      work: { avg: 'N/A', median: 'N/A', total: 'N/A' }
    };

    const total = workTimes.reduce((sum, t) => sum + t, 0);
    const avg = total / workTimes.length;
    const median = workTimes.length % 2 === 0
      ? (workTimes[workTimes.length / 2 - 1] + workTimes[workTimes.length / 2]) / 2
      : workTimes[Math.floor(workTimes.length / 2)];

    return {
      work: {
        avg: this.formatDuration(avg),
        median: this.formatDuration(median),
        total: this.formatDuration(total)
      }
    };
  }

  static formatDuration(ms: number): string {
    if (ms <= 0) return '0s';
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

  static render(tasks: Task[], dailyStats?: any[], hideDistribution: boolean = false): string {
    const statusCounts: Record<string, number> = {
      [TaskStatus.CREATED]: 0,
      [TaskStatus.SCHEDULED]: 0,
      [TaskStatus.PROPOSED]: 0,
      [TaskStatus.INPROGRESS]: 0,
      [TaskStatus.IMPLEMENTED]: 0,
      [TaskStatus.PULL_REQUEST_AVAILABLE]: 0,
      [TaskStatus.SUBMITTED]: 0,
      [TaskStatus.FAILED]: 0,
      [TaskStatus.DISCARDED]: 0,
      'DELETED': 0,
    };

    let total = 0;
    tasks.forEach(t => {
      // DELETED represents tasks deleted at the API layer and must not be excluded from the distribution.
      if (t.deleted) {
        statusCounts['DELETED']++;
      } else if (statusCounts[t.status] !== undefined) {
        statusCounts[t.status]++;
      }
      total++;
    });

    const metrics = this.calculateMetrics(tasks);

    const colors: Record<string, string> = {
      [TaskStatus.CREATED]: 'bg-slate-600',
      [TaskStatus.SCHEDULED]: 'bg-blue-600',
      [TaskStatus.PROPOSED]: 'bg-purple-600',
      [TaskStatus.INPROGRESS]: 'bg-amber-600',
      [TaskStatus.IMPLEMENTED]: 'bg-green-600',
      [TaskStatus.PULL_REQUEST_AVAILABLE]: 'bg-cyan-600',
      [TaskStatus.SUBMITTED]: 'bg-teal-600',
      [TaskStatus.FAILED]: 'bg-red-600',
      [TaskStatus.DISCARDED]: 'bg-slate-800',
      'DELETED': 'bg-red-900',
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

    const dailyRows = Array.isArray(dailyStats) ? dailyStats.map(day => `
      <tr class="border-b border-app-border/50 text-sm">
        <td class="py-3 font-medium text-app-text">${day.date}</td>
        <td class="py-3 text-center text-app-muted">${day.created}</td>
        <td class="py-3 text-center text-app-muted">${day.implemented}</td>
        <td class="py-3 text-right text-app-accent-1 font-semibold">${this.formatDuration(day.work_ms)}</td>
      </tr>
    `).join('') : '';

    return `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div class="bg-app-bg p-4 rounded-xl border border-app-border shadow-sm flex flex-col items-center justify-center text-center">
          <span class="text-xs font-bold text-app-muted uppercase tracking-widest mb-1">Total Tasks</span>
          <span class="text-4xl font-extrabold text-app-text">${total}</span>
        </div>
        <div class="bg-app-bg p-4 rounded-xl border border-app-border shadow-sm flex flex-col items-center justify-center text-center">
          <span class="text-xs font-bold text-app-muted uppercase tracking-widest mb-1">Avg Time IN_PROGRESS</span>
          <span class="text-2xl font-bold text-app-accent-1">${metrics.work.avg}</span>
        </div>
        <div class="bg-app-bg p-4 rounded-xl border border-app-border shadow-sm flex flex-col items-center justify-center text-center">
          <span class="text-xs font-bold text-app-muted uppercase tracking-widest mb-1">Median Time IN_PROGRESS</span>
          <span class="text-2xl font-bold text-app-accent-2">${metrics.work.median}</span>
        </div>
        <div class="bg-app-bg p-4 rounded-xl border border-app-border shadow-sm flex flex-col items-center justify-center text-center">
          <span class="text-xs font-bold text-app-muted uppercase tracking-widest mb-1">Total Time IN_PROGRESS</span>
          <span class="text-2xl font-bold text-app-accent-2">${metrics.work.total}</span>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        ${!hideDistribution ? `
        <div class="bg-app-bg p-6 rounded-xl border border-app-border shadow-sm">
          <h4 class="text-sm font-bold text-app-text mb-6 flex items-center gap-2">
            ${Icon.render('pieChart', { size: 16, className: 'text-app-muted' })}
            Task Distribution
          </h4>
          <div class="space-y-1">
            ${bars || '<p class="text-app-muted italic text-sm text-center">No tasks available.</p>'}
          </div>
        </div>
        ` : ''}

        ${dailyStats && dailyStats.length > 0 ? `
        <div class="bg-app-bg p-6 rounded-xl border border-app-border shadow-sm">
          <h4 class="text-sm font-bold text-app-text mb-6 flex items-center gap-2">
            ${Icon.render('calendar', { size: 16, className: 'text-app-muted' })}
            Daily Productivity
          </h4>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="text-left text-xs font-bold text-app-muted uppercase tracking-wider border-b border-app-border">
                  <th class="pb-3">Date</th>
                  <th class="pb-3 text-center">Created</th>
                  <th class="pb-3 text-center">Done</th>
                  <th class="pb-3 text-right">Work Time</th>
                </tr>
              </thead>
              <tbody>
                ${dailyRows}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Renders a compact, single-row summary of pipeline stats.
   * Used in list views (e.g. the dashboard) where vertical space is precious.
   * Reuses calculateMetrics() and formatDuration() to keep computation centralized.
   */
  static renderCompact(tasks: Task[]): string {
    const metrics = this.calculateMetrics(tasks);

    let total = 0;
    tasks.forEach(t => { if (!t.deleted) total++; });

    const chip = (label: string, value: string, dot: string, text: string) => `
      <span class="flex items-center gap-1.5 min-w-0">
        <span class="h-1.5 w-1.5 rounded-full shrink-0 ${dot}"></span>
        <span class="text-[10px] text-app-muted whitespace-nowrap">${label}</span>
        <span class="text-[11px] font-bold whitespace-nowrap ${text}">${value}</span>
      </span>
    `;

    return `
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        ${chip('Total', String(total), 'bg-app-accent-1', 'text-app-text')}
        <span class="h-3 w-px bg-app-border/60 hidden sm:block"></span>
        ${chip('Avg Work', metrics.work.avg, 'bg-app-accent-1', 'text-app-accent-1')}
        <span class="h-3 w-px bg-app-border/60 hidden sm:block"></span>
        ${chip('Median Work', metrics.work.median, 'bg-app-accent-2', 'text-app-accent-2')}
        <span class="h-3 w-px bg-app-border/60 hidden sm:block"></span>
        ${chip('Total Work', metrics.work.total, 'bg-app-accent-2', 'text-app-accent-2')}
      </div>
    `;
  }

  static animateBars(container: HTMLElement) {
    setTimeout(() => {
      container.querySelectorAll<HTMLElement>('[data-target-width]').forEach(el => {
        el.style.width = el.dataset.targetWidth || '0%';
      });
    }, 50);
  }
}
