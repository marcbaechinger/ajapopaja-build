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

export type ActionHandler = (event: Event, element: HTMLElement) => void | Promise<void>;

/** Form controls whose clicks must stay inside the control (e.g. focus/typing). */
const EDITABLE_SELECTOR =
  'input, textarea, select, option, [contenteditable=""], [contenteditable="true"]';

/**
 * Returns whether a click landed on an editable control nested inside a larger
 * clickable action element. Such a click must not activate the enclosing row
 * (for example selecting a backlog item) because re-rendering the row would
 * remove the control and drop its focus.
 *
 * A control that itself declares a click action is allowed to handle the click.
 */
function isNestedEditableControl(target: HTMLElement, actionElement: HTMLElement): boolean {
  const control = target.closest?.(EDITABLE_SELECTOR) as HTMLElement | null;
  return !!control && control !== actionElement && actionElement.contains(control);
}

export class ActionRegistry {
  private handlers: Map<string, ActionHandler> = new Map();

  constructor() {
    this.init();
  }

  private init() {
    document.body.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const actionElement = target.closest('[data-action-click]') as HTMLElement;

      if (actionElement) {
        const actionName = actionElement.getAttribute('data-action-click');
        if (actionName) {
          // Keep inline editors (such as the backlog priority input) from
          // activating their enclosing row, which would rerender it and drop
          // the control's focus.
          if (isNestedEditableControl(target, actionElement)) return;
          this.execute(actionName, event, actionElement);
        }
      }
    });

    document.body.addEventListener('change', (event) => {
      const target = event.target as HTMLElement;
      const actionElement = target.closest('[data-action-change]') as HTMLElement;

      if (actionElement) {
        const actionName = actionElement.getAttribute('data-action-change');
        if (actionName) {
          this.execute(actionName, event, actionElement);
        }
      }
    });

    document.body.addEventListener('submit', (event) => {
      const target = event.target as HTMLElement;
      const actionElement = target.closest('[data-action-submit]') as HTMLElement;

      if (actionElement) {
        const actionName = actionElement.getAttribute('data-action-submit');
        if (actionName) {
          this.execute(actionName, event, actionElement);
        }
      }
    });

    // Enter-key shortcuts (e.g. saving an editable field) are driven through
    // `data-action-keydown`. The handler only reacts to the Enter key so it
    // never hijacks normal typing inside inputs.
    document.body.addEventListener('keydown', (event) => {
      // Only handle the Enter key; everything else is left to the browser.
      if (event.key !== 'Enter') return;
      const target = event.target as HTMLElement;
      const actionElement = target.closest('[data-action-keydown]') as HTMLElement;

      if (actionElement) {
        const actionName = actionElement.getAttribute('data-action-keydown');
        if (actionName) {
          this.execute(actionName, event, actionElement);
        }
      }
    });
  }

  register(name: string, handler: ActionHandler) {
    this.handlers.set(name, handler);
  }

  async execute(name: string, event: Event, element: HTMLElement) {
    const handler = this.handlers.get(name);
    if (handler) {
      if (event.type === 'click' || event.type === 'submit' || event.type === 'keydown') {
        event.preventDefault();
      }
      event.stopPropagation();
      try {
        await handler(event, element);
      } catch (error) {
        console.error(`Error executing action "${name}":`, error);
      }
    } else {
      console.warn(`No handler registered for action: ${name}`);
    }
  }
}
