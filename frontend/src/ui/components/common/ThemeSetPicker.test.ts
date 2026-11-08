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

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionRegistry } from '../../../core/ActionRegistry.ts';
import { ThemeSetPicker } from './ThemeSetPicker.ts';
import {
  DEFAULT_THEME_SET,
  THEME_SETS,
  themeManager,
} from '../../theme/themeSets.ts';

describe('ThemeSetPicker', () => {
  let registry: ActionRegistry;
  let setSpy: (setId: string | null) => void;
  let picker: ThemeSetPicker;
  let root: HTMLElement;

  beforeAll(() => {
    registry = new ActionRegistry();
  });

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-set');
    document.documentElement.removeAttribute('style');
    themeManager.setSet(DEFAULT_THEME_SET);
    themeManager.setMode('dark');

    setSpy = vi.fn<(setId: string | null) => void>();
    registry.register('set_theme_set', (_event, element) => {
      const setId = element.getAttribute('data-theme-set-id');
      setSpy(setId);
      if (setId) themeManager.setSet(setId);
    });

    picker = new ThemeSetPicker();
    root = document.createElement('div');
    root.innerHTML = picker.render();
    document.body.appendChild(root);
    picker.mount(root);
  });

  afterEach(() => {
    picker.destroy();
    root.remove();
    document.body.innerHTML = '';
    delete THEME_SETS.temporary;
  });

  const trigger = () => root.querySelector<HTMLButtonElement>('[data-theme-set-picker-trigger]')!;
  const menu = () => root.querySelector<HTMLElement>('[data-theme-set-menu]')!;
  const rows = () => Array.from(root.querySelectorAll<HTMLElement>('[data-theme-set-row]'));

  it('renders every registered set with label, swatch and active state', () => {
    expect(rows()).toHaveLength(Object.keys(THEME_SETS).length);
    for (const set of Object.values(THEME_SETS)) {
      expect(root.textContent).toContain(set.label);
    }
    const swatch = rows()[0].querySelector('[data-theme-set-swatch]')!;
    expect(swatch.querySelectorAll('[data-palette-role]')).toHaveLength(3);

    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(menu().hidden).toBe(true);

    const active = root.querySelector('[data-theme-set-id="default"]')!;
    expect(active.getAttribute('aria-checked')).toBe('true');
    expect(active.getAttribute('data-theme-set-active')).toBe('true');
    expect(active.classList.contains('theme-set-option-active')).toBe(true);
    expect(root.querySelector('[data-theme-set-id="ember"]')!.getAttribute('aria-checked')).toBe(
      'false'
    );
  });

  it('opens on the trigger and focuses the active row', () => {
    picker.toggle();

    expect(picker.isOpen()).toBe(true);
    expect(menu().hidden).toBe(false);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(root.querySelector('[data-theme-set-id="default"]'));
  });

  it('dispatches set_theme_set on row selection, closes and moves the highlight', () => {
    picker.toggle();
    const ember = root.querySelector<HTMLElement>('[data-theme-set-id="ember"]')!;
    ember.click();

    expect(setSpy).toHaveBeenCalledWith('ember');
    expect(themeManager.getActiveSetId()).toBe('ember');
    expect(picker.isOpen()).toBe(false);
    expect(menu().hidden).toBe(true);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    picker.toggle();
    expect(root.querySelector('[data-theme-set-id="ember"]')!.getAttribute('aria-checked')).toBe(
      'true'
    );
    expect(root.querySelector('[data-theme-set-id="default"]')!.getAttribute('aria-checked')).toBe(
      'false'
    );
  });

  it('returns focus to the trigger when a set row is selected', () => {
    picker.toggle();
    const ember = root.querySelector<HTMLElement>('[data-theme-set-row="ember"]')!;
    ember.focus();
    expect(document.activeElement).toBe(ember);

    ember.click();

    expect(picker.isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger());
    expect(themeManager.getActiveSetId()).toBe('ember');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    picker.toggle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(picker.isOpen()).toBe(false);
    expect(menu().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on an outside click but not on an inside click', () => {
    picker.toggle();
    menu().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(picker.isOpen()).toBe(true);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(picker.isOpen()).toBe(false);
    expect(menu().hidden).toBe(true);
  });

  it('moves with arrow keys and selects with Enter', () => {
    picker.toggle();
    const first = root.querySelector<HTMLElement>('[data-theme-set-id="default"]')!;
    const second = root.querySelector<HTMLElement>('[data-theme-set-id="ember"]')!;
    expect(document.activeElement).toBe(first);

    menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(second);

    menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(first);

    second.focus();
    menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith('ember');
    expect(themeManager.getActiveSetId()).toBe('ember');
  });

  it('offers a light/dark mode control inside the popover', () => {
    picker.toggle();
    const light = root.querySelector<HTMLElement>('[data-theme-mode="light"]')!;
    expect(light.getAttribute('aria-pressed')).toBe('false');

    light.click();
    expect(themeManager.getActiveMode()).toBe('light');
    expect(picker.isOpen()).toBe(true);
    expect(
      root.querySelector('[data-theme-mode="light"]')!.getAttribute('aria-pressed')
    ).toBe('true');
    expect(themeManager.getActiveSetId()).toBe(DEFAULT_THEME_SET);
  });

  it('disables a mode control the active single-mode set does not support', () => {
    const base = THEME_SETS[DEFAULT_THEME_SET];
    THEME_SETS.temporary = {
      ...base,
      id: 'temporary',
      label: 'Temporary dark',
      mode: 'dark',
      palette: { dark: base.palette.dark },
      appTokens: { dark: base.appTokens.dark },
      interactiveTheme: { dark: base.interactiveTheme.dark },
      batchTheme: { dark: base.batchTheme.dark },
    };

    themeManager.setMode('light');
    themeManager.setSet('temporary');
    picker.refresh();
    picker.toggle();

    const light = root.querySelector<HTMLButtonElement>('[data-theme-mode="light"]')!;
    const dark = root.querySelector<HTMLButtonElement>('[data-theme-mode="dark"]')!;
    expect(themeManager.getActiveMode()).toBe('dark');
    expect(light.disabled).toBe(true);
    expect(light.getAttribute('aria-disabled')).toBe('true');
    expect(light.getAttribute('data-theme-mode-supported')).toBe('false');
    expect(light.title).toContain('not supported');
    expect(dark.disabled).toBe(false);
    expect(dark.getAttribute('aria-pressed')).toBe('true');
  });
});
