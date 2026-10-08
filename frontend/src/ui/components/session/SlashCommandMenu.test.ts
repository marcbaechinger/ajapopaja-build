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

import { describe, it, expect, beforeEach } from 'vitest';
import { SlashCommandMenu } from './SlashCommandMenu.ts';
import { SLASH_COMMANDS } from '../utils/slashCommands.ts';

describe('SlashCommandMenu', () => {
  let host: HTMLElement;
  let menu: SlashCommandMenu;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    menu = new SlashCommandMenu(host);
    menu.render();
  });

  it('marks the host as a positioning context', () => {
    expect(host.classList.contains('relative')).toBe(true);
  });

  it('renders options and highlights the first on open', () => {
    const commands = SLASH_COMMANDS.slice(0, 3);
    menu.open(commands);

    expect(menu.isOpen()).toBe(true);
    expect(host.querySelector('[role="listbox"]')).toBeTruthy();
    const options = host.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(3);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(menu.highlighted()?.command).toBe(commands[0].command);
  });

  it('moves the highlight and wraps around', () => {
    menu.open(SLASH_COMMANDS.slice(0, 2));

    menu.move(1);
    expect(menu.highlighted()?.command).toBe(SLASH_COMMANDS[1].command);
    menu.move(1);
    expect(menu.highlighted()?.command).toBe(SLASH_COMMANDS[0].command);
    menu.move(-1);
    expect(menu.highlighted()?.command).toBe(SLASH_COMMANDS[1].command);
  });

  it('closes and clears', () => {
    menu.open(SLASH_COMMANDS.slice(0, 2));
    menu.close();

    expect(menu.isOpen()).toBe(false);
    expect(menu.highlighted()).toBeNull();
    expect(menu.highlightedId()).toBeNull();
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it('exposes an id that references the highlighted option', () => {
    menu.open(SLASH_COMMANDS.slice(0, 2));

    const id = menu.highlightedId();
    expect(id).toBeTruthy();
    expect(host.querySelector(`#${id}`)?.getAttribute('aria-selected')).toBe('true');
  });

  it('does not open when given no matches', () => {
    menu.open([]);
    expect(menu.isOpen()).toBe(false);
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
  });
});
