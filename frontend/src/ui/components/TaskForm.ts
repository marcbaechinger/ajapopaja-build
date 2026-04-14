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
      <section class="bg-app-surface/50 p-5 rounded-2xl border border-app-border/50 shadow-inner mb-6">
        <form data-action-submit="create_task" class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] font-black text-app-muted uppercase tracking-widest px-1">Quick Add Task</label>
            <div class="flex flex-col sm:flex-row gap-2">
              <input type="text" id="task-title" placeholder="What needs to be done?" 
                     class="flex-grow bg-app-bg border border-app-border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-app-accent-1 outline-none text-app-text transition-all text-sm shadow-sm min-w-0"
                     required>
              <button type="submit" 
                      class="bg-app-accent-1 hover:brightness-110 text-white font-black px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-app-accent-1/20 cursor-pointer text-sm uppercase tracking-tight whitespace-nowrap">
                Add
              </button>
            </div>
          </div>
        </form>
      </section>
    `;
  }
}
