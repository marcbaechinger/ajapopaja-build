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
  /**
   * Optional in-place update hook. When the same route pattern matches an
   * already-mounted view, `resolve()` calls `update(params)` and only reuses
   * the view when it returns `true`. This lets views own their sub-routes
   * (e.g. the content tab encoded in the hash) without being torn down and
   * re-created on every hash change. Returning `false` forces a full
   * `unmount()`/`render()`/`mount()` cycle.
   */
  update?(params: Record<string, string>): boolean;
}

export type ViewConstructor = (params: Record<string, string>) => View;

export class Navigator {
  private routes: Map<string, ViewConstructor> = new Map();
  private container: HTMLElement;
  private currentView: View | null = null;
  private currentPattern: string | null = null;

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
      if (!params) continue;

      // Same route pattern → let the mounted view decide whether it can absorb
      // the new sub-route in place (e.g. a tab / file-browser path change)
      // instead of being torn down and re-created.
      if (
        this.currentPattern === pattern &&
        this.currentView?.update?.(params) === true
      ) {
        return;
      }

      this.navigate(constructor(params), pattern);
      return;
    }

    console.warn(`No route matched for hash: ${hash}`);
  }

  private match(pattern: string, path: string): Record<string, string> | null {
    const patternParts = pattern.split('/').filter(p => p !== '');
    const pathParts = path.split('/').filter(p => p !== '');

    // An optional trailing `*` captures zero or more remaining segments into
    // `params.rest` so a stable pattern such as `/pipeline/:id/*` can serve both
    // the bare route and its sub-routes without re-mounting the view.
    const splat = patternParts[patternParts.length - 1] === '*';
    const fixed = splat ? patternParts.length - 1 : patternParts.length;

    if (splat ? pathParts.length < fixed : pathParts.length !== fixed) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < fixed; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].substring(1)] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }
    if (splat) {
      params.rest = pathParts.slice(fixed).join('/');
    }
    return params;
  }

  private navigate(view: View, pattern: string) {
    if (this.currentView?.unmount) {
      this.currentView.unmount();
    }

    this.currentView = view;
    this.currentPattern = pattern;
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
