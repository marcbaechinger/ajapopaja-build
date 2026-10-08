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

import { Icon } from '../common/Icon.ts';
import { SlashCommandMenu } from './SlashCommandMenu.ts';
import {
  expandTemplate,
  filterCommands,
  findCommand,
  shouldOfferSlashMenu,
  slashQuery,
} from '../utils/slashCommands.ts';
import type { SlashCommand, SlashCommandContext } from '../utils/slashCommands.ts';

export interface InteractivePromptViewOptions {
  /** Called on Send / plain Enter with the trimmed text. Throw to signal failure. */
  onSubmit(text: string): void | Promise<void>;
  /** Slash-command scope (default 'interactive'). */
  context?: SlashCommandContext;
  /** Resolves the pipeline id used for PIPELINE_ID substitution. */
  getPipelineId?(): string | null;
  /** Handlers for action-type commands, keyed by token (e.g. { '/clear': fn }). */
  actionHandlers?: Record<string, () => void>;
  placeholder?: string;
}

/**
 * Composer for the interactive coding session: a textarea, a Send button and a
 * slash-command auto-completion menu.
 *
 * The view is deliberately dumb — it knows nothing about `PiView`, the pipeline
 * or the service. Callers provide an `onSubmit` callback and action handlers.
 */
export class InteractivePromptView {
  private readonly root: HTMLElement;
  private readonly options: InteractivePromptViewOptions;
  private readonly context: SlashCommandContext;
  private textarea: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private menu: SlashCommandMenu | null = null;
  private destroyed = false;
  private disabled = false;

  constructor(root: HTMLElement, options: InteractivePromptViewOptions) {
    this.root = root;
    this.options = options;
    this.context = options.context ?? 'interactive';
  }

  render(): void {
    if (this.destroyed) return;
    this.root.innerHTML = this.template();

    this.textarea = this.root.querySelector('#interactive-prompt-input');
    this.sendBtn = this.root.querySelector('#interactive-prompt-send');
    const menuHost = this.root.querySelector('#interactive-prompt-composer') as HTMLElement | null;

    if (menuHost) {
      this.menu = new SlashCommandMenu(menuHost);
      this.menu.render();
    }

    this.sendBtn?.addEventListener('click', () => {
      void this.submit();
    });

    this.textarea?.addEventListener('input', () => this.handleInput());
    this.textarea?.addEventListener('keydown', (event) => this.handleKeydown(event));
  }

  destroy(): void {
    this.destroyed = true;
    this.menu = null;
    this.textarea = null;
    this.sendBtn = null;
    this.root.innerHTML = '';
  }

  /** Disables/enables the textarea and Send button and closes any open menu. */
  setDisabled(disabled: boolean): void {
    const wasDisabled = this.disabled;
    this.disabled = disabled;
    if (this.textarea) this.textarea.disabled = disabled;
    if (this.sendBtn) {
      this.sendBtn.disabled = disabled;
      this.sendBtn.classList.toggle('opacity-50', disabled);
      this.sendBtn.classList.toggle('cursor-not-allowed', disabled);
    }
    if (disabled) {
      this.closeMenu();
    } else if (wasDisabled) {
      // Re-enabled after the agent finished its turn: restore focus so the
      // user can keep typing without clicking into the textarea first.
      this.focus();
    }
  }

  setPlaceholder(text: string): void {
    if (this.textarea) this.textarea.placeholder = text;
  }

  focus(): void {
    this.textarea?.focus();
  }

  getValue(): string {
    return this.textarea?.value ?? '';
  }

  /** Submits the current value (Send / plain Enter). Exposed for hosts/tests. */
  async submit(): Promise<void> {
    if (!this.textarea || this.textarea.disabled) return;
    const text = this.textarea.value.trim();
    if (!text) return;

    try {
      await this.options.onSubmit(text);
      if (this.textarea) this.textarea.value = '';
      this.closeMenu();
    } catch (e) {
      console.error('Failed to send message:', e);
      alert('Failed to send message.');
    }
  }

  private handleInput(): void {
    if (!this.textarea || !this.menu) return;
    const value = this.textarea.value;
    if (shouldOfferSlashMenu(value)) {
      this.menu.open(filterCommands(slashQuery(value), this.context));
    } else {
      this.menu.close();
    }
    this.updateAriaActiveDescendant();
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (this.menu?.isOpen()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeMenu();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.menu.move(1);
        this.updateAriaActiveDescendant();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.menu.move(-1);
        this.updateAriaActiveDescendant();
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.accept(this.menu.highlighted());
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.submit();
    }
  }

  /** Executes an action or expands a prompt template for the given command. */
  private accept(command: SlashCommand | null): void {
    if (!command || !this.textarea) return;
    const resolved = findCommand(command.command, this.context) ?? command;

    if (resolved.type === 'action') {
      this.options.actionHandlers?.[resolved.command]?.();
      this.textarea.value = '';
      this.closeMenu();
      this.textarea.focus();
      return;
    }

    const pipelineId = this.options.getPipelineId?.() ?? null;
    const expanded = expandTemplate(resolved.template ?? '', pipelineId);
    this.textarea.value = expanded;
    this.textarea.setSelectionRange(expanded.length, expanded.length);
    this.closeMenu();
    this.textarea.focus();
  }

  private closeMenu(): void {
    this.menu?.close();
    this.updateAriaActiveDescendant();
  }

  private updateAriaActiveDescendant(): void {
    if (!this.textarea) return;
    const id = this.menu?.highlightedId() ?? null;
    if (id) {
      this.textarea.setAttribute('aria-activedescendant', id);
    } else {
      this.textarea.removeAttribute('aria-activedescendant');
    }
  }

  private template(): string {
    const placeholder = this.options.placeholder ?? 'Describe the change the agent should make…';
    return `
      <div id="interactive-prompt-composer" class="flex items-end gap-2">
        <textarea id="interactive-prompt-input" rows="2"
          class="flex-1 resize-y px-3 py-2 rounded-lg text-xs bg-black/30 border border-app-border text-app-text placeholder:text-app-muted/60 focus:outline-none focus:border-app-accent-2/60"
          placeholder="${placeholder}"></textarea>
        <button id="interactive-prompt-send" type="button"
          class="px-3 py-2 rounded text-xs font-medium bg-app-accent-2 text-white hover:bg-app-accent-2/80 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer">
          ${Icon.render('arrowRight', { size: 14 })} Send
        </button>
      </div>
    `;
  }
}
