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

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BASE_DARK_TOKENS,
  DEFAULT_THEME_FOR_VARIANT,
  PI_VIEW_THEMES,
  applyTheme,
  defineTheme,
  resolveTheme,
  validateTheme,
  type PiViewTheme,
  type PiViewVariant,
} from './piviewThemes.ts';
import { PiView, type PiSessionService } from './PiView.ts';
import type { RenderBlock } from '../../../core/CoderBotService.ts';

function serviceWithHistory(history: RenderBlock[] = []): PiSessionService {
  return {
    getHistory: () => history,
    getCurrentTaskId: () => null,
    isActive: () => false,
    getSessionStartTime: () => null,
    onSessionStartTimeChange: () => () => {},
    clearHistory: () => {},
    stopSession: async () => {},
    onBlocks: () => () => {},
    onMessage: () => () => {},
    onSessionStateChange: () => () => {},
  };
}

function mount(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const testThemes: string[] = [];

function registerTestTheme(theme: PiViewTheme): PiViewTheme {
  PI_VIEW_THEMES[theme.id] = theme;
  testThemes.push(theme.id);
  return theme;
}

afterEach(() => {
  for (const id of testThemes.splice(0)) delete PI_VIEW_THEMES[id];
  document.body.innerHTML = '';
  document
    .querySelectorAll('style[data-piview-theme]')
    .forEach((el) => el.remove());
  vi.restoreAllMocks();
});

describe('PiView theme registry', () => {
  it('ships frozen, valid builtins and a default for every variant', () => {
    expect(Object.keys(PI_VIEW_THEMES).length).toBeGreaterThan(0);
    for (const theme of Object.values(PI_VIEW_THEMES)) {
      expect(validateTheme(theme)).toEqual([]);
      expect(Object.isFrozen(theme)).toBe(true);
      for (const variant of theme.variants) expect(['batch', 'interactive']).toContain(variant);
    }
    for (const variant of ['batch', 'interactive'] as PiViewVariant[]) {
      expect(PI_VIEW_THEMES[DEFAULT_THEME_FOR_VARIANT[variant]]).toBeDefined();
    }
  });

  it('defines a partial theme, fills its description and rejects a bad shape', () => {
    const custom = defineTheme({
      id: 'test-partial',
      label: 'Partial',
      variants: ['batch'],
      tokens: { '--piview-bg': '#123456' },
    });
    expect(custom.description).toBe('Partial');
    expect(custom.tokens['--piview-bg']).toBe('#123456');
    expect(validateTheme(custom)).toEqual([]);

    expect(() =>
      defineTheme({ id: 'Bad Id', label: 'Bad', variants: ['batch'], tokens: {} })
    ).toThrow();
    expect(() =>
      defineTheme({ id: 'bad-variant', label: 'Bad', variants: ['other' as PiViewVariant], tokens: {} })
    ).toThrow();
  });

  it('resolves explicit theme -> variant default -> batch-terminal', () => {
    const custom = registerTestTheme(
      defineTheme({
        id: 'test-resolution',
        label: 'Resolution',
        variants: ['batch'],
        tokens: { '--piview-bg': '#111111' },
      })
    );

    expect(resolveTheme('batch', custom.id)).toBe(custom);
    expect(resolveTheme('batch')).toBe(PI_VIEW_THEMES[DEFAULT_THEME_FOR_VARIANT.batch]);
    expect(resolveTheme('interactive')).toBe(
      PI_VIEW_THEMES[DEFAULT_THEME_FOR_VARIANT.interactive]
    );
    expect(resolveTheme('batch', 'test-does-not-exist')).toBe(
      PI_VIEW_THEMES[DEFAULT_THEME_FOR_VARIANT.batch]
    );
    expect(PI_VIEW_THEMES.batchTerminal).toBeUndefined();
    expect(PI_VIEW_THEMES['batch-terminal']).toBeDefined();
  });

  it('applies tokens to one element and removes stale overrides on switch', () => {
    const first = registerTestTheme(
      defineTheme({
        id: 'test-apply-first',
        label: 'First',
        variants: ['batch'],
        tokens: { '--piview-bg': '#010101', '--piview-fg': '#020202' },
      })
    );
    const second = registerTestTheme(
      defineTheme({
        id: 'test-apply-second',
        label: 'Second',
        variants: ['batch'],
        tokens: { '--piview-bg': '#030303' },
      })
    );

    const el = document.createElement('div');
    applyTheme(el, first);
    expect(el.getAttribute('data-piview-theme')).toBe(first.id);
    expect(el.style.getPropertyValue('--piview-bg')).toBe('#010101');
    expect(el.style.getPropertyValue('--piview-fg')).toBe('#020202');

    applyTheme(el, second);
    expect(el.getAttribute('data-piview-theme')).toBe(second.id);
    expect(el.style.getPropertyValue('--piview-bg')).toBe('#030303');
    expect(el.style.getPropertyValue('--piview-fg')).toBe('');
  });

  it('injects a theme css block once and scopes it under the theme attribute', () => {
    const custom = registerTestTheme(
      defineTheme({
        id: 'test-css',
        label: 'CSS',
        variants: ['batch'],
        tokens: {},
        css: '.piview-log { background-image: linear-gradient(red, blue); }',
      })
    );

    const a = document.createElement('div');
    const b = document.createElement('div');
    applyTheme(a, custom);
    applyTheme(b, custom);
    const styles = document.querySelectorAll('style[data-piview-theme="test-css"]');
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toContain('[data-piview-theme="test-css"] .piview-log');
  });

  it('wires options.theme and setTheme() into PiView without a re-render', () => {
    const custom = registerTestTheme(
      defineTheme({
        id: 'test-options-theme',
        label: 'Options',
        variants: ['batch'],
        tokens: { ...BASE_DARK_TOKENS, '--piview-bg': '#0a0b0c' },
      })
    );

    const view = new PiView(serviceWithHistory(), mount(), {
      variant: 'batch',
      theme: custom.id,
    });
    view.render();
    const log = view.getRoot().querySelector('#log-content-container') as HTMLElement;
    expect(view.getVariant()).toBe('batch');
    expect(view.getThemeId()).toBe(custom.id);
    expect(log.getAttribute('data-piview-theme')).toBe(custom.id);
    expect(log.style.getPropertyValue('--piview-bg')).toBe('#0a0b0c');

    const listener = vi.fn();
    const unsubscribe = view.onThemeChange(listener);
    view.setTheme('batch-terminal');
    expect(view.getThemeId()).toBe('batch-terminal');
    expect(log.getAttribute('data-piview-theme')).toBe('batch-terminal');
    expect(listener).toHaveBeenCalledWith('batch-terminal');

    unsubscribe();
    view.setTheme(custom.id);
    expect(listener).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('falls back for an unknown id and warns only once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = new PiView(serviceWithHistory(), mount(), {
      variant: 'batch',
      theme: 'unknown-for-test',
    });
    view.render();
    expect(view.getThemeId()).toBe(DEFAULT_THEME_FOR_VARIANT.batch);
    view.setTheme('unknown-for-test');
    view.setTheme('unknown-for-test');
    expect(warn).toHaveBeenCalledTimes(1);
    view.destroy();
  });
});
