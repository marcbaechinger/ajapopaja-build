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
  }

  register(name: string, handler: ActionHandler) {
    this.handlers.set(name, handler);
  }

  async execute(name: string, event: Event, element: HTMLElement) {
    const handler = this.handlers.get(name);
    if (handler) {
      if (event.type === 'click' || event.type === 'submit') {
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
