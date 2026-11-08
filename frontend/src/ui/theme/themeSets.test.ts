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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DENSITY_COMPACT,
  DENSITY_ROOMY,
  DEFAULT_THEME_SET,
  THEME_SETS,
  THEME_SET_STORAGE_KEY,
  ThemeManager,
  deriveAppTokens,
  derivePiviewTheme,
  themeManager,
  validateThemeSet,
  type PalettePrimitives,
  type ThemeSet,
} from './themeSets.ts';
import {
  PI_VIEW_THEMES,
  resolveTheme,
  validateTheme,
  type PiViewTheme,
} from '../components/session/piviewThemes.ts';
import { PiView, type PiSessionService } from '../components/session/PiView.ts';
import type { RenderBlock } from '../../core/CoderBotService.ts';
import styleCss from '../../style.css?raw';

const DARK_TOKENS = {
  '--app-bg': 'var(--color-slate-950)',
  '--app-surface': 'var(--color-slate-900)',
  '--app-text': 'var(--color-slate-100)',
  '--app-muted': 'var(--color-slate-400)',
  '--app-border': 'var(--color-slate-800)',
  '--app-accent-1': 'var(--color-sky-400)',
  '--app-accent-2': 'var(--color-cyan-400)',
  '--app-accent-fg': 'var(--color-slate-950)',
};

const LIGHT_TOKENS = {
  '--app-bg': 'var(--color-slate-50)',
  '--app-surface': 'var(--color-white)',
  '--app-text': 'var(--color-slate-900)',
  '--app-muted': 'var(--color-slate-500)',
  '--app-border': 'var(--color-slate-200)',
  '--app-accent-1': 'var(--color-sky-700)',
  '--app-accent-2': 'var(--color-cyan-700)',
  '--app-accent-fg': 'var(--color-slate-50)',
};

function tokenValue(theme: PiViewTheme, name: string): string | undefined {
  return (theme.tokens as Record<string, string>)[name];
}

function numericToken(theme: PiViewTheme, name: string): number {
  const raw = tokenValue(theme, name);
  expect(raw, `${theme.id} must provide ${name}`).toBeTruthy();
  const value = Number.parseFloat(raw!);
  expect(Number.isFinite(value), `${theme.id} ${name} must be numeric`).toBe(true);
  return value;
}

