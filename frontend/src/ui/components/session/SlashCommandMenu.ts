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

import type { SlashCommand } from '../utils/slashCommands.ts';
import { escapeHtml } from '../utils/html.ts';

/**
 * Auto-completion dropdown for slash commands.
 *
 * The widget renders a `role="listbox"` into a host element (which is made
 * `relative`) and anchors it above the composer. It deliberately keeps no
 * reference to the textarea: the host owns the keyboard wiring and drives the
 * menu through {@link open}, {@link close}, {@link move} and {@link highlighted}.
 */
export class SlashCommandMenu {
  private static nextId = 0;
  private readonly idPrefix: string;
  private readonly host: HTMLElement;
  private readonly menuEl: HTMLElement;
  private commands: SlashCommand[] = [];
  private highlightIndex = -1;

  constructor(host: HTMLElement) {
    this.host = host;
    this.host.classList.add('relative');
    this.idPrefix = `slash-command-menu-${SlashCommandMenu.nextId++}`;
    this.menuEl = document.createElement('div');
    this.menuEl.id = this.idPrefix;
    this.menuEl.className =
      'absolute bottom-full left-0 right-0 mb-2 max-h-56 overflow-y-auto custom-scrollbar rounded-xl border border-app-border bg-app-surface shadow-2xl z-20 py-1';
    this.menuEl.setAttribute('role', 'listbox');
    this.menuEl.hidden = true;
    this.host.appendChild(this.menuEl);
  }

  /** (Re-)renders the current matches. Safe to call at any time. */
  render(): void {
    if (!this.isOpen()) {
      this.menuEl.hidden = true;
      this.menuEl.innerHTML = '';
      return;
    }

    this.menuEl.hidden = false;
    this.menuEl.innerHTML = this.commands
      .map((command, index) => {
        const selected = index === this.highlightIndex;
        const selectedClasses = selected
          ? 'bg-app-accent-2/15 text-app-text'
          : 'text-app-muted';
        return `
          <div id="${this.optionId(index)}" role="option" aria-selected="${selected}"
            data-index="${index}"
            class="flex items-baseline gap-2 px-3 py-2 cursor-pointer transition-colors hover:bg-app-accent-2/10 ${selectedClasses}">
            <span class="font-mono font-bold text-app-accent-2 shrink-0">${escapeHtml(command.command)}</span>
            <span class="text-[11px] truncate">${escapeHtml(command.description)}</span>
          </div>
        `;
      })
      .join('');
  }

  /** Opens the menu with the given matches and highlights the first item. */
  open(commands: SlashCommand[]): void {
    this.commands = commands;
    this.highlightIndex = commands.length > 0 ? 0 : -1;
    this.render();
  }

  /** Closes (and clears) the menu. */
  close(): void {
    this.commands = [];
    this.highlightIndex = -1;
    this.render();
  }

  /** Whether the menu currently has matches to show. */
  isOpen(): boolean {
    return this.commands.length > 0;
  }

  /** The currently highlighted command, if any. */
  highlighted(): SlashCommand | null {
    if (this.highlightIndex < 0 || this.highlightIndex >= this.commands.length) return null;
    return this.commands[this.highlightIndex];
  }

  /** The id of the highlighted option (for `aria-activedescendant`), if any. */
  highlightedId(): string | null {
    if (!this.isOpen() || this.highlightIndex < 0) return null;
    return this.optionId(this.highlightIndex);
  }

  /** Moves the highlight by `delta`, wrapping around. */
  move(delta: number): void {
    const count = this.commands.length;
    if (count === 0) return;
    this.highlightIndex = (((this.highlightIndex + delta) % count) + count) % count;
    this.render();
  }

  private optionId(index: number): string {
    return `${this.idPrefix}-option-${index}`;
  }
}
