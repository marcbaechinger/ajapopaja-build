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
  validateThemeSet,
  type ThemeSet,
} from './themeSets.ts';
import { PI_VIEW_THEMES } from '../components/session/piviewThemes.ts';

const DARK_TOKENS = {
  '--app-bg': 'var(--color-slate-950)',
  '--app-surface': 'var(--color-slate-900)',
  '--app-text': 'var(--color-slate-100)',
  '--app-muted': 'var(--color-slate-400)',
  '--app-border': 'var(--color-slate-800)',
  '--app-accent-1': 'var(--color-sky-400)',
  '--app-accent-2': 'var(--color-cyan-400)',
};

const LIGHT_TOKENS = {
  '--app-bg': 'var(--color-slate-50)',
  '--app-surface': 'var(--color-white)',
  '--app-text': 'var(--color-slate-900)',
  '--app-muted': 'var(--color-slate-500)',
  '--app-border': 'var(--color-slate-200)',
  '--app-accent-1': 'var(--color-sky-600)',
  '--app-accent-2': 'var(--color-cyan-600)',
};

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
    });
  });

  it('reproduces the current app palettes byte-for-byte', () => {
    const set = THEME_SETS[DEFAULT_THEME_SET];
    expect(set.appTokens.dark).toEqual(DARK_TOKENS);
    expect(set.appTokens.light).toEqual(LIGHT_TOKENS);
    expect(set.appTokens.dark).toEqual(deriveAppTokens(set.palette.dark!));
    expect(set.appTokens.light).toEqual(deriveAppTokens(set.palette.light!));
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
    expect(ember.palette.light?.['--palette-accent']).toBe('var(--color-amber-600)');
    expect(ember.palette.light?.['--palette-accent-2']).toBe('var(--color-rose-600)');

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
});
