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

export type KeyAction = (event: KeyboardEvent) => void;

export interface Binding {
  /** Comma-free single key spec, e.g. 'f', 'ctrl+c', 'shift+N', '/'. */
  key: string;
  /** Logical action name (e.g. 'toggle-follow'). */
  action: string;
  /** Handler invoked when the key combination is pressed. */
  handler: KeyAction;
}

const MODIFIERS: Record<string, keyof KeyboardEvent> = {
  ctrl: 'ctrlKey',
  alt: 'altKey',
  shift: 'shiftKey',
  meta: 'metaKey',
};

/**
 * A small, dependency-free utility that binds logical actions to keyboard
 * combinations and dispatches them to a consumer. It attaches a single
 * `keydown` listener to the host element (so it stays scoped/isolated and is
 * destroyed along with the host) and supports `ctrl`, `alt`, `shift` and
 * `meta` modifiers. Keys typed while focused inside editable fields are never
 * hijacked.
 */
export class KeybindingManager {
  private bindings: Binding[] = [];
  private host: HTMLElement;
  private listener: (e: KeyboardEvent) => void;

  constructor(host: HTMLElement) {
    this.host = host;
    this.listener = (e) => this.handle(e);
    host.addEventListener('keydown', this.listener);
  }

  register(binding: Binding) {
    this.bindings.push(binding);
  }

  unregisterAll() {
    this.bindings = [];
  }

  destroy() {
    this.host.removeEventListener('keydown', this.listener);
    this.bindings = [];
  }

  private handle(e: KeyboardEvent) {
    // Don't hijack keys while the user is typing in a search/editable field.
    const target = e.target as HTMLElement | null;
    if (target && target.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    for (const b of this.bindings) {
      if (this.matchKey(e, b.key)) {
        e.preventDefault();
        b.handler(e);
        break;
      }
    }
  }

  private matchKey(e: KeyboardEvent, key: string): boolean {
    const rawParts = key.split('+');
    const lowerParts = rawParts.map((p) => p.toLowerCase());

    // Only support bindings with a single base key (plus any modifiers).
    const nonMods = lowerParts.filter((p) => !(p in MODIFIERS));
    if (nonMods.length !== 1) return false;
    const baseLower = nonMods[0];
    if (baseLower.length !== 1) return false;

    const baseIdx = rawParts.findIndex((p) => !(p.toLowerCase() in MODIFIERS));
    const base = rawParts[baseIdx];
    // An uppercase single-letter base (e.g. 'N') implies `shift` is permitted.
    const explicitShift = lowerParts.includes('shift');
    const baseIsUpper = base === base.toUpperCase() && base !== base.toLowerCase();
    const shiftAllowed = explicitShift || baseIsUpper;

    // Every declared modifier must currently be pressed; no *extra* modifiers
    // may be held (e.g. ctrl+f must not trigger the bare 'f' binding).
    for (const p of lowerParts) {
      const flag = MODIFIERS[p];
      if (flag && !e[flag as keyof KeyboardEvent]) return false;
    }
    for (const [name, flag] of Object.entries(MODIFIERS)) {
      const allowed = name === 'shift' ? shiftAllowed : lowerParts.includes(name);
      if (!allowed && e[flag as keyof KeyboardEvent]) return false;
    }

    // When `shift` is involved (explicit or implied by an uppercase base),
    // compare case-insensitively; otherwise compare the exact key so 'n' and
    // 'N' stay distinct.
    if (shiftAllowed) {
      return e.key.toLowerCase() === baseLower;
    }
    return e.key === base;
  }
}
