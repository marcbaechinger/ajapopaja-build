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

export interface TaskDurations {
  designTime: number;
  implementationTime: number;
  totalWorkTime: number;
  leadTime: number;
}

export class PipelineStatsView {
  static getTaskDurations(task: Task): TaskDurations {
    let designTime = 0;
    let implementationTime = 0;
    let hasReachedProposed = false;
    let lastInprogressStart: number | null = null;
    let firstScheduledAt: number | null = null;
    let implementationFinishedAt: number | null = null;

    if (!task.history || task.history.length === 0) {
      return { designTime: 0, implementationTime: 0, totalWorkTime: 0, leadTime: 0 };
    }

    const sortedHistory = [...task.history].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (const event of sortedHistory) {
      const timestamp = new Date(event.timestamp).getTime();

      if (event.to_status === TaskStatus.SCHEDULED && firstScheduledAt === null) {
        firstScheduledAt = timestamp;
      }

      if (event.to_status === TaskStatus.INPROGRESS) {
        lastInprogressStart = timestamp;
      } else if (lastInprogressStart !== null) {
        const duration = timestamp - lastInprogressStart;
        if (hasReachedProposed) {
          implementationTime += duration;
        } else {
          designTime += duration;
        }
        lastInprogressStart = null;
      }

      if (event.to_status === TaskStatus.PROPOSED) {
        hasReachedProposed = true;
      }

      if (event.to_status === TaskStatus.IMPLEMENTED) {
        implementationFinishedAt = timestamp;
      }
    }

    const leadTime = firstScheduledAt && implementationFinishedAt 
      ? Math.max(0, implementationFinishedAt - firstScheduledAt) 
      : 0;

    return { 
      designTime, 
      implementationTime, 
      totalWorkTime: designTime + implementationTime,
      leadTime
    };
  }

  static calculateMetrics(tasks: Task[]): { 
    work: { avg: string, median: string },
    lead: { avg: string, median: string }
  } {
    const implemented = tasks.filter(t => t.status === TaskStatus.IMPLEMENTED);
    if (implemented.length === 0) return { 
      work: { avg: 'N/A', median: 'N/A' },
      lead: { avg: 'N/A', median: 'N/A' }
    };

    const durations = implemented.map(t => this.getTaskDurations(t));
    
    const workTimes = durations.map(d => d.totalWorkTime).sort((a, b) => a - b);
    const leadTimes = durations.map(d => d.leadTime).filter(lt => lt > 0).sort((a, b) => a - b);

    const getAvgMedian = (times: number[]) => {
      if (times.length === 0) return { avg: 'N/A', median: 'N/A' };
      const total = times.reduce((sum, t) => sum + t, 0);
      const avg = total / times.length;
      const median = times.length % 2 === 0 
        ? (times[times.length / 2 - 1] + times[times.length / 2]) / 2 
        : times[Math.floor(times.length / 2)];
      return { avg: this.formatDuration(avg), median: this.formatDuration(median) };
    };

    return {
      work: getAvgMedian(workTimes),
      lead: getAvgMedian(leadTimes)
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

  static render(tasks: Task[], hideDistribution: boolean = false): string {
    const statusCounts: Record<string, number> = {
      [TaskStatus.CREATED]: 0,
      [TaskStatus.SCHEDULED]: 0,
      [TaskStatus.INPROGRESS]: 0,
      [TaskStatus.IMPLEMENTED]: 0,
      [TaskStatus.FAILED]: 0,
      [TaskStatus.DISCARDED]: 0,
      'DELETED': 0,
    };
    
    let total = 0;
    tasks.forEach(t => {
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
      [TaskStatus.INPROGRESS]: 'bg-amber-600',
      [TaskStatus.IMPLEMENTED]: 'bg-green-600',
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

    return `
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div class="bg-app-bg p-4 rounded-xl border border-app-border shadow-sm flex flex-col items-center justify-center text-center">
          <span class="text-xs font-bold text-app-muted uppercase tracking-widest mb-1">Total Tasks</span>
          <span class="text-4xl font-extrabold text-app-text">${total}</span>
        </div>
        <div class="bg-app-bg p-4 rounded-xl border border-app-border shadow-sm flex flex-col items-center justify-center text-center">
          <span class="text-xs font-bold text-app-muted uppercase tracking-widest mb-1">Avg Active Work</span>
          <span class="text-2xl font-bold text-app-accent-1">${metrics.work.avg}</span>
        </div>
        <div class="bg-app-bg p-4 rounded-xl border border-app-border shadow-sm flex flex-col items-center justify-center text-center">
          <span class="text-xs font-bold text-app-muted uppercase tracking-widest mb-1">Median Active Work</span>
          <span class="text-2xl font-bold text-app-accent-1">${metrics.work.median}</span>
        </div>
        <div class="bg-app-bg p-4 rounded-xl border border-app-border shadow-sm flex flex-col items-center justify-center text-center">
          <span class="text-xs font-bold text-app-muted uppercase tracking-widest mb-1">Avg Lead Time</span>
          <span class="text-2xl font-bold text-app-accent-2">${metrics.lead.avg}</span>
        </div>
      </div>

      ${!hideDistribution ? `
      <div class="bg-app-bg p-6 rounded-xl border border-app-border shadow-sm">
        <h4 class="text-sm font-bold text-app-text mb-6 flex items-center gap-2">
          <svg class="w-4 h-4 text-app-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"></path></svg>
          Task Distribution
        </h4>
        <div class="space-y-1">
          ${bars || '<p class="text-app-muted italic text-sm text-center">No tasks available.</p>'}
        </div>
      </div>
      ` : ''}
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
