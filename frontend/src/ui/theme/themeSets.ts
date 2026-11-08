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

import {
  AMBER_DARK_PALETTE,
  AMBER_LIGHT_PALETTE,
  DARK_PALETTE,
  DENSITY_COMPACT,
  DENSITY_PRESETS,
  DENSITY_ROOMY,
  EMBER_DARK_PALETTE,
  EMBER_LIGHT_PALETTE,
  LIGHT_PALETTE,
  PI_VIEW_THEMES,
  derivePiviewTheme,
  validateTheme,
  type PalettePrimitives,
  type PiViewDensity,
  type PiViewTheme,
  type PiViewVariant,
} from '../components/session/piviewThemes.ts';

// Re-export the shared palette/derivation API from the theme-set module, which
// is the public entry point for theme data.
export {
  AMBER_DARK_PALETTE,
  AMBER_LIGHT_PALETTE,
  DARK_PALETTE,
  DENSITY_COMPACT,
  DENSITY_PRESETS,
  DENSITY_ROOMY,
  EMBER_DARK_PALETTE,
  EMBER_LIGHT_PALETTE,
  LIGHT_PALETTE,
  derivePiviewTheme,
};
export type { PalettePrimitives, PiViewDensity };

/** The light/dark mode selected within a theme set. */
export type ThemeMode = 'dark' | 'light';

export interface ThemeSet {
  id: string;
  label: string;
  description?: string;
  /** 'dark' | 'light' | 'both' — the modes the set supports. */
  mode: ThemeMode | 'both';
  /** One primitive palette per mode the set supports. */
  palette: Partial<Record<ThemeMode, PalettePrimitives>>;
  /** `--app-*` tokens derived from `palette`, per mode. */
  appTokens: Partial<Record<ThemeMode, Record<string, string>>>;
  /**
   * The two PiView themes, selected per mode. A `'both'` set declares both
   * entries; a single-mode set only needs the entry for its mode.
   */
  interactiveTheme: Partial<Record<ThemeMode, PiViewTheme>>;
  batchTheme: Partial<Record<ThemeMode, PiViewTheme>>;
}

/** Stable storage key for the active set + mode. */
export const THEME_SET_STORAGE_KEY = 'ajapopaja:theme-set';

/** The palette primitive names, in a stable order for validation/derivation. */
const PALETTE_KEYS: readonly (keyof PalettePrimitives)[] = [
  '--palette-bg',
  '--palette-surface',
  '--palette-elevated',
  '--palette-text',
  '--palette-muted',
  '--palette-border',
  '--palette-accent',
  '--palette-accent-2',
  '--palette-ok',
  '--palette-error',
  '--palette-warn',
  '--palette-info',
];

const THEME_MODES: readonly ThemeMode[] = ['dark', 'light'];
const SET_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const APP_TOKEN_RE = /^--app-[a-z0-9-]+$/;

/**
 * Map the shared palette onto the app's semantic token namespace. This is the
 * single §5.1 mapping; individual sets must not duplicate these assignments.
 */
export function deriveAppTokens(palette: PalettePrimitives): Record<string, string> {
  return {
    '--app-bg': palette['--palette-bg'],
    '--app-surface': palette['--palette-surface'],
    '--app-text': palette['--palette-text'],
    '--app-muted': palette['--palette-muted'],
    '--app-border': palette['--palette-border'],
    '--app-accent-1': palette['--palette-accent'],
    '--app-accent-2': palette['--palette-accent-2'],
  };
}

/**
 * The supported modes of a set. `'both'` is expanded in the same order as
 * {@link THEME_MODES}; a single-mode set yields exactly that mode.
 */
function modesForSet(set: ThemeSet): ThemeMode[] {
  if (set.mode === 'both') return [...THEME_MODES];
  return THEME_MODES.includes(set.mode) ? [set.mode] : [];
}

/**
 * Validate a theme set's identity, mode coverage, palettes, derived app tokens
 * and its two PiView themes. Returns human-readable issues (empty when valid).
 */
