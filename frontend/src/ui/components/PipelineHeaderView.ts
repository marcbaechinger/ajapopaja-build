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

import { Pipeline, Task, TaskStatus } from '../../core/domain.ts';

export interface DocbotState {
  status: 'none' | 'ready' | 'inProgress' | 'noUpdate';
  taskId: string | null;
  reason?: string;
}

export interface PipelineHeaderViewProps {
  pipeline: Pipeline;
  pipelineId: string;
  geminiStatus: { running: boolean; log_file: string | null; available: boolean };
  vibeStatus: { running: boolean; log_file: string | null; available: boolean };
  docbotState: DocbotState;
  user: any;
  allTasks: Task[];
}

export class PipelineHeaderView {
  static render(props: PipelineHeaderViewProps): string {
    const { pipeline, pipelineId, geminiStatus, vibeStatus, docbotState, user, allTasks } = props;

    const statusColors: Record<string, string> = {
      'active': 'bg-green-600/20 text-green-400 border-green-600/30',
      'paused': 'bg-amber-600/20 text-amber-400 border-amber-600/30',
      'completed': 'bg-blue-600/20 text-blue-400 border-blue-600/30'
    };

    const geminiStatusHtml = !geminiStatus.available ? "" : (geminiStatus.running
      ? `
        <div class="flex items-center gap-2 bg-app-bg px-2 py-1 rounded border border-green-500/30">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span class="text-[10px] font-bold uppercase tracking-widest text-green-400">Gemini Running</span>
          <button data-action-click="open_gemini_logs" class="text-[9px] font-black uppercase tracking-tighter text-app-accent-2 hover:underline cursor-pointer ml-1">View Logs</button>
        </div>
      `
      : `
        <div class="flex items-center gap-2 bg-app-bg px-2 py-1 rounded border border-app-border opacity-60 hover:opacity-100 transition-opacity">
          <span class="h-2 w-2 rounded-full bg-app-muted"></span>
          <span class="text-[10px] font-bold uppercase tracking-widest text-app-muted">Gemini Idle</span>
          <button data-action-click="open_gemini_logs" class="text-[9px] font-black uppercase tracking-tighter text-app-muted hover:text-app-text cursor-pointer ml-1">Logs</button>
        </div>
      `);

    const vibeStatusHtml = !vibeStatus.available ? "" : (vibeStatus.running
      ? `
        <div class="flex items-center gap-2 bg-app-bg px-2 py-1 rounded border border-blue-500/30">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span class="text-[10px] font-bold uppercase tracking-widest text-blue-400">Vibe Running</span>
          <button data-action-click="open_vibe_logs" class="text-[9px] font-black uppercase tracking-tighter text-app-accent-2 hover:underline cursor-pointer ml-1">View Logs</button>
        </div>
      `
      : `
        <div class="flex items-center gap-2 bg-app-bg px-2 py-1 rounded border border-app-border opacity-60 hover:opacity-100 transition-opacity">
          <span class="h-2 w-2 rounded-full bg-app-muted"></span>
          <span class="text-[10px] font-bold uppercase tracking-widest text-app-muted">Vibe Idle</span>
          <button data-action-click="open_vibe_logs" class="text-[9px] font-black uppercase tracking-tighter text-app-muted hover:text-app-text cursor-pointer ml-1">Logs</button>
        </div>
      `);

    let docbotBannerHtml = '';
    if (docbotState.status === 'inProgress') {
      docbotBannerHtml = `
        <div class="inline-flex bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-full px-3 py-1 text-[10px] shadow-sm items-center gap-2">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
          <span class="font-bold tracking-wide uppercase">DocBot Analyzing...</span>
        </div>
      `;
    } else if (docbotState.status === 'noUpdate') {
      docbotBannerHtml = `
        <div class="inline-flex bg-slate-800/50 border border-slate-700 text-slate-400 rounded-full px-3 py-1 text-[10px] shadow-sm items-center gap-2" title="${docbotState.reason || ''}">
          <span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
          <span class="font-bold uppercase tracking-wider">No Doc Update</span>
          <button data-action-click="dismiss_docbot_banner" class="ml-1 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      `;
    } else if (docbotState.status === 'ready') {
      docbotBannerHtml = `
        <div class="inline-flex bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 rounded-full px-3 py-1 text-[10px] shadow-sm items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"></span>
          <span class="font-bold uppercase tracking-wider">Doc Ready</span>
          <button data-action-click="open_docbot_dialog" class="font-black underline hover:text-yellow-400 transition-colors cursor-pointer ml-1">Review</button>
          <button data-action-click="dismiss_docbot_banner" class="ml-1 text-yellow-700 hover:text-yellow-500 transition-colors cursor-pointer">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      `;
    }

    return `
      <header class="flex justify-between items-center bg-app-surface p-6 rounded-2xl shadow-lg border border-app-border shrink-0">
        <div class="flex gap-6 items-center overflow-hidden">
          <button onclick="window.location.hash = '#'" class="p-3 hover:bg-app-bg rounded-xl transition-all text-app-muted hover:text-app-accent-1 border border-transparent hover:border-app-border group cursor-pointer" title="Back to Dashboard">
            <svg class="w-6 h-6 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
            </svg>
          </button>
          <div id="pipeline-info-container" class="min-w-0 flex-shrink">
            <div id="pipeline-view-info" class="flex flex-col group relative">
              <div class="flex items-center gap-3">
                <h2 id="pipeline-title" class="text-3xl font-black text-app-accent-1 tracking-tight truncate">${pipeline.name}</h2>
                <span class="text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${statusColors[pipeline.status] || 'bg-slate-600/20 text-slate-400 border-slate-600/30'}">
                  ${pipeline.status}
                </span>
                ${geminiStatusHtml}
                ${vibeStatusHtml}
                <button data-action-click="edit_pipeline" class="opacity-0 group-hover:opacity-100 p-1 hover:bg-app-bg text-app-muted hover:text-app-accent-1 rounded transition-all cursor-pointer" title="Edit Pipeline">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                </button>
              </div>
              <div class="flex flex-wrap items-center gap-3 mt-2">
                <div class="flex items-center bg-app-bg rounded border border-app-border overflow-hidden">
                  <p class="text-app-muted text-[10px] uppercase font-bold tracking-widest px-2 py-1">ID: ${pipelineId}</p>
                  <button data-action-click="copy_pipeline_id" class="px-2 py-1 bg-app-surface border-l border-app-border text-app-muted hover:text-app-accent-2 transition-colors cursor-pointer group/copy" title="Copy ID">
                     <svg class="w-3 h-3 group-hover/copy:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                  </button>
                </div>
                <p class="text-app-muted text-[10px] uppercase font-bold tracking-widest bg-app-bg px-2 py-1 rounded border border-app-border">Workspace: ${pipeline.workspace_path || 'Default'}</p>
                <div id="header-stats" class="flex flex-wrap gap-2 text-[10px] uppercase font-bold tracking-wider">
                  ${this.renderHeaderStats(allTasks)}
                </div>
              </div>
            </div>

            <div id="pipeline-edit-info" class="hidden flex flex-col gap-3 bg-app-bg/50 p-4 rounded-xl border border-app-accent-1/30">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Pipeline Name</label>
                  <input type="text" name="pipeline_name" value="${pipeline.name}" class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1">
                </div>
                <div>
                  <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Status</label>
                  <select name="pipeline_status" class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 cursor-pointer">
                    <option value="active" ${pipeline.status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="paused" ${pipeline.status === 'paused' ? 'selected' : ''}>Paused</option>
                    <option value="completed" ${pipeline.status === 'completed' ? 'selected' : ''}>Completed</option>
                  </select>
                </div>
              </div>
              <div>
                <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Workspace Path (Optional)</label>
                <input type="text" name="workspace_path" value="${pipeline.workspace_path || ''}" placeholder="Default Project Root" class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1">
              </div>
              <div class="flex items-center gap-2 mt-1 px-1">
                <input type="checkbox" name="manage_gemini" id="manage_gemini" ${pipeline.manage_gemini ? 'checked' : ''} class="w-4 h-4 rounded border-app-border bg-app-bg text-app-accent-1 focus:ring-app-accent-1 cursor-pointer">
                <label for="manage_gemini" class="text-[10px] font-bold uppercase tracking-wider text-app-text cursor-pointer">Manage Gemini CLI process</label>
              </div>
              <div class="flex items-center gap-2 mt-1 px-1">
                <input type="checkbox" name="manage_vibe" id="manage_vibe" ${pipeline.manage_vibe ? 'checked' : ''} class="w-4 h-4 rounded border-app-border bg-app-bg text-app-accent-1 focus:ring-app-accent-1 cursor-pointer">
                <label for="manage_vibe" class="text-[10px] font-bold uppercase tracking-wider text-app-text cursor-pointer">Manage Vibe CLI process</label>
              </div>
              <div class="flex gap-2 justify-end mt-1">
                <button data-action-click="cancel_edit_pipeline" class="px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest text-app-muted hover:bg-app-bg transition-all cursor-pointer">Cancel</button>
                <button data-action-click="save_pipeline" class="px-4 py-1 rounded bg-app-accent-1 text-white text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all shadow-md cursor-pointer">Save Changes</button>
              </div>
            </div>
          </div>
          <div id="docbot-banner-container" class="flex items-center">
            ${docbotBannerHtml}
          </div>
        </div>
        <div class="flex items-center gap-2">
           <button data-action-click="open_search" data-pipeline-id="${pipelineId}" class="flex items-center gap-2 bg-app-bg hover:bg-app-surface px-4 py-2 rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group" title="Global Search (Ctrl+K)">
             <svg class="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
             <span class="text-xs font-bold uppercase tracking-widest">Search</span>
           </button>
           <button data-action-click="toggle_assistant" class="flex items-center gap-2 bg-app-bg hover:bg-app-surface px-4 py-2 rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group" title="AI Assistant (Ctrl+Shift+A)">
             <svg class="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
             <span class="text-xs font-bold uppercase tracking-widest">Assistant</span>
           </button>
           <button data-action-click="open_stats" class="flex items-center gap-2 bg-app-bg hover:bg-app-surface px-4 py-2 rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group" title="Statistics - Keyboard Shortcut: s">
             <svg class="w-4 h-4 group-hover:scale-110 transition-transform text-app-accent-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
             <span class="text-xs font-bold uppercase tracking-widest">Stats</span>
           </button>
           <div class="flex items-center gap-3 bg-app-bg px-4 py-2 rounded-xl border border-app-border h-[42px]">
             <div class="flex flex-col items-end">
               <span class="text-xs font-bold text-app-text">${user?.username || 'User'}</span>
               <span class="text-[9px] text-app-muted uppercase font-black tracking-widest">Logged In</span>
             </div>
             <div class="w-px h-6 bg-app-border mx-1"></div>
             <button data-action-click="perform_logout" class="p-1.5 hover:bg-red-500/10 text-app-muted hover:text-red-400 rounded-lg transition-all cursor-pointer group/logout" title="Logout">
               <svg class="w-4 h-4 group-hover/logout:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
             </button>
           </div>
           <button data-action-click="open_health_check" class="p-2 hover:bg-app-bg rounded-lg transition-colors cursor-pointer text-app-muted hover:text-green-500" title="System Health">
             <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
           </button>
        </div>
      </header>
    `;
  }

