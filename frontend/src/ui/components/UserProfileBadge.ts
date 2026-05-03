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

import type { User } from '../../core/domain.ts';
import { Icon } from './Icon.ts';

export class UserProfileBadge {
  static render(user: User | null): string {
    return `
      <div class="flex items-center gap-3 bg-app-bg px-3 py-1.5 rounded-xl border border-app-border h-[40px]">
        <span class="text-xs font-bold text-app-text tracking-tight">${user?.username || 'User'}</span>
        <div class="w-px h-4 bg-app-border mx-1"></div>
        <button data-action-click="perform_logout" class="p-1 hover:bg-red-500/10 text-app-muted hover:text-red-400 rounded-lg transition-all cursor-pointer group/logout" title="Logout">
          ${Icon.render('logout', { size: 14, className: 'group-hover/logout:scale-110 transition-transform' })}
        </button>
      </div>
    `;
  }
}