function serviceWithHistory(history: RenderBlock[]): PiSessionService {
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

const PROPAGATION_FIXTURE: RenderBlock[] = [
  { id: 'user', kind: 'user', header: 'You', text: 'hello alpha', complete: true },
  {
    id: 'text',
    kind: 'text',
    text: '# Heading\n\nAlpha **bold** and *italic*',
    complete: true,
  },
  { id: 'thinking', kind: 'thinking', text: 'hmm alpha' },
  { id: 'tool', kind: 'tool', header: '→ Calling write', text: 'const alpha = 1' },
  { id: 'bash', kind: 'bash', text: '$ echo alpha' },
  { id: 'verification', kind: 'verification', text: '● PASS', sub: ['- cmd  1'] },
];

describe('deriveAppTokens', () => {
  it('maps every palette role onto the app token namespace', () => {
    const palette = {
      '--palette-bg': 'bg',
      '--palette-surface': 'surface',
      '--palette-elevated': 'elevated',
      '--palette-text': 'text',
      '--palette-muted': 'muted',
      '--palette-border': 'border',
      '--palette-accent': 'accent',
      '--palette-accent-2': 'accent-2',
      '--palette-ok': 'ok',
      '--palette-error': 'error',
      '--palette-warn': 'warn',
      '--palette-info': 'info',
    };

    expect(deriveAppTokens(palette)).toEqual({
      '--app-bg': 'bg',
      '--app-surface': 'surface',
      '--app-text': 'text',
      '--app-muted': 'muted',
      '--app-border': 'border',
      '--app-accent-1': 'accent',
      '--app-accent-2': 'accent-2',
      '--app-accent-fg': 'bg',
    });
  });

  it('reproduces the current app palettes byte-for-byte', () => {
    const set = THEME_SETS[DEFAULT_THEME_SET];
    expect(set.appTokens.dark).toEqual(DARK_TOKENS);
    expect(set.appTokens.light).toEqual(LIGHT_TOKENS);
    expect(set.appTokens.dark).toEqual(deriveAppTokens(set.palette.dark!));
    expect(set.appTokens.light).toEqual(deriveAppTokens(set.palette.light!));
  });

  it('keeps the pre-JS stylesheet fallbacks in sync with the default set', () => {
    function staticAppTokens(selector: string): Record<string, string> {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const block = styleCss.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
      expect(block, `missing ${selector} block`).not.toBeNull();
      return Object.fromEntries(
        Array.from(block![1].matchAll(/(--app-[a-z0-9-]+)\s*:\s*([^;]+);/g), (match) => [
          match[1],
          match[2].trim(),
        ])
      );
    }

    const set = THEME_SETS[DEFAULT_THEME_SET];
    expect(staticAppTokens(':root')).toEqual(set.appTokens.dark);
    expect(staticAppTokens("[data-theme='light']")).toEqual(set.appTokens.light);
  });
});

describe('validateThemeSet', () => {
  it('accepts the default set', () => {
    expect(validateThemeSet(THEME_SETS[DEFAULT_THEME_SET])).toEqual([]);
  });

  it('reports an invalid id, mode and missing palettes/themes', () => {
    const broken = {
      id: 'Not Valid!',
      label: '',
      mode: 'sepia',
      palette: {},
      appTokens: {},
      interactiveTheme: undefined,
      batchTheme: undefined,
    } as unknown as ThemeSet;

    const issues = validateThemeSet(broken);
    expect(issues.some((issue) => issue.includes('id'))).toBe(true);
    expect(issues.some((issue) => issue.includes('label'))).toBe(true);
    expect(issues.some((issue) => issue.includes('mode'))).toBe(true);
    expect(issues.some((issue) => issue.includes('interactiveTheme'))).toBe(true);
    expect(issues.some((issue) => issue.includes('batchTheme'))).toBe(true);
  });

  it('requires every supported mode palette and its derived app tokens', () => {
    const set = THEME_SETS[DEFAULT_THEME_SET];
    const broken: ThemeSet = {
      ...set,
      palette: { dark: set.palette.dark },
      appTokens: { dark: set.appTokens.dark },
    };

    const issues = validateThemeSet(broken);
    expect(issues.some((issue) => issue.includes('palette.light'))).toBe(true);
    expect(issues.some((issue) => issue.includes('appTokens.light'))).toBe(true);
  });
});

describe('theme set registry', () => {
  const MODES = ['dark', 'light'] as const;

  it('registers the default set and the alternative Ember set', () => {
    expect(Object.keys(THEME_SETS)).toEqual(['default', 'ember']);
    for (const set of Object.values(THEME_SETS)) {
      expect(validateThemeSet(set)).toEqual([]);
      expect(set.mode).toBe('both');
      for (const mode of MODES) {
        expect(set.palette[mode]).toBeDefined();
        expect(set.appTokens[mode]).toEqual(deriveAppTokens(set.palette[mode]!));
        expect(set.batchTheme[mode]).toBeDefined();
        expect(set.interactiveTheme[mode]).toBeDefined();
      }
    }
  });

  it('reuses the compact/roomy density roles in both sets', () => {
    for (const set of Object.values(THEME_SETS)) {
      for (const mode of MODES) {
        const batch = set.batchTheme[mode]!;
        const interactive = set.interactiveTheme[mode]!;
        for (const [name, value] of Object.entries(DENSITY_COMPACT)) {
          expect(batch.tokens[name as keyof typeof batch.tokens]).toBe(value);
        }
        for (const [name, value] of Object.entries(DENSITY_ROOMY)) {
          expect(interactive.tokens[name as keyof typeof interactive.tokens]).toBe(value);
        }
      }
    }
  });

  it('uses the warm amber/rose palette only for the alternative set', () => {
    const defaultSet = THEME_SETS[DEFAULT_THEME_SET];
    const ember = THEME_SETS.ember;

    expect(defaultSet.palette.dark?.['--palette-accent']).toBe('var(--color-sky-400)');
    expect(ember.palette.dark?.['--palette-accent']).toBe('var(--color-amber-400)');
    expect(ember.palette.dark?.['--palette-accent-2']).toBe('var(--color-rose-400)');
    expect(ember.palette.light?.['--palette-accent']).toBe('var(--color-amber-700)');
    expect(ember.palette.light?.['--palette-accent-2']).toBe('var(--color-rose-700)');

    // Density tokens stay identical; the palette roles are what differ.
    expect(ember.batchTheme.dark?.tokens['--piview-bg']).not.toBe(
      defaultSet.batchTheme.dark?.tokens['--piview-bg']
    );
    expect(ember.batchTheme.dark?.tokens['--piview-font-size']).toBe(
      defaultSet.batchTheme.dark?.tokens['--piview-font-size']
    );
  });

  it('selects the alternative set through the manager and persists it', () => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');

    const manager = new ThemeManager();
    manager.setSet('ember');

    expect(manager.getActiveSetId()).toBe('ember');
    expect(manager.themeForVariant('batch')).toBe(THEME_SETS.ember.batchTheme.dark);
    expect(manager.themeForVariant('interactive')).toBe(
      THEME_SETS.ember.interactiveTheme.dark
    );
    expect(document.documentElement.getAttribute('data-theme-set')).toBe('ember');
    expect(document.documentElement.style.getPropertyValue('--app-accent-1')).toBe(
      'var(--color-amber-400)'
    );
    expect(JSON.parse(localStorage.getItem(THEME_SET_STORAGE_KEY)!)).toEqual({
      setId: 'ember',
      mode: 'dark',
    });
  });
});

