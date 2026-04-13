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
