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

export interface PromptConfig {
  id: string;
  label: string;
  title: string;
  iconSvg: string;
  getPrompt: (taskId: string, pipelineId: string) => string;
}

export function renderQuickPromptButton(config: PromptConfig): string {
  return `
    <button data-action-copy="${config.id}" 
            class="px-3 py-1.5 rounded bg-app-bg border border-app-border text-[10px] font-bold uppercase tracking-wider text-app-accent-2 hover:bg-app-accent-2/10 transition-all cursor-pointer flex items-center gap-1.5 group" 
            title="${config.title}">
      ${config.iconSvg}
      ${config.label}
    </button>
  `;
}