describe('density invariant', () => {
  const MODES = ['dark', 'light'] as const;

  it('keeps batch compact and interactive roomy in every set and mode', () => {
    const batchReference = new Map<string, number>();
    const interactiveReference = new Map<string, number>();

    for (const set of Object.values(THEME_SETS)) {
      for (const mode of MODES) {
        const batch = set.batchTheme[mode]!;
        const interactive = set.interactiveTheme[mode]!;

        expect(numericToken(batch, '--piview-font-size')).toBeLessThanOrEqual(11);
        expect(numericToken(batch, '--piview-block-padding')).toBeLessThanOrEqual(0.5);
        expect(numericToken(batch, '--piview-radius-block')).toBeLessThanOrEqual(0.25);

        expect(numericToken(interactive, '--piview-font-size')).toBeGreaterThanOrEqual(12);
        expect(numericToken(interactive, '--piview-block-padding')).toBeGreaterThanOrEqual(0.75);

        for (const key of [
          '--piview-font-size',
          '--piview-leading',
          '--piview-font-size-prose',
          '--piview-leading-prose',
          '--piview-block-gap',
          '--piview-block-padding',
          '--piview-radius-block',
          '--piview-radius-chrome',
        ]) {
          const compactValue = numericToken(batch, key);
          const roomyValue = numericToken(interactive, key);
          const batchKey = `${mode}:${key}`;
          if (!batchReference.has(batchKey)) {
            batchReference.set(batchKey, compactValue);
            interactiveReference.set(batchKey, roomyValue);
          } else {
            expect(compactValue, `${set.id}/${mode} batch ${key}`).toBe(
              batchReference.get(batchKey)
            );
            expect(roomyValue, `${set.id}/${mode} interactive ${key}`).toBe(
              interactiveReference.get(batchKey)
            );
          }
        }
      }
    }
  });
});

