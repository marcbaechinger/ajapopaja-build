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

export abstract class View {
  abstract render(): string | HTMLElement;
  mount?(container: HTMLElement): void;
  unmount?(): void;
}

export type ViewConstructor = (params: Record<string, string>) => View;

export class Navigator {
  private routes: Map<string, ViewConstructor> = new Map();
  private container: HTMLElement;
  private currentView: View | null = null;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container with id "${containerId}" not found`);
    this.container = el;

    window.addEventListener('hashchange', () => this.resolve());
  }

  register(pattern: string, constructor: ViewConstructor) {
    this.routes.set(pattern, constructor);
  }

  private resolve() {
    const hash = window.location.hash || '#';
    const path = hash.substring(1) || '/';

    for (const [pattern, constructor] of this.routes.entries()) {
      const params = this.match(pattern, path);
      if (params) {
        this.navigate(constructor(params));
        return;
      }
    }

    console.warn(`No route matched for hash: ${hash}`);
  }

  private match(pattern: string, path: string): Record<string, string> | null {
    const patternParts = pattern.split('/').filter(p => p !== '');
    const pathParts = path.split('/').filter(p => p !== '');

    if (patternParts.length !== pathParts.length) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].substring(1)] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }
    return params;
  }

  private navigate(view: View) {
    if (this.currentView?.unmount) {
      this.currentView.unmount();
    }

    this.currentView = view;
    const content = view.render();
    
    if (typeof content === 'string') {
      this.container.innerHTML = content;
    } else {
      this.container.innerHTML = '';
      this.container.appendChild(content);
    }

    if (view.mount) {
      view.mount(this.container);
    }
  }

  start() {
    this.resolve();
  }
}
