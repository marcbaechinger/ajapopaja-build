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
  AMBER_DARK_PALETTE,
  BASE_DARK_TOKENS,
  DARK_PALETTE,
  DEFAULT_THEME_FOR_VARIANT,
  PI_VIEW_THEMES,
  applyTheme,
  defineTheme,
  derivePiviewTheme,
  resolveTheme,
  validateTheme,
  type PiViewTheme,
  type PiViewVariant,
} from './piviewThemes.ts';
import { PiView, type PiSessionService } from './PiView.ts';
import type { RenderBlock } from '../../../core/CoderBotService.ts';
import piViewCss from './PiView.css?raw';
import piviewThemesSource from './piviewThemes.ts?raw';

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

function serviceWithHistoryAndOverrides(
  history: RenderBlock[],
  overrides: Partial<PiSessionService>
): PiSessionService {
  return { ...serviceWithHistory(history), ...overrides };
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

  it('resolves explicit theme -> variant default -> batch-default', () => {
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
    expect(PI_VIEW_THEMES['batch-terminal']).toBe(PI_VIEW_THEMES['batch-default']);
    expect(PI_VIEW_THEMES['interactive-chat']).toBe(
      PI_VIEW_THEMES['interactive-default']
    );
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
    expect(view.getThemeId()).toBe('batch-default');
    expect(log.getAttribute('data-piview-theme')).toBe('batch-default');
    expect(listener).toHaveBeenCalledWith('batch-default');

    unsubscribe();
    view.setTheme(custom.id);
    expect(listener).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('uses each variant default when the host mounts without an explicit theme', () => {
    for (const [variant, themeId] of [
      ['batch', 'batch-default'],
      ['interactive', 'interactive-default'],
    ] as Array<[PiViewVariant, string]>) {
      const view = new PiView(serviceWithHistory(), mount(), { variant });
      view.render();
      const log = view.getRoot().querySelector('#log-content-container') as HTMLElement;
      expect(view.getVariant()).toBe(variant);
      expect(view.getThemeId()).toBe(themeId);
      expect(log.getAttribute('data-piview-variant')).toBe(variant);
      expect(log.getAttribute('data-piview-theme')).toBe(themeId);
      view.destroy();
      view.getRoot().remove();
    }
  });

  it('falls back to the service getSessionKind hint only when variant is omitted', () => {
    let kind: PiViewVariant = 'interactive';
    const stateListeners = new Set<(active: boolean) => void>();
    const service = serviceWithHistoryAndOverrides([], {
      getSessionKind: () => kind,
      onSessionStateChange: (listener) => {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
      },
    });

    const view = new PiView(service, mount());
    view.render();
    const log = view.getRoot().querySelector('#log-content-container') as HTMLElement;
    expect(view.getVariant()).toBe('interactive');
    expect(view.getThemeId()).toBe('interactive-default');
    expect(log.getAttribute('data-piview-variant')).toBe('interactive');

    // A session state change re-resolves the optional hint and its default theme.
    kind = 'batch';
    stateListeners.forEach((listener) => listener(true));
    expect(view.getVariant()).toBe('batch');
    expect(view.getThemeId()).toBe('batch-default');
    expect(log.getAttribute('data-piview-variant')).toBe('batch');
    expect(log.getAttribute('data-piview-theme')).toBe('batch-default');
    view.destroy();

    // An explicit host variant always wins over the service hint.
    const explicit = new PiView(serviceWithHistoryAndOverrides([], {
      getSessionKind: () => 'interactive',
    }), mount(), { variant: 'batch' });
    explicit.render();
    expect(explicit.getVariant()).toBe('batch');
    expect(explicit.getThemeId()).toBe('batch-default');
    explicit.destroy();
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

describe('palette-derived syntax and search roles', () => {
  const dark = derivePiviewTheme(DARK_PALETTE, 'compact');
  const ember = derivePiviewTheme(AMBER_DARK_PALETTE, 'compact');
  const darkValues = dark as Record<string, string>;
  const emberValues = ember as Record<string, string>;
  const derivedNames = Object.keys(dark).filter((name) =>
    /^--piview-(?:syntax|search)-/.test(name)
  );

  it('derives all ten syntax roles plus the five search roles', () => {
    expect(
      derivedNames.filter((name) => name.startsWith('--piview-syntax-'))
    ).toHaveLength(10);
    expect(
      derivedNames.filter((name) => name.startsWith('--piview-search-'))
    ).toHaveLength(5);
  });

  it('changes every syntax and search token when the palette changes', () => {
    for (const name of derivedNames) {
      expect(emberValues[name], `${name} did not follow the palette`).not.toBe(
        darkValues[name]
      );
    }
  });

  it('contains no literal hue in derivePiviewTheme beyond neutral #000', () => {
    const start = piviewThemesSource.indexOf('export function derivePiviewTheme');
    const end = piviewThemesSource.indexOf('export const BASE_DARK_TOKENS', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const body = piviewThemesSource.slice(start, end);
    const literals = Array.from(
      body.matchAll(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g),
      (match) => match[0].toLowerCase()
    );
    for (const literal of literals) {
      expect(['#000', 'transparent'], `${literal} is a hard-coded hue`).toContain(literal);
    }
  });
});

/**
 * The CSS token guard is registry-driven: adding a theme to PI_VIEW_THEMES is
 * enough for it to be checked. Comments are stripped so prose in the
 * stylesheet cannot masquerade as a declaration or reference.
 */
const PI_VIEW_CSS_SOURCE = piViewCss.replace(/\/\*[\s\S]*?\*\//g, '');

function cssTokenReferences(css: string): Set<string> {
  return new Set(
    Array.from(css.matchAll(/var\(\s*(--piview-[a-z0-9-]+)/g), (match) => match[1])
  );
}

function cssTokenDeclarations(css: string): Set<string> {
  return new Set(
    Array.from(css.matchAll(/(--piview-[a-z0-9-]+)\s*:/g), (match) => match[1])
  );
}

describe('PiView theme token guard', () => {
  it('provides every token referenced by PiView.css from each theme or its defaults', () => {
    const referenced = cssTokenReferences(PI_VIEW_CSS_SOURCE);
    const defaults = cssTokenDeclarations(PI_VIEW_CSS_SOURCE);

    // Guard the guard: if the stylesheet stops using tokens, this test would
    // otherwise pass vacuously.
    expect(referenced.size).toBeGreaterThan(0);

    for (const theme of Object.values(PI_VIEW_THEMES)) {
      for (const name of referenced) {
        const providedByTheme = Object.prototype.hasOwnProperty.call(theme.tokens, name);
        expect(
          providedByTheme || defaults.has(name),
          `${theme.id} does not provide ${name} and PiView.css has no derivation default`
        ).toBe(true);
      }
    }
  });

  it('resolves every derived role for a theme that supplies only the six base knobs', () => {
    const sixBaseTokens = {
      '--piview-bg': '#101820',
      '--piview-fg': '#e2e8f0',
      '--piview-accent': '#60a5fa',
      '--piview-accent-2': '#a78bfa',
      '--piview-fg-error': '#f87171',
      '--piview-fg-ok': '#4ade80',
    };
    const minimal = registerTestTheme(
      defineTheme({
        id: 'test-minimal-six',
        label: 'Minimal six-token theme',
        variants: ['batch', 'interactive'],
        tokens: sixBaseTokens,
      })
    );

    const view = new PiView(serviceWithHistory(), mount(), {
      variant: 'batch',
      theme: minimal.id,
    });
    view.render();
    const log = view.getRoot().querySelector('#log-content-container') as HTMLElement;
    const computed = getComputedStyle(log);
    const referenced = cssTokenReferences(PI_VIEW_CSS_SOURCE);

    for (const name of referenced) {
      if (Object.prototype.hasOwnProperty.call(sixBaseTokens, name)) continue;
      expect(
        computed.getPropertyValue(name).trim(),
        `${name} did not resolve from the derivation defaults`
      ).not.toBe('');
    }

    view.destroy();
  });
});

describe('interactive-default theme', () => {
  it('is the interactive default with chat density, measure and motion hooks', () => {
    const chat = PI_VIEW_THEMES[DEFAULT_THEME_FOR_VARIANT.interactive];
    expect(chat.id).toBe('interactive-default');
    expect(chat.variants).toContain('interactive');

    const batch = PI_VIEW_THEMES[DEFAULT_THEME_FOR_VARIANT.batch];
    expect(chat.tokens['--piview-radius-block']).toBe('10px');
    expect(chat.tokens['--piview-max-width']).toBe('72ch');
    expect(chat.tokens['--piview-block-gap']).not.toBe(batch.tokens['--piview-block-gap']);
    expect(chat.tokens['--piview-surface-formatted-active']).not.toBe(
      batch.tokens['--piview-surface-formatted-active']
    );
    expect(chat.tokens['--piview-motion-pulse']).toBeTruthy();
    expect(chat.css).toMatch(/piview-chat-fade-in/);
    expect(chat.css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