describe('palette parity and propagation', () => {
  const MODES = ['dark', 'light'] as const;
  const PIVIEW_PALETTE_MAP: ReadonlyArray<[keyof PalettePrimitives, string]> = [
    ['--palette-bg', '--piview-bg'],
    ['--palette-surface', '--piview-surface'],
    ['--palette-text', '--piview-fg'],
    ['--palette-muted', '--piview-fg-muted'],
    ['--palette-border', '--piview-border'],
    ['--palette-accent', '--piview-accent'],
    ['--palette-accent-2', '--piview-accent-2'],
    ['--palette-ok', '--piview-fg-ok'],
    ['--palette-warn', '--piview-fg-thinking'],
    ['--palette-info', '--piview-fg-notice'],
  ];

  it('maps a primitive change to app, interactive and batch deterministically', () => {
    const base = THEME_SETS[DEFAULT_THEME_SET].palette.dark!;
    const changed: PalettePrimitives = {
      ...base,
      '--palette-bg': 'sentinel-bg',
      '--palette-accent': 'sentinel-accent',
      '--palette-error': 'sentinel-error',
    };

    expect(deriveAppTokens(changed)).toEqual({
      ...deriveAppTokens(base),
      '--app-bg': 'sentinel-bg',
      '--app-accent-1': 'sentinel-accent',
      '--app-accent-fg': 'sentinel-bg',
    });

    const batch = derivePiviewTheme(changed, 'compact');
    const interactive = derivePiviewTheme(changed, 'roomy');
    for (const tokens of [batch, interactive]) {
      expect(tokens['--piview-bg']).toBe('sentinel-bg');
      expect(tokens['--piview-accent']).toBe('sentinel-accent');
      expect(tokens['--piview-fg-error']).toBe('sentinel-error');
    }
    expect(batch).not.toEqual(interactive);
  });

  it('derives every registered set from its own palette on both surfaces', () => {
    for (const set of Object.values(THEME_SETS)) {
      for (const mode of MODES) {
        const palette = set.palette[mode]!;
        expect(set.appTokens[mode]).toEqual(deriveAppTokens(palette));

        for (const theme of [set.batchTheme[mode]!, set.interactiveTheme[mode]!]) {
          for (const [paletteKey, piviewToken] of PIVIEW_PALETTE_MAP) {
            expect(
              tokenValue(theme, piviewToken),
              `${set.id}/${mode} ${theme.id} ${piviewToken}`
            ).toBe(palette[paletteKey]);
          }
        }
      }
    }
  });

  it('uses distinct palette primitives across sets but the same density roles', () => {
    const [first, second] = Object.values(THEME_SETS);
    expect(first.palette.dark!['--palette-bg']).not.toBe(
      second.palette.dark!['--palette-bg']
    );
    expect(first.palette.dark!['--palette-accent']).not.toBe(
      second.palette.dark!['--palette-accent']
    );
    expect(first.batchTheme.dark!.tokens['--piview-font-size']).toBe(
      second.batchTheme.dark!.tokens['--piview-font-size']
    );
    expect(first.interactiveTheme.dark!.tokens['--piview-block-padding']).toBe(
      second.interactiveTheme.dark!.tokens['--piview-block-padding']
    );
  });
});

describe('theme set propagation', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-set');
    document.documentElement.removeAttribute('style');
    document.body.innerHTML = '';
    themeManager.setSet(DEFAULT_THEME_SET);
    themeManager.setMode('dark');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    themeManager.setSet(DEFAULT_THEME_SET);
    themeManager.setMode('dark');
  });

  it('re-themes a mounted PiView in place and keeps scroll/follow/collapse/search/format state', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new PiView(serviceWithHistory(PROPAGATION_FIXTURE), host, {
      variant: 'batch',
    });
    view.render();
    view.flushAutoFormat();

    const log = host.querySelector('#log-content-container') as HTMLElement;
    const blocks = host.querySelector('#log-blocks') as HTMLElement;
    expect(log).not.toBeNull();
    expect(blocks).not.toBeNull();

    (host.querySelector('#collapse-blocks-btn') as HTMLButtonElement).click();
    (host.querySelector('#follow-btn') as HTMLButtonElement).click();
    expect(view.isFollowing()).toBe(false);

    let scrollTopValue = 321;
    Object.defineProperty(log, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });

    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    const input = host.querySelector('#piview-search-input') as HTMLInputElement;
    input.value = 'alpha';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(250);
    expect(host.querySelectorAll('mark.piview-search-match').length).toBeGreaterThan(0);

    const baselineBlocks = blocks.innerHTML;
    const baselineSearch = (
      host.querySelector('#piview-search-count') as HTMLElement
    ).textContent;
    const baselineFormatted = Array.from(
      log.querySelectorAll('[data-role="formatted"]')
    ) as HTMLElement[];
    const footer = host.querySelector('.piview-footer') as HTMLElement;
    const footerBefore = footer.outerHTML;

    expect(view.getThemeId()).toBe('batch-default');
    expect(log.getAttribute('data-piview-theme')).toBe('batch-default');

    themeManager.setSet('ember');

    const ember = THEME_SETS.ember;
    expect(view.getThemeId()).toBe('batch-ember');
    expect(log.getAttribute('data-piview-theme')).toBe('batch-ember');
    expect(log.style.getPropertyValue('--piview-bg')).toBe(
      ember.palette.dark!['--palette-bg']
    );
    expect(blocks.innerHTML).toBe(baselineBlocks);
    expect(log.scrollTop).toBe(321);
    expect(view.isFollowing()).toBe(false);
    expect(
      (host.querySelector('#piview-search-count') as HTMLElement).textContent
    ).toBe(baselineSearch);
    const formattedNow = Array.from(
      log.querySelectorAll('[data-role="formatted"]')
    ) as HTMLElement[];
    expect(formattedNow).toEqual(baselineFormatted);
    formattedNow.forEach((el) => expect(el.isConnected).toBe(true));

    // Footer chrome stays on --app-* and carries no PiView theme tokens.
    expect(footer.outerHTML).toBe(footerBefore);
    expect(footer.hasAttribute('data-piview-theme')).toBe(false);
    expect(getComputedStyle(footer).getPropertyValue('--piview-bg').trim()).toBe('');
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe(
      ember.palette.dark!['--palette-bg']
    );
    expect(document.documentElement.style.getPropertyValue('--app-accent-1')).toBe(
      ember.palette.dark!['--palette-accent']
    );

    themeManager.setMode('light');

    expect(view.getThemeId()).toBe('batch-ember-light');
    expect(log.getAttribute('data-piview-theme')).toBe('batch-ember-light');
    expect(log.style.getPropertyValue('--piview-bg')).toBe(
      ember.palette.light!['--palette-bg']
    );
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe(
      ember.palette.light!['--palette-bg']
    );
    expect(blocks.innerHTML).toBe(baselineBlocks);
    expect(log.scrollTop).toBe(321);
    expect(view.isFollowing()).toBe(false);

    view.destroy();
    host.remove();
  });
});

