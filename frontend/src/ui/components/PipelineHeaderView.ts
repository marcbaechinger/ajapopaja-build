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

import { Pipeline, Task, type GitStatus } from '../../core/domain.ts';
import { UserProfileBadge } from './UserProfileBadge.ts';
import { TaskStatusCounter } from './TaskStatusCounter.ts';
import { RepositoryStatusBadge } from './RepositoryStatusBadge.ts';
import { HeaderDialogButtons } from './HeaderDialogButtons.ts';

export interface DocbotState {
  status: 'none' | 'ready' | 'inProgress' | 'noUpdate';
  taskId: string | null;
  reason?: string;
}

export interface ReviewbotState {
  status: 'none' | 'inProgress';
  taskId: string | null;
}

export interface ArchbotState {
  status: 'none' | 'inProgress';
  taskId: string | null;
}

export interface PipelineHeaderViewProps {
  pipeline: Pipeline;
  pipelineId: string;
  geminiStatus: { running: boolean; log_file: string | null; available: boolean };
  vibeStatus: { running: boolean; log_file: string | null; available: boolean };
  docbotState: DocbotState;
  reviewbotState: ReviewbotState;
  archbotState?: ArchbotState;
  user: any;
  allTasks: Task[];
  gitStatus?: GitStatus;
  isTwoColumnLayout: boolean;
}

export class PipelineHeaderView {
  static render(props: PipelineHeaderViewProps): string {
    const { pipeline, pipelineId, docbotState, reviewbotState, archbotState, user, allTasks, gitStatus, isTwoColumnLayout } = props;

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

    let reviewbotBannerHtml = '';
    if (reviewbotState && reviewbotState.status === 'inProgress') {
      reviewbotBannerHtml = `
        <div class="inline-flex bg-app-accent-2/10 border border-app-accent-2/30 text-app-accent-2 rounded-full px-3 py-1 text-[10px] shadow-sm items-center gap-2">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-app-accent-2 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-app-accent-2"></span>
          </span>
          <span class="font-bold tracking-wide uppercase">ReviewBot Analyzing...</span>
        </div>
      `;
    }

    let archbotBannerHtml = '';
    if (archbotState && archbotState.status === 'inProgress') {
      archbotBannerHtml = `
        <div class="inline-flex bg-purple-500/10 border border-purple-500/30 text-purple-400 rounded-full px-3 py-1 text-[10px] shadow-sm items-center gap-2">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
          </span>
          <span class="font-bold tracking-wide uppercase">ArchBot Designing...</span>
        </div>
      `;
    }

    return `
      <header class="flex justify-between items-center bg-app-surface px-6 py-4 rounded-2xl shadow-lg border border-app-border shrink-0">
        <div class="flex gap-4 items-center overflow-hidden">
          <button onclick="window.location.hash='#'" class="p-2 hover:bg-app-bg rounded-xl transition-all text-app-muted hover:text-app-accent-1 border border-transparent hover:border-app-border group cursor-pointer" title="Back to Dashboard">
            <svg class="w-5 h-5 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
            </svg>
          </button>
          
          <div class="flex flex-col min-w-0">
            <div class="flex items-center gap-3">
              <h2 id="pipeline-title" class="text-xl font-black text-app-accent-1 tracking-tight truncate">${pipeline.name}</h2>
              <button data-action-click="edit_pipeline" class="p-1 hover:bg-app-bg text-app-muted hover:text-app-accent-1 rounded transition-all cursor-pointer" title="Edit Pipeline">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
              </button>
              <button data-action-click="open_health_check" class="p-1 hover:bg-app-bg rounded-lg transition-colors cursor-pointer text-app-muted hover:text-green-500" title="System Health">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              </button>
              <div id="docbot-banner-container" class="flex items-center gap-2">
                ${docbotBannerHtml}
                ${reviewbotBannerHtml}
                ${archbotBannerHtml}
              </div>
            </div>
            
            <div class="flex items-center gap-3 mt-1.5">
              <div class="flex items-center bg-app-bg rounded-lg border border-app-border overflow-hidden">
                <span class="text-app-muted text-[9px] uppercase font-black tracking-widest px-2 py-0.5">ID: ${pipelineId}</span>
                <button data-action-click="copy_pipeline_id" class="px-1.5 py-0.5 bg-app-surface border-l border-app-border text-app-muted hover:text-app-accent-2 transition-colors cursor-pointer group/copy" title="Copy ID">
                   <svg class="w-2.5 h-2.5 group-hover/copy:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                </button>
              </div>
              <span class="text-app-muted text-[9px] uppercase font-black tracking-widest bg-app-bg px-2 py-0.5 rounded-lg border border-app-border">Workspace: ${pipeline.workspace_path || 'Default'}</span>
              ${RepositoryStatusBadge.render(gitStatus)}
              <div id="header-stats" class="flex gap-1.5">
                ${TaskStatusCounter.render(allTasks)}
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-4">
          ${HeaderDialogButtons.render(pipelineId, isTwoColumnLayout)}
          ${UserProfileBadge.render(user)}
        </div>
      </header>
    `;
  }
}