export function validateThemeSet(set: ThemeSet): string[] {
  const issues: string[] = [];

  if (!set || typeof set !== 'object') {
    return ['theme set must be an object'];
  }

  if (typeof set.id !== 'string' || !SET_ID_RE.test(set.id)) {
    issues.push(
      'id must be a non-empty lowercase identifier (letters, digits, "-" or "_"), starting with a letter or digit'
    );
  }

  if (typeof set.label !== 'string' || set.label.trim().length === 0) {
    issues.push('label must be a non-empty string');
  }

  if (set.description !== undefined && typeof set.description !== 'string') {
    issues.push('description must be a string when provided');
  }

  if (set.mode !== 'dark' && set.mode !== 'light' && set.mode !== 'both') {
    issues.push("mode must be 'dark', 'light' or 'both'");
  }

  const modes = modesForSet(set);
  for (const mode of modes) {
    const palette = set.palette?.[mode];
    if (!palette || typeof palette !== 'object' || Array.isArray(palette)) {
      issues.push(`palette.${mode} must be an object`);
    } else {
      for (const key of PALETTE_KEYS) {
        const value = palette[key];
        if (typeof value !== 'string' || value.length === 0) {
          issues.push(`palette.${mode}.${key} must be a non-empty string`);
        }
      }
    }

    const appTokens = set.appTokens?.[mode];
    if (!appTokens || typeof appTokens !== 'object' || Array.isArray(appTokens)) {
      issues.push(`appTokens.${mode} must be an object`);
    } else {
      for (const [name, value] of Object.entries(appTokens)) {
        if (!APP_TOKEN_RE.test(name)) {
          issues.push(
            `invalid app token name in ${mode}: ${name} (must start with --app-)`
          );
        }
        if (typeof value !== 'string' || value.length === 0) {
          issues.push(`appTokens.${mode}.${name} must be a non-empty string`);
        }
      }
    }
  }

  const themeRoles: Array<
    ['interactiveTheme' | 'batchTheme', Partial<Record<ThemeMode, PiViewTheme>>]
  > = [
    ['interactiveTheme', set.interactiveTheme],
    ['batchTheme', set.batchTheme],
  ];
  for (const [role, themes] of themeRoles) {
    if (!themes || typeof themes !== 'object' || Array.isArray(themes)) {
      issues.push(`${role} must map every supported mode to a PiViewTheme`);
      continue;
    }
    for (const mode of modes) {
      const theme = themes[mode];
      if (!theme || typeof theme !== 'object') {
        issues.push(`${role}.${mode} must be a PiViewTheme`);
        continue;
      }
      for (const issue of validateTheme(theme)) {
        issues.push(`${role}.${mode}: ${issue}`);
      }
    }
  }

  return issues;
}

const DEFAULT_SET: ThemeSet = {
  id: 'default',
  label: 'Default',
  description: 'Slate neutrals with sky and cyan accents.',
  mode: 'both',
  palette: {
    dark: DARK_PALETTE,
    light: LIGHT_PALETTE,
  },
  appTokens: {
    dark: deriveAppTokens(DARK_PALETTE),
    light: deriveAppTokens(LIGHT_PALETTE),
  },
  interactiveTheme: {
    dark: PI_VIEW_THEMES['interactive-default'],
    light: PI_VIEW_THEMES['interactive-default-light'],
  },
  batchTheme: {
    dark: PI_VIEW_THEMES['batch-default'],
    light: PI_VIEW_THEMES['batch-default-light'],
  },
};

/**
 * The alternative warm set. It reuses the default set's density roles verbatim
 * (compact batch, roomy interactive); only the palette primitives differ.
 */
const EMBER_SET: ThemeSet = {
  id: 'ember',
  label: 'Ember',
  description: 'Warm amber-and-rose palette.',
  mode: 'both',
  palette: {
    dark: AMBER_DARK_PALETTE,
    light: AMBER_LIGHT_PALETTE,
  },
  appTokens: {
    dark: deriveAppTokens(AMBER_DARK_PALETTE),
    light: deriveAppTokens(AMBER_LIGHT_PALETTE),
  },
  interactiveTheme: {
    dark: PI_VIEW_THEMES['interactive-ember'],
    light: PI_VIEW_THEMES['interactive-ember-light'],
  },
  batchTheme: {
    dark: PI_VIEW_THEMES['batch-ember'],
    light: PI_VIEW_THEMES['batch-ember-light'],
  },
};

/** The single source of truth for available theme sets. */
export const THEME_SETS: Record<string, ThemeSet> = {
  [DEFAULT_SET.id]: DEFAULT_SET,
  [EMBER_SET.id]: EMBER_SET,
};

/** Fallback used when a requested/persisted set id is unknown or invalid. */
export const DEFAULT_THEME_SET = 'default';

interface PersistedThemeSet {
  setId: string;
  mode: ThemeMode;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light';
}

function hasThemeSet(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(THEME_SETS, id);
}

function getStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function readPersistedThemeSet(): PersistedThemeSet | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(THEME_SET_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { setId, mode } = parsed as Partial<PersistedThemeSet>;
    if (typeof setId !== 'string' || !isThemeMode(mode)) return null;
    return { setId, mode };
  } catch {
    return null;
  }
}

function writePersistedThemeSet(state: PersistedThemeSet): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(THEME_SET_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence is best-effort (private mode/storage disabled must not break
    // the theme switch itself).
  }
}

/**
 * Tokens previously written to the document root. Mirrors the weak-map hygiene
 * in `applyTheme()`: switching to a set/mode that does not declare a token
 * removes the stale inline override instead of leaking it.
 */
const appliedAppTokens = new WeakMap<HTMLElement, Set<string>>();

function applyAppTokens(tokens: Record<string, string>): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const previous = appliedAppTokens.get(root);
  if (previous) {
    for (const name of previous) {
      if (!(name in tokens)) root.style.removeProperty(name);
    }
  }

  const current = new Set<string>();
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
    current.add(name);
  }
  appliedAppTokens.set(root, current);
}

/**
 * Framework-agnostic theme-set store. It owns the active set + mode, writes the
 * document attributes and inline `--app-*` overrides, persists the selection,
 * and notifies subscribers. The static CSS blocks remain the pre-JS fallback.
 */
export class ThemeManager {
  private activeSetId: string = DEFAULT_THEME_SET;
  private activeMode: ThemeMode = 'dark';
  private readonly listeners = new Set<(setId: string) => void>();
  private readonly warnedUnknownIds = new Set<string>();

  constructor() {
    const persisted = readPersistedThemeSet();
    if (persisted) {
      const known = hasThemeSet(persisted.setId);
      this.activeSetId = known ? persisted.setId : DEFAULT_THEME_SET;
      this.activeMode = persisted.mode;
      if (!known) {
        this.warnUnknownSet(persisted.setId);
      }
    } else if (typeof document !== 'undefined') {
      const documentMode = document.documentElement.getAttribute('data-theme');
      if (isThemeMode(documentMode)) this.activeMode = documentMode;
    }

    this.applyToDocument();
  }

  getActiveSetId(): string {
    return this.activeSetId;
  }

  getActiveSet(): ThemeSet {
    return this.resolveSet(this.activeSetId);
  }

  setMode(mode: ThemeMode): void {
    this.activeMode = isThemeMode(mode) ? mode : 'dark';
    this.applyToDocument();
    this.persist();
    this.notify();
  }

  setSet(id: string): void {
    const set = this.resolveSet(id, true);
    this.activeSetId = set.id;
    this.applyToDocument();
    this.persist();
    this.notify();
  }

  themeForVariant(variant: PiViewVariant): PiViewTheme {
    const set = this.getActiveSet();
    const themes = variant === 'interactive' ? set.interactiveTheme : set.batchTheme;
    const otherMode: ThemeMode = this.activeMode === 'dark' ? 'light' : 'dark';
    return (
      themes?.[this.activeMode] ??
      themes?.[otherMode] ??
      PI_VIEW_THEMES[
        variant === 'interactive' ? 'interactive-default' : 'batch-default'
      ] ??
      PI_VIEW_THEMES['batch-default']
    );
  }

  onSetChange(cb: (setId: string) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private resolveSet(id: string, warn: boolean = false): ThemeSet {
    if (hasThemeSet(id)) return THEME_SETS[id];

    if (warn) this.warnUnknownSet(id);
    return hasThemeSet(DEFAULT_THEME_SET) ? THEME_SETS[DEFAULT_THEME_SET] : DEFAULT_SET;
  }

  private warnUnknownSet(id: string): void {
    if (this.warnedUnknownIds.has(id)) return;
    this.warnedUnknownIds.add(id);
    console.warn(
      `ThemeManager: unknown theme set "${id}"; falling back to "${DEFAULT_THEME_SET}"`
    );
  }

  private applyToDocument(): void {
    const set = this.getActiveSet();
    this.activeSetId = set.id;

    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.setAttribute('data-theme-set', set.id);
      root.setAttribute('data-theme', this.activeMode);
      applyAppTokens(set.appTokens[this.activeMode] ?? {});
    }
  }

  private persist(): void {
    writePersistedThemeSet({ setId: this.activeSetId, mode: this.activeMode });
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.activeSetId);
    }
  }
}

/** Module singleton used by the app (and, later, by PiView defaults). */
export const themeManager = new ThemeManager();