describe('code-selectable presets and deprecated aliases', () => {
  it('keeps batch-paper and interactive-focus valid code-selectable presets', () => {
    for (const id of ['batch-paper', 'interactive-focus']) {
      const theme = PI_VIEW_THEMES[id];
      expect(theme, `${id} must remain registered`).toBeDefined();
      expect(theme.id).toBe(id);
      expect(validateTheme(theme)).toEqual([]);
    }
  });

  it('resolves the deprecated ids to the harmonized defaults', () => {
    expect(PI_VIEW_THEMES['batch-terminal']).toBe(PI_VIEW_THEMES['batch-default']);
    expect(PI_VIEW_THEMES['interactive-chat']).toBe(
      PI_VIEW_THEMES['interactive-default']
    );
    expect(resolveTheme('batch', 'batch-terminal')).toBe(
      PI_VIEW_THEMES['batch-default']
    );
    expect(resolveTheme('interactive', 'interactive-chat')).toBe(
      PI_VIEW_THEMES['interactive-default']
    );
  });
});

describe('ThemeManager', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-set');
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    delete THEME_SETS.temporary;
    vi.restoreAllMocks();
  });

  it('defaults to the default set in dark mode', () => {
    const manager = new ThemeManager();
    expect(manager.getActiveSetId()).toBe(DEFAULT_THEME_SET);
    expect(manager.getActiveSet().id).toBe(DEFAULT_THEME_SET);
    expect(document.documentElement.getAttribute('data-theme-set')).toBe(DEFAULT_THEME_SET);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('writes the active mode tokens, attributes and persistence', () => {
    const manager = new ThemeManager();
    manager.setMode('light');

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    for (const [name, value] of Object.entries(LIGHT_TOKENS)) {
      expect(document.documentElement.style.getPropertyValue(name)).toBe(value);
    }
    expect(JSON.parse(localStorage.getItem(THEME_SET_STORAGE_KEY)!)).toEqual({
      setId: DEFAULT_THEME_SET,
      mode: 'light',
    });
  });

  it('restores the persisted set and mode', () => {
    const manager = new ThemeManager();
    manager.setMode('light');

    const restored = new ThemeManager();
    expect(restored.getActiveSetId()).toBe(DEFAULT_THEME_SET);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('persists and restores the alternative set and mode across manager instances', () => {
    const first = new ThemeManager();
    first.setSet('ember');
    first.setMode('light');

    const restored = new ThemeManager();
    expect(restored.getActiveSetId()).toBe('ember');
    expect(restored.getActiveMode()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme-set')).toBe('ember');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(restored.themeForVariant('batch')).toBe(THEME_SETS.ember.batchTheme.light);
    expect(restored.themeForVariant('interactive')).toBe(
      THEME_SETS.ember.interactiveTheme.light
    );
  });

  it('falls back to the default set for a stale persisted id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(
      THEME_SET_STORAGE_KEY,
      JSON.stringify({ setId: 'retired-set', mode: 'light' })
    );

    const manager = new ThemeManager();

    expect(manager.getActiveSetId()).toBe(DEFAULT_THEME_SET);
    expect(manager.getActiveMode()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme-set')).toBe(
      DEFAULT_THEME_SET
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default set for an unknown id and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = new ThemeManager();

    manager.setSet('does-not-exist');
    manager.setSet('does-not-exist');

    expect(manager.getActiveSetId()).toBe(DEFAULT_THEME_SET);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('removes stale inline app tokens when switching to a set without them', () => {
    const base = THEME_SETS[DEFAULT_THEME_SET];
    const sparse: ThemeSet = {
      ...base,
      id: 'temporary',
      appTokens: {
        dark: { '--app-bg': 'black' },
        light: { '--app-bg': 'white' },
      },
    };
    THEME_SETS.temporary = sparse;

    const manager = new ThemeManager();
    expect(document.documentElement.style.getPropertyValue('--app-border')).toBe(
      DARK_TOKENS['--app-border']
    );

    manager.setSet('temporary');
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('black');
    expect(document.documentElement.style.getPropertyValue('--app-border')).toBe('');
  });

  it('notifies subscribers and supports unsubscription', () => {
    const manager = new ThemeManager();
    const listener = vi.fn();
    const unsubscribe = manager.onSetChange(listener);

    manager.setSet(DEFAULT_THEME_SET);
    manager.setMode('light');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(DEFAULT_THEME_SET);

    unsubscribe();
    manager.setMode('dark');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('maps variants to the batch and interactive themes', () => {
    const manager = new ThemeManager();
    expect(manager.themeForVariant('batch')).toBe(PI_VIEW_THEMES['batch-default']);
    expect(manager.themeForVariant('interactive')).toBe(PI_VIEW_THEMES['interactive-default']);
  });

  function registerDarkOnlySet(): ThemeSet {
    const base = THEME_SETS[DEFAULT_THEME_SET];
    const darkOnly: ThemeSet = {
      ...base,
      id: 'temporary',
      label: 'Temporary dark',
      mode: 'dark',
      palette: { dark: base.palette.dark },
      appTokens: { dark: base.appTokens.dark },
      interactiveTheme: { dark: base.interactiveTheme.dark },
      batchTheme: { dark: base.batchTheme.dark },
    };
    THEME_SETS.temporary = darkOnly;
    return darkOnly;
  }

  it('normalises a dark-only set selected while light mode is active', () => {
    const darkOnly = registerDarkOnlySet();
    const manager = new ThemeManager();
    manager.setMode('light');
    expect(manager.getActiveMode()).toBe('light');

    manager.setSet('temporary');

    expect(manager.getActiveMode()).toBe('dark');
    expect(manager.getEffectiveMode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    for (const [name, value] of Object.entries(DARK_TOKENS)) {
      expect(document.documentElement.style.getPropertyValue(name)).toBe(value);
    }
    expect(manager.themeForVariant('batch')).toBe(darkOnly.batchTheme.dark);
    expect(manager.themeForVariant('interactive')).toBe(
      darkOnly.interactiveTheme.dark
    );
    expect(JSON.parse(localStorage.getItem(THEME_SET_STORAGE_KEY)!)).toEqual({
      setId: 'temporary',
      mode: 'dark',
    });
  });

  it('normalises setMode to a mode the active single-mode set supports', () => {
    const darkOnly = registerDarkOnlySet();
    const manager = new ThemeManager();
    manager.setSet('temporary');

    manager.setMode('light');

    expect(manager.getActiveMode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(manager.themeForVariant('batch')).toBe(darkOnly.batchTheme.dark);
    expect(manager.themeForVariant('interactive')).toBe(
      darkOnly.interactiveTheme.dark
    );
    expect(JSON.parse(localStorage.getItem(THEME_SET_STORAGE_KEY)!)).toEqual({
      setId: 'temporary',
      mode: 'dark',
    });
  });

  it('normalises a persisted unsupported mode for a single-mode set', () => {
    const darkOnly = registerDarkOnlySet();
    localStorage.setItem(
      THEME_SET_STORAGE_KEY,
      JSON.stringify({ setId: 'temporary', mode: 'light' })
    );

    const manager = new ThemeManager();

    expect(manager.getActiveSetId()).toBe('temporary');
    expect(manager.getActiveMode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme-set')).toBe('temporary');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe(
      DARK_TOKENS['--app-bg']
    );
    expect(manager.themeForVariant('batch')).toBe(darkOnly.batchTheme.dark);
    expect(manager.themeForVariant('interactive')).toBe(
      darkOnly.interactiveTheme.dark
    );
    expect(JSON.parse(localStorage.getItem(THEME_SET_STORAGE_KEY)!)).toEqual({
      setId: 'temporary',
      mode: 'dark',
    });
  });
});
