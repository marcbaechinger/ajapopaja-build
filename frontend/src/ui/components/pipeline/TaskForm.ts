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

export class TaskForm {
  static render(): string {
    return `
      <form id="create_task" data-action-submit="create_task" class="flex items-center w-64">
        <input type="text" id="task-title" name="task_title" placeholder="What needs to be done?"
               class="w-full h-10 bg-app-bg border border-app-border rounded-xl px-3.5 focus:ring-2 focus:ring-app-accent-1 outline-none text-app-text transition-all text-sm shadow-sm min-w-0 box-border"
               required>
      </form>
    `;
  }
}
