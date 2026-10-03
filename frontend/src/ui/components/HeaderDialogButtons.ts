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
import { SessionManagerButton } from './SessionManagerButton.ts';

export class HeaderDialogButtons {
  static render(pipelineId: string): string {
    return `
      <div class="flex items-center gap-2">
         ${ButtonComponent.render({
           action: 'open_search',
           extraAttrs: { 'data-pipeline-id': pipelineId },
           icon: Icon.render('search', { size: 16, className: 'group-hover:scale-110 transition-transform' }),
           title: 'Global Search (Ctrl+K)'
         })}
         <span data-pipeline-id="${pipelineId}">${SessionManagerButton.render({ compact: true })}</span>
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
      </div>
    `;
  }
}