  static renderHeaderStats(allTasks: Task[]): string {
    const statusCounts: Record<string, number> = {
      [TaskStatus.CREATED]: 0,
      [TaskStatus.SCHEDULED]: 0,
      [TaskStatus.PROPOSED]: 0,
      [TaskStatus.INPROGRESS]: 0,
      [TaskStatus.IMPLEMENTED]: 0,
      [TaskStatus.FAILED]: 0,
      [TaskStatus.DISCARDED]: 0,
    };

    let total = 0;
    allTasks.forEach(t => {
      if (!t.deleted && statusCounts[t.status] !== undefined) {
        statusCounts[t.status]++;
        total++;
      }
    });

    if (total === 0) return '';

    const colors: Record<string, string> = {
      [TaskStatus.CREATED]: 'bg-slate-500',
      [TaskStatus.SCHEDULED]: 'bg-blue-500',
      [TaskStatus.PROPOSED]: 'bg-purple-500',
      [TaskStatus.INPROGRESS]: 'bg-amber-500',
      [TaskStatus.IMPLEMENTED]: 'bg-green-500',
      [TaskStatus.FAILED]: 'bg-red-500',
      [TaskStatus.DISCARDED]: 'bg-slate-700',
    };

    return Object.entries(statusCounts)
      .filter(([_, count]) => count > 0)
      .map(([status, count]) => `
        <span class="flex items-center text-app-muted border border-app-border rounded px-1.5 py-0.5 bg-app-bg" title="${status}">
          <span class="w-1.5 h-1.5 rounded-full ${colors[status]} mr-1.5"></span>
          ${count}
        </span>
      `).join('');
  }
}
