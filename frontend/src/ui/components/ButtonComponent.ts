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

export interface ButtonProps {
  action: string;
  icon?: string;
  label?: string;
  title?: string;
  mode?: 'icon-only' | 'label-only' | 'both';
  extraAttrs?: Record<string, string>;
  className?: string;
}

export class ButtonComponent {
  static render(props: ButtonProps): string {
    const { action, icon, label, title, mode = 'icon-only', extraAttrs = {}, className = "" } = props;
    
    const attrString = Object.entries(extraAttrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');

    const baseClass = "p-2 bg-app-bg hover:bg-app-surface rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group flex items-center gap-2";
    const finalClass = className ? `${baseClass} ${className}` : baseClass;

    let content = '';
    if (mode === 'icon-only' || mode === 'both') {
      content += icon || '';
    }
    if (mode === 'label-only' || mode === 'both') {
      content += `<span class="text-xs font-bold uppercase tracking-widest">${label || ''}</span>`;
    }

    return `
      <button data-action-click="${action}" ${attrString} class="${finalClass}" title="${title || label || ''}">
        ${content}
      </button>
    `;
  }
}
