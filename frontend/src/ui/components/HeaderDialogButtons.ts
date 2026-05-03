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

import { ButtonComponent } from './ButtonComponent.ts';
import { Icon } from './Icon.ts';

export class HeaderDialogButtons {
  static render(pipelineId: string, isTwoColumnLayout: boolean): string {
    return `
      <div class="flex items-center gap-2">
         ${ButtonComponent.render({
           action: 'open_search',
           extraAttrs: { 'data-pipeline-id': pipelineId },
           icon: Icon.render('search', { size: 16, className: 'group-hover:scale-110 transition-transform' }),
           title: 'Global Search (Ctrl+K)'
         })}
         ${ButtonComponent.render({
           action: 'toggle_assistant',
           icon: Icon.render('lightning', { size: 16, className: 'group-hover:scale-110 transition-transform' }),
           title: 'AI Assistant (Ctrl+Shift+A)'
         })}
         ${ButtonComponent.render({
           action: 'open_stats',
           icon: Icon.render('stats', { size: 16, className: 'group-hover:scale-110 transition-transform' }),
           title: 'Statistics (S)'
         })}
         ${ButtonComponent.render({
           action: 'open_history',
           icon: Icon.render('clock', { size: 16, className: 'group-hover:scale-110 transition-transform' }),
           title: 'History (H)'
         })}
         <div class="w-px h-4 bg-app-border mx-1"></div>
         ${ButtonComponent.render({
           action: 'toggle_layout',
           className: isTwoColumnLayout ? "bg-app-accent-1/20 border-app-accent-1/50 text-app-accent-1" : "",
           icon: Icon.render('copyRects', { size: 16, className: 'group-hover:scale-110 transition-transform' }),
           title: isTwoColumnLayout ? 'Switch to 3-Column Layout' : 'Switch to 2-Column Layout'
         })}
      </div>
    `;
  }
}
