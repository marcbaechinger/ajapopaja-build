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

/**
 * PiView theme registry.
 *
 * A theme is pure data: a stable id, a label/description, the session variants
 * it supports, a set of CSS custom properties, and (optionally) a little CSS for
 * things custom properties cannot express. Adding a theme must only require a
 * new entry in {@link PI_VIEW_THEMES}; `PiView.ts` resolves and applies themes
 * through this module and must never special-case a theme id.
 *
 * ## Public token contract
 *
 * Every `--piview-*` token exported by this module (and consumed by
 * `PiView.css`) is public API. Token names are additive-only: do not rename a
 * shipped token, do not repurpose an existing token for a different role, and
 * do not remove one. Adding a new token is fine. That lets existing themes keep
 * working while new themes opt into new roles. Tokens introduced before the
 * theme system has shipped may still be removed while they are unreleased; once
 * released, the additive-only guarantees apply. A token must either have a
 * `var(...)` consumer in PiView-owned CSS or be documented as an extension hook
 * in the theme token guard.
 *
 * Themes do not need to be complete. `PiView.css` supplies the default
 * (batch-default parity) values for every token, so a theme may override only
 * the handful of roles it cares about.
 *
 * Colour contract: every `--piview-syntax-*` and `--piview-search-*` role is
 * derived from the palette primitives in {@link derivePiviewTheme}. There is no
 * set-independent exception: the semantic `ok`/`error`/`warn` bases stay
 * recognisable because they are blended with the set's own accent family. A new
 * theme set therefore changes the code and search hues together with the chrome
 * instead of layering a fixed hue family on top.
 *
 * Builtins: `batch-default` is the dark, dense transcript with a matching
 * `batch-default-light`; `batch-paper` is a light, print/archival transcript;
 * `interactive-default` is the roomy conversation with a matching
 * `interactive-default-light`; and `interactive-focus` is a low-chrome,
 * high-contrast reading mode for long conversations. The alternative "Ember"
 * theme set adds `batch-ember`/`interactive-ember` and their light variants on
 * the warm amber/rose palette, reusing the same density roles. The two presets
 * are code-selectable only (no picker or persistence). The deprecated ids
 * `batch-terminal` and `interactive-chat` remain registered as aliases of the
 * two dark defaults.
 */

/** The two PiView session variants. Each has its own default theme. */
export type PiViewVariant = 'batch' | 'interactive';

/** CSS custom properties scoped to a PiView log element. */
export type PiViewTokens = Record<`--piview-${string}`, string>;

export interface PiViewTheme {
  /** Stable id, exposed as `data-piview-theme`. */
  id: string;
  /** Human-readable name for a future picker/action. */
  label: string;
  /** One-line description; filled from the label when omitted. */
  description?: string;
  /** Variants this theme is designed for (a theme may serve both). */
  variants: PiViewVariant[];
  /** Semantic tokens applied to the log element. May be partial. */
  tokens: PiViewTokens;
  /** Optional rules for what variables cannot express (textures, keyframes). */
  css?: string;
}

const VALID_VARIANTS: readonly PiViewVariant[] = ['batch', 'interactive'];

/**
 * The token names are part of the public theme API. This pattern deliberately
 * accepts new `--piview-*` roles without allowing arbitrary CSS properties.
 */
const TOKEN_NAME_RE = /^--piview-[a-z0-9-]+$/;
const THEME_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * The shared palette primitives. A theme set is the only place a hue is
 * chosen; both the app tokens and the PiView themes are derived from these
 * values.
 */
export interface PalettePrimitives {
  '--palette-bg': string;
  '--palette-surface': string;
  '--palette-elevated': string;
  '--palette-text': string;
  '--palette-muted': string;
  '--palette-border': string;
  '--palette-accent': string;
  '--palette-accent-2': string;
  '--palette-ok': string;
  '--palette-error': string;
  '--palette-warn': string;
  '--palette-info': string;
}

/** The default set's dark palette (the app's slate + sky/cyan family). */
export const DARK_PALETTE: PalettePrimitives = {
  '--palette-bg': 'var(--color-slate-950)',
  '--palette-surface': 'var(--color-slate-900)',
  '--palette-elevated': 'var(--color-slate-800)',
  '--palette-text': 'var(--color-slate-100)',
  '--palette-muted': 'var(--color-slate-400)',
  '--palette-border': 'var(--color-slate-800)',
  '--palette-accent': 'var(--color-sky-400)',
  '--palette-accent-2': 'var(--color-cyan-400)',
  '--palette-ok': 'var(--color-green-400)',
  '--palette-error': 'var(--color-red-400)',
  '--palette-warn': 'var(--color-amber-400)',
  '--palette-info': 'var(--color-cyan-400)',
};

/** The default set's light palette. The accents use the 700 step so accent text
 * clears WCAG AA on the light surface; the dark set keeps the brighter 400
 * accents. */
export const LIGHT_PALETTE: PalettePrimitives = {
  '--palette-bg': 'var(--color-slate-50)',
  '--palette-surface': 'var(--color-white)',
  '--palette-elevated': 'var(--color-white)',
  '--palette-text': 'var(--color-slate-900)',
  '--palette-muted': 'var(--color-slate-500)',
  '--palette-border': 'var(--color-slate-200)',
  '--palette-accent': 'var(--color-sky-700)',
  '--palette-accent-2': 'var(--color-cyan-700)',
  '--palette-ok': 'var(--color-green-800)',
  '--palette-error': 'var(--color-red-600)',
  '--palette-warn': 'var(--color-amber-800)',
  '--palette-info': 'var(--color-cyan-700)',
};

/**
 * The alternative "Ember" set's dark palette: warm stone neutrals with amber
 * and rose accents. It is deliberately a different hue family from the
 * default, while keeping the same semantic roles (green/red stay status).
 */
export const AMBER_DARK_PALETTE: PalettePrimitives = {
  '--palette-bg': 'var(--color-stone-950)',
  '--palette-surface': 'var(--color-stone-900)',
  '--palette-elevated': 'var(--color-stone-800)',
  '--palette-text': 'var(--color-stone-100)',
  '--palette-muted': 'var(--color-stone-400)',
  '--palette-border': 'var(--color-stone-800)',
  '--palette-accent': 'var(--color-amber-400)',
  '--palette-accent-2': 'var(--color-rose-400)',
  '--palette-ok': 'var(--color-green-400)',
  '--palette-error': 'var(--color-red-400)',
  '--palette-warn': 'var(--color-amber-400)',
  '--palette-info': 'var(--color-rose-400)',
};

/** The alternative "Ember" set's light palette. Like the default light set,
 * the accents use the 700 step to keep accent text at AA on the light surface. */
export const AMBER_LIGHT_PALETTE: PalettePrimitives = {
  '--palette-bg': 'var(--color-stone-50)',
  '--palette-surface': 'var(--color-white)',
  '--palette-elevated': 'var(--color-white)',
  '--palette-text': 'var(--color-stone-900)',
  '--palette-muted': 'var(--color-stone-500)',
  '--palette-border': 'var(--color-stone-200)',
  '--palette-accent': 'var(--color-amber-700)',
  '--palette-accent-2': 'var(--color-rose-700)',
  '--palette-ok': 'var(--color-green-800)',
  '--palette-error': 'var(--color-red-600)',
  '--palette-warn': 'var(--color-amber-800)',
  '--palette-info': 'var(--color-rose-700)',
};

/** Named aliases for the alternative set, matching its "Ember" label. */
export const EMBER_DARK_PALETTE = AMBER_DARK_PALETTE;
export const EMBER_LIGHT_PALETTE = AMBER_LIGHT_PALETTE;

/** The two surface-role density presets. Palette and density are orthogonal. */
export type PiViewDensity = 'compact' | 'roomy';

export const DENSITY_COMPACT: PiViewTokens = {
  '--piview-font-size': '11px',
  '--piview-leading': '1.25',
  '--piview-font-size-prose': '12px',
  '--piview-leading-prose': '1.375',
  '--piview-block-gap': '0.875rem',
  '--piview-block-padding': '0.5rem',
  '--piview-radius-block': '0.25rem',
  '--piview-radius-chrome': '0.25rem',
};

export const DENSITY_ROOMY: PiViewTokens = {
  '--piview-font-size': '12px',
  '--piview-leading': '1.5',
  '--piview-font-size-prose': '13px',
  '--piview-leading-prose': '1.55',
  '--piview-block-gap': '1rem',
  '--piview-block-padding': '0.75rem',
  '--piview-radius-block': '10px',
  '--piview-radius-chrome': '8px',
};

export const DENSITY_PRESETS: Record<PiViewDensity, PiViewTokens> = {
  compact: DENSITY_COMPACT,
  roomy: DENSITY_ROOMY,
};

function mix(color: string, percentage: number): string {
  return `color-mix(in oklab, ${color} ${percentage}%, transparent)`;
}

function blend(first: string, firstPercentage: number, second: string, secondPercentage: number): string {
  return `color-mix(in oklab, ${first} ${firstPercentage}%, ${second} ${secondPercentage}%)`;
}

/**
 * Derive the ten syntax roles from the palette primitives. The semantic base
 * (ok/error/warn/accent) keeps the role recognisable, while each blend also
 * carries the set's accent family so switching sets changes the whole syntax
 * palette rather than only the chrome around it.
 */
function deriveSyntaxTokens(palette: PalettePrimitives): PiViewTokens {
  const text = palette['--palette-text'];
  const muted = palette['--palette-muted'];
  const accent = palette['--palette-accent'];
  const accent2 = palette['--palette-accent-2'];
  const ok = palette['--palette-ok'];
  const error = palette['--palette-error'];
  const warn = palette['--palette-warn'];

  return {
    '--piview-syntax-comment': blend(muted, 80, text, 20),
    '--piview-syntax-keyword': blend(blend(error, 75, accent2, 25), 80, text, 20),
    '--piview-syntax-string': blend(ok, 70, accent, 30),
    '--piview-syntax-number': blend(accent, 55, accent2, 45),
    '--piview-syntax-built-in': blend(warn, 70, accent2, 30),
    '--piview-syntax-title': accent,
    '--piview-syntax-tag': blend(ok, 60, accent2, 40),
    '--piview-syntax-meta': blend(muted, 65, text, 35),
    '--piview-syntax-addition': blend(ok, 80, accent, 20),
    '--piview-syntax-deletion': blend(blend(error, 80, accent2, 20), 80, text, 20),
  };
}

/**
 * Derive the search-highlight roles from the palette. The accent and warning
 * primitives supply the tint; the palette text colour is the matching ink for
 * both highlight levels, so dark and light sets stay readable without a mode
 * branch. The current-match outline uses the same text/accent blend.
 */
function deriveSearchTokens(palette: PalettePrimitives): PiViewTokens {
  const text = palette['--palette-text'];
  const accent = palette['--palette-accent'];
  const warn = palette['--palette-warn'];

  return {
    '--piview-search-hit': mix(accent, 30),
    '--piview-search-hit-fg': text,
    '--piview-search-current': mix(blend(warn, 60, accent, 40), 50),
    '--piview-search-current-fg': text,
    '--piview-search-current-outline': blend(text, 80, accent, 20),
  };
}

/**
 * Map the shared palette onto PiView's semantic roles. The optional density
 * preset (or token map) layers typography/spacing on top, and
 * `chatRefinements` adds the interactive conversation's card/motion tokens.
 * No hue is chosen here: every colour, including the syntax and search roles,
 * comes from the palette primitives. The function contains no hue literals
 * beyond the neutral `#000` used for shading and `transparent`.
 */
export function derivePiviewTheme(
  palette: PalettePrimitives,
  density: PiViewDensity | PiViewTokens,
  chatRefinements: PiViewTokens = {}
): PiViewTokens {
  const densityTokens = typeof density === 'string' ? DENSITY_PRESETS[density] : density;

  const bg = palette['--palette-bg'];
  const surface = palette['--palette-surface'];
  const elevated = palette['--palette-elevated'];
  const text = palette['--palette-text'];
  const muted = palette['--palette-muted'];
  const border = palette['--palette-border'];
  const accent = palette['--palette-accent'];
  const accent2 = palette['--palette-accent-2'];
  const ok = palette['--palette-ok'];
  const error = palette['--palette-error'];
  const warn = palette['--palette-warn'];
  const info = palette['--palette-info'];

  return {
    '--piview-bg': bg,
    '--piview-bg-image': 'none',

    '--piview-surface': surface,
    '--piview-surface-sticky': blend(bg, 95, 'transparent', 5),
    '--piview-surface-tool': blend(surface, 40, 'transparent', 60),
    '--piview-surface-bash': blend(bg, 60, '#000', 40),
    '--piview-surface-user': mix(accent, 12),
    '--piview-surface-verification-ok': mix(ok, 18),
    '--piview-surface-verification-error': mix(error, 18),
    '--piview-surface-formatted-active': blend(elevated, 82, accent, 18),
    '--piview-surface-pre': surface,
    '--piview-surface-code': blend(surface, 80, 'transparent', 20),
    '--piview-surface-hover': blend(bg, 80, 'transparent', 20),
    '--piview-surface-icon': blend(bg, 50, 'transparent', 50),

    '--piview-fg': text,
    '--piview-fg-dim': mix(text, 50),
    '--piview-fg-faint': mix(text, 40),
    '--piview-fg-title': mix(text, 70),
    '--piview-fg-muted': muted,
    '--piview-fg-tool': blend(text, 80, accent2, 20),
    '--piview-fg-thinking': warn,
    '--piview-fg-notice': info,
    '--piview-fg-error': error,
    '--piview-fg-ok': ok,
    '--piview-fg-user-label': accent,
    '--piview-fg-status': muted,
    '--piview-fg-heading': accent,
    '--piview-fg-link': accent,
    '--piview-fg-strong': accent2,
    '--piview-fg-quote': text,
    '--piview-fg-code': accent2,
    '--piview-fg-pre': text,
    '--piview-fg-icon': muted,
    '--piview-fg-icon-format': accent2,

    '--piview-border': border,
    '--piview-border-subtle': mix(border, 40),
    '--piview-border-tool': mix(border, 60),
    '--piview-border-accent-user': mix(accent, 60),
    '--piview-border-accent-thinking': mix(text, 20),
    '--piview-border-accent-bash': mix(accent2, 40),
    '--piview-border-accent-quote': accent,
    '--piview-border-verification-ok': mix(ok, 60),
    '--piview-border-verification-error': mix(error, 60),

    '--piview-accent': accent,
    '--piview-accent-2': accent2,
    '--piview-accent-fg': bg,
    '--piview-selection': mix(accent, 30),
    '--piview-focus-ring': accent,
    '--piview-danger': error,
    '--piview-danger-hover': blend(error, 80, '#000', 20),

    '--piview-font-log': 'var(--font-mono)',
    '--piview-font-prose': 'var(--font-sans)',
    '--piview-shadow-block': 'none',
    '--piview-scrollbar-thumb': border,
    '--piview-scrollbar-track': 'transparent',
    '--piview-status-dot-idle': mix(text, 40),
    '--piview-status-dot-active': ok,
    '--piview-motion-pulse': 'pulse',

    '--piview-gap-block': '0.4em',
    '--piview-gap-li': '0.2em',
    '--piview-gap-heading-top': '0.6em',
    '--piview-gap-heading-bottom': '0.2em',
    '--piview-gap-pre': '0.4em',
    '--piview-gap-hr': '0.65em',
    '--piview-max-width': '87ch',
    '--piview-pre-max-width': '130ch',

    ...deriveSyntaxTokens(palette),
    ...deriveSearchTokens(palette),

    ...densityTokens,
    ...chatRefinements,
  };
}

/**
 * The neutral dark transcript palette. Kept as an exported token base for the
 * print/focus presets and for theme authors; the default batch theme is derived
 * from {@link DARK_PALETTE}, so it shares the app's palette.
 */
export const BASE_DARK_TOKENS: PiViewTokens = derivePiviewTheme(DARK_PALETTE, 'compact');

/**
 * The hand-tuned light token base for print-like presets such as `batch-paper`.
 * It is exported for theme authors, but it is not the base of the derived
 * default/Ember light themes: those derive directly from their own palettes via
 * {@link derivePiviewTheme}.
 */
export const BASE_LIGHT_TOKENS: PiViewTokens = derivePiviewTheme(LIGHT_PALETTE, 'compact');

/**
 * A chat-oriented base. Kept separate from the dark transcript palette so an
 * interactive theme can change typography/density without repeating colors.
 */
export const BASE_CHAT_TOKENS: PiViewTokens = {
  ...BASE_DARK_TOKENS,
  ...DENSITY_ROOMY,
};

/**
 * Validate a theme's id, variants, label, tokens and optional CSS. Returns an
 * array of human-readable issues (empty when valid).
 *
 * This is intended for development and tests; runtime rendering never rejects a
 * theme because a partially-specified theme is valid (the stylesheet supplies
 * defaults for missing tokens).
 */
export function validateTheme(theme: PiViewTheme): string[] {
  const issues: string[] = [];

  if (!theme || typeof theme !== 'object') {
    return ['theme must be an object'];
  }

  if (typeof theme.id !== 'string' || !THEME_ID_RE.test(theme.id)) {
    issues.push(
      'id must be a non-empty lowercase identifier (letters, digits, "-" or "_"), starting with a letter or digit'
    );
  }

  if (typeof theme.label !== 'string' || theme.label.trim().length === 0) {
    issues.push('label must be a non-empty string');
  }

  if (theme.description !== undefined && typeof theme.description !== 'string') {
    issues.push('description must be a string when provided');
  }

  if (!Array.isArray(theme.variants) || theme.variants.length === 0) {
    issues.push('variants must contain at least one of: batch, interactive');
  } else {
    const seen = new Set<string>();
    for (const variant of theme.variants) {
      if (!VALID_VARIANTS.includes(variant)) {
        issues.push(`unknown variant: ${String(variant)}`);
      }
      if (seen.has(variant)) {
        issues.push(`duplicate variant: ${String(variant)}`);
      }
      seen.add(variant);
    }
  }

  if (!theme.tokens || typeof theme.tokens !== 'object' || Array.isArray(theme.tokens)) {
    issues.push('tokens must be an object of --piview-* custom properties');
  } else {
    for (const [name, value] of Object.entries(theme.tokens)) {
      if (!TOKEN_NAME_RE.test(name)) {
        issues.push(`invalid token name: ${name} (must start with --piview-)`);
      }
      if (typeof value !== 'string' || value.length === 0) {
        issues.push(`token ${name} must have a non-empty string value`);
      }
    }
  }

  if (theme.css !== undefined && typeof theme.css !== 'string') {
    issues.push('css must be a string when provided');
  }

  return issues;
}

/**
 * Create an immutable registry entry. The description is optional in a theme
 * declaration (filled from the label when omitted); the id and variant shape is
 * checked eagerly so a typo fails at module load instead of at paint time.
 */
export function defineTheme(theme: PiViewTheme): PiViewTheme {
  const withDescription: PiViewTheme = {
    ...theme,
    description: theme.description ?? theme.label,
  };
  const issues = validateTheme(withDescription);
  if (issues.length > 0) {
    throw new Error(`Invalid PiView theme "${String(theme.id)}": ${issues.join('; ')}`);
  }
  return Object.freeze(withDescription);
}

/**
 * The interactive conversation's token refinements. Everything colour-related
 * comes from the shared palette; these are only the card, measure and motion
 * choices that make a chat read differently from a dense transcript.
 */
function interactiveChatRefinements(palette: PalettePrimitives): PiViewTokens {
  return {
    '--piview-surface-formatted-active':
      `color-mix(in oklab, ${palette['--palette-surface']} 80%, ${palette['--palette-accent']} 20%)`,
    '--piview-max-width': '72ch',
    '--piview-shadow-block': '0 1px 2px rgba(0, 0, 0, 0.25)',
    '--piview-motion-pulse': 'piview-chat-pulse',
  };
}

/**
 * Roles whose dark-mode derivation is not accessible enough on the light
 * palette. The light accents themselves stay sky-700/cyan-700 in
 * {@link LIGHT_PALETTE}; this list only corrects non-accent roles. Syntax and
 * search are deliberately absent: they are derived from the light palette like
 * every other set-dependent role, so no fixed hue family is layered on top.
 */
const LIGHT_DEFAULT_OVERRIDES: PiViewTokens = {
  '--piview-surface-bash':
    'color-mix(in oklab, var(--color-slate-100) 70%, var(--color-slate-200) 30%)',
  '--piview-fg-ok': 'var(--color-green-800)',
  '--piview-fg-thinking': 'var(--color-amber-800)',
  '--piview-fg-error': 'var(--color-red-800)',
  '--piview-fg-heading': 'var(--color-slate-900)',
};

/**
 * The same accessibility corrections as {@link LIGHT_DEFAULT_OVERRIDES}, on the
 * alternative set's stone/amber family.
 */
const LIGHT_EMBER_OVERRIDES: PiViewTokens = {
  '--piview-surface-bash':
    'color-mix(in oklab, var(--color-stone-100) 70%, var(--color-stone-200) 30%)',
  '--piview-fg-ok': 'var(--color-green-800)',
  '--piview-fg-thinking': 'var(--color-amber-800)',
  '--piview-fg-user-label': 'var(--color-amber-800)',
  '--piview-fg-error': 'var(--color-red-800)',
  '--piview-fg-heading': 'var(--color-stone-900)',
};

/**
 * Derive a light PiView theme without the dark-only role assumptions. The
 * palette supplies every hue; the overrides only correct roles whose derived
 * value would fall below AA in light mode.
 */
function deriveLightTheme(
  palette: PalettePrimitives,
  density: PiViewDensity,
  chatRefinements: PiViewTokens = {},
  overrides: PiViewTokens
): PiViewTokens {
  return {
    ...derivePiviewTheme(palette, density, chatRefinements),
    ...overrides,
  };
}

/** Derive the harmonized default light theme. */
function deriveLightDefaultTheme(
  density: PiViewDensity,
  chatRefinements: PiViewTokens = {}
): PiViewTokens {
  return deriveLightTheme(LIGHT_PALETTE, density, chatRefinements, LIGHT_DEFAULT_OVERRIDES);
}

/** Derive the alternative "Ember" light theme. */
function deriveLightEmberTheme(
  density: PiViewDensity,
  chatRefinements: PiViewTokens = {}
): PiViewTokens {
  return deriveLightTheme(
    AMBER_LIGHT_PALETTE,
    density,
    chatRefinements,
    LIGHT_EMBER_OVERRIDES
  );
}

const INTERACTIVE_CHAT_CSS = `
@keyframes piview-chat-pulse {
  50% { opacity: 0.65; }
}

@keyframes piview-chat-fade-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}

#log-blocks > [data-block-id] {
  animation: piview-chat-fade-in 180ms ease-out both;
}

#piview-status-dot[data-state="active"] {
  animation: var(--piview-motion-pulse) 2.4s ease-in-out infinite;
}

#piview-status-bar {
  border-bottom-color: transparent;
}

[data-kind="user"] {
  border-left-width: 0;
  border-radius: calc(var(--piview-radius-block) + 4px);
  padding: calc(var(--piview-block-padding) * 0.75) var(--piview-block-padding);
  box-shadow: var(--piview-shadow-block);
}

.piview-text.piview-formatted-active {
  background-color: var(--piview-surface-formatted-active);
  border-radius: var(--piview-radius-block);
  padding: var(--piview-block-padding);
  box-shadow: var(--piview-shadow-block);
}

.piview-bash {
  border-radius: var(--piview-radius-block);
}

.piview-thinking {
  border-radius: 0;
}

@media (prefers-reduced-motion: reduce) {
  & {
    --piview-motion-pulse: none;
  }

  #log-blocks > [data-block-id] {
    animation: none;
  }

  #piview-status-dot[data-state="active"] {
    animation: none;
  }
}
`;

/** The dense default transcript, sharing the app's palette. */
const BATCH_DEFAULT_THEME = defineTheme({
  id: 'batch-default',
  label: 'Default',
  description: 'Dense, neutral transcript on the shared dark palette.',
  variants: ['batch', 'interactive'],
  tokens: derivePiviewTheme(DARK_PALETTE, 'compact'),
});

/** The roomy default conversation, sharing the same palette as the app. */
const INTERACTIVE_DEFAULT_THEME = defineTheme({
  id: 'interactive-default',
  label: 'Chat',
  description: 'Conversational layout with a calmer, roomier rhythm.',
  variants: ['interactive'],
  tokens: derivePiviewTheme(
    DARK_PALETTE,
    'roomy',
    interactiveChatRefinements(DARK_PALETTE)
  ),
  css: INTERACTIVE_CHAT_CSS,
});

/** The dense default transcript in light mode, sharing the app's light palette. */
const BATCH_DEFAULT_LIGHT_THEME = defineTheme({
  id: 'batch-default-light',
  label: 'Default (light)',
  description: 'Dense, neutral transcript on the shared light palette.',
  variants: ['batch', 'interactive'],
  tokens: deriveLightDefaultTheme('compact'),
});

/** The roomy default conversation in light mode, sharing the app's light palette. */
const INTERACTIVE_DEFAULT_LIGHT_THEME = defineTheme({
  id: 'interactive-default-light',
  label: 'Chat (light)',
  description: 'Conversational layout with a calmer, roomier rhythm in light mode.',
  variants: ['interactive'],
  tokens: deriveLightDefaultTheme(
    'roomy',
    interactiveChatRefinements(LIGHT_PALETTE)
  ),
  css: INTERACTIVE_CHAT_CSS,
});

/** The dense alternative transcript on the warm amber/rose palette. */
const BATCH_EMBER_THEME = defineTheme({
  id: 'batch-ember',
  label: 'Ember',
  description: 'Dense, warm transcript on the amber-and-rose palette.',
  variants: ['batch', 'interactive'],
  tokens: derivePiviewTheme(AMBER_DARK_PALETTE, 'compact'),
});

/** The roomy alternative conversation, sharing the Ember palette. */
const INTERACTIVE_EMBER_THEME = defineTheme({
  id: 'interactive-ember',
  label: 'Ember chat',
  description: 'Conversational layout with the warm amber-and-rose palette.',
  variants: ['interactive'],
  tokens: derivePiviewTheme(
    AMBER_DARK_PALETTE,
    'roomy',
    interactiveChatRefinements(AMBER_DARK_PALETTE)
  ),
  css: INTERACTIVE_CHAT_CSS,
});

/** The dense alternative transcript in light mode. */
const BATCH_EMBER_LIGHT_THEME = defineTheme({
  id: 'batch-ember-light',
  label: 'Ember (light)',
  description: 'Dense, warm transcript on the light amber-and-rose palette.',
  variants: ['batch', 'interactive'],
  tokens: deriveLightEmberTheme('compact'),
});

/** The roomy alternative conversation in light mode. */
const INTERACTIVE_EMBER_LIGHT_THEME = defineTheme({
  id: 'interactive-ember-light',
  label: 'Ember chat (light)',
  description: 'Conversational layout with the light amber-and-rose palette.',
  variants: ['interactive'],
  tokens: deriveLightEmberTheme(
    'roomy',
    interactiveChatRefinements(AMBER_LIGHT_PALETTE)
  ),
  css: INTERACTIVE_CHAT_CSS,
});

/**
 * The print preset. It is intentionally kept as a code-selectable preset
 * rather than a picker entry. Next to the harmonized light defaults it is
 * narrower in scope (batch only, print/serif typography) but still has a
 * distinct, useful look, so removing it would only shrink the public theme
 * registry. It is validated and covered by the registry-driven conformance
 * suite just like every other theme.
 */
const BATCH_PAPER_THEME = defineTheme({
  id: 'batch-paper',
  label: 'Paper',
  description:
    'Light, print-like transcript with paper surfaces, ink text and a muted, readable syntax palette.',
  variants: ['batch'],
  tokens: derivePiviewTheme(LIGHT_PALETTE, 'compact', {
    '--piview-bg': '#faf9f5',
    '--piview-bg-image': 'none',
    '--piview-surface': '#f2efe8',
    '--piview-surface-sticky': 'color-mix(in oklab, #faf9f5 95%, transparent)',
    '--piview-surface-tool': 'color-mix(in oklab, #f2efe8 60%, transparent)',
    '--piview-surface-bash': 'color-mix(in oklab, #faf9f5 60%, #d9d4c8 40%)',
    '--piview-surface-formatted-active': 'color-mix(in oklab, #f2efe8 70%, transparent)',
    '--piview-surface-pre': '#f2efe8',
    '--piview-surface-code': 'color-mix(in oklab, #f2efe8 80%, transparent)',
    '--piview-surface-hover': 'color-mix(in oklab, #e8e3d8 80%, transparent)',
    '--piview-surface-icon': 'color-mix(in oklab, #f2efe8 70%, transparent)',
    '--piview-border': '#d8d2c4',
    '--piview-border-subtle': 'color-mix(in oklab, #d8d2c4 60%, transparent)',
    '--piview-border-tool': 'color-mix(in oklab, #d8d2c4 70%, transparent)',
    '--piview-scrollbar-thumb': '#d8d2c4',
    '--piview-font-prose': '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    '--piview-font-size-prose': '13px',
    '--piview-leading-prose': '1.5',
    '--piview-radius-block': '0.125rem',
    '--piview-radius-chrome': '0.125rem',
    '--piview-shadow-block': 'none',
    '--piview-motion-pulse': 'none',
    '--piview-fg-ok': 'var(--color-green-800)',
    '--piview-fg-thinking': 'var(--color-amber-800)',
    '--piview-fg-error': 'var(--color-red-800)',
    '--piview-fg-heading': 'var(--color-slate-900)',
    '--piview-fg-status': 'var(--color-green-800)',
    '--piview-accent': 'var(--color-sky-700)',
  }),
  css: `
.piview-formatted {
  font-family: var(--piview-font-prose);
}
`,
});

/**
 * The low-chrome reading preset. Kept as a code-selectable preset (no picker),
 * matching `batch-paper`: it remains a distinct long-conversation mode even
 * though the harmonized interactive default now shares its neutral palette.
 * Registry-driven validation/conformance covers it automatically.
 */
const INTERACTIVE_FOCUS_THEME = defineTheme({
  id: 'interactive-focus',
  label: 'Focus',
  description:
    'Long-conversation reading mode: quieter chrome and thinking, high-contrast prose and a tight measure.',
  variants: ['interactive'],
  tokens: {
    ...BASE_CHAT_TOKENS,

    '--piview-bg': '#0b0f14',
    '--piview-surface': '#11161d',
    '--piview-surface-sticky': 'color-mix(in oklab, #0b0f14 96%, transparent)',
    '--piview-surface-tool': 'color-mix(in oklab, #11161d 35%, transparent)',
    '--piview-surface-bash': 'color-mix(in oklab, #0b0f14 88%, #000 12%)',
    '--piview-surface-formatted-active': 'color-mix(in oklab, #11161d 55%, transparent)',
    '--piview-surface-pre': '#0b0f14',
    '--piview-surface-code': 'color-mix(in oklab, #11161d 70%, transparent)',
    '--piview-surface-hover': 'color-mix(in oklab, #11161d 80%, transparent)',
    '--piview-surface-icon': 'color-mix(in oklab, #11161d 55%, transparent)',

    '--piview-fg': '#eef4fa',
    '--piview-fg-dim': 'color-mix(in oklab, #eef4fa 50%, transparent)',
    '--piview-fg-faint': 'color-mix(in oklab, #eef4fa 35%, transparent)',
    '--piview-fg-title': '#f8fbff',
    '--piview-fg-muted': '#9aa7b6',
    '--piview-fg-tool': '#93a2b3',
    '--piview-fg-thinking': '#8f8463',
    '--piview-fg-notice': '#7cc4e8',
    '--piview-fg-error': '#ff8a80',
    '--piview-fg-ok': '#7ee787',
    '--piview-fg-user-label': 'var(--color-sky-400)',
    '--piview-fg-status': '#7f8c9d',
    '--piview-fg-heading': '#f8fbff',
    '--piview-fg-link': 'var(--color-sky-400)',
    '--piview-fg-strong': '#ffffff',
    '--piview-fg-quote': '#c6d2df',
    '--piview-fg-code': 'var(--color-cyan-300)',
    '--piview-fg-pre': '#eef4fa',
    '--piview-fg-icon': '#7f8c9d',
    '--piview-fg-icon-format': 'var(--color-sky-400)',

    '--piview-border': '#232d39',
    '--piview-border-subtle': 'color-mix(in oklab, #232d39 35%, transparent)',
    '--piview-border-tool': 'color-mix(in oklab, #232d39 45%, transparent)',
    '--piview-border-accent-user': 'color-mix(in oklab, var(--color-sky-400) 30%, transparent)',
    '--piview-border-accent-thinking': 'color-mix(in oklab, #eef4fa 14%, transparent)',
    '--piview-border-accent-bash': 'color-mix(in oklab, var(--color-cyan-300) 25%, transparent)',
    '--piview-border-accent-quote': 'var(--color-sky-400)',
    '--piview-border-verification-ok': 'color-mix(in oklab, #7ee787 50%, transparent)',
    '--piview-border-verification-error': 'color-mix(in oklab, #ff8a80 50%, transparent)',

    '--piview-accent': 'var(--color-sky-400)',
    '--piview-accent-2': 'var(--color-cyan-300)',
    '--piview-accent-fg': '#0b0f14',
    '--piview-selection': 'color-mix(in oklab, var(--color-sky-400) 30%, transparent)',
    '--piview-focus-ring': 'var(--color-sky-400)',
    '--piview-danger': '#da3633',
    '--piview-danger-hover': '#b62324',
    '--piview-scrollbar-thumb': '#232d39',
    '--piview-scrollbar-track': 'transparent',
    '--piview-status-dot-idle': 'color-mix(in oklab, #eef4fa 25%, transparent)',
    '--piview-status-dot-active': '#7ee787',

    '--piview-font-size-prose': '14px',
    '--piview-leading-prose': '1.65',
    '--piview-max-width': '62ch',
    '--piview-block-gap': '1.125rem',
    '--piview-block-padding': '0.75rem',
    '--piview-radius-block': '8px',
    '--piview-radius-chrome': '6px',
    '--piview-shadow-block': 'none',
  },
});

/**
 * The single source of truth for available themes. Add a `defineTheme(...)`
 * entry here (and optionally point a variant default at it); no PiView code or
 * test needs to change. Each entry is the complete palette contribution for a
 * theme: the batch-paper and interactive-focus presets below are just a shared
 * token base plus the roles their intent changes.
 */
export const PI_VIEW_THEMES: Record<string, PiViewTheme> = {
  [BATCH_DEFAULT_THEME.id]: BATCH_DEFAULT_THEME,
  [BATCH_DEFAULT_LIGHT_THEME.id]: BATCH_DEFAULT_LIGHT_THEME,
  [BATCH_EMBER_THEME.id]: BATCH_EMBER_THEME,
  [BATCH_EMBER_LIGHT_THEME.id]: BATCH_EMBER_LIGHT_THEME,
  [BATCH_PAPER_THEME.id]: BATCH_PAPER_THEME,
  [INTERACTIVE_DEFAULT_THEME.id]: INTERACTIVE_DEFAULT_THEME,
  [INTERACTIVE_DEFAULT_LIGHT_THEME.id]: INTERACTIVE_DEFAULT_LIGHT_THEME,
  [INTERACTIVE_EMBER_THEME.id]: INTERACTIVE_EMBER_THEME,
  [INTERACTIVE_EMBER_LIGHT_THEME.id]: INTERACTIVE_EMBER_LIGHT_THEME,
  [INTERACTIVE_FOCUS_THEME.id]: INTERACTIVE_FOCUS_THEME,

  // Deprecated ids kept as aliases so existing `PiViewOptions.theme` strings
  // keep resolving to the harmonized defaults. The aliases are the same frozen
  // theme objects, so `data-piview-theme` and `getThemeId()` expose the new id.
  'batch-terminal': BATCH_DEFAULT_THEME,
  'interactive-chat': INTERACTIVE_DEFAULT_THEME,
};

/** Hard fallback if a variant has no (or an unknown) default theme. */
const HARD_FALLBACK_THEME_ID = 'batch-default';

/** The default theme for each session variant. */
export const DEFAULT_THEME_FOR_VARIANT: Record<PiViewVariant, string> = {
  batch: 'batch-default',
  interactive: 'interactive-default',
};

/**
 * Resolve the effective theme for a variant. Resolution order is:
 *
 *   explicit id/theme -> variant default -> `batch-default` hard fallback.
 *
 * Unknown ids deliberately resolve to the variant default instead of throwing,
 * so a stale persisted/embedding option can never break the log.
 */
export function resolveTheme(
  variant: PiViewVariant,
  id?: string | PiViewTheme
): PiViewTheme {
  if (id && typeof id !== 'string') {
    return id;
  }

  if (typeof id === 'string' && PI_VIEW_THEMES[id]) {
    return PI_VIEW_THEMES[id];
  }

  const variantDefaultId = DEFAULT_THEME_FOR_VARIANT[variant];
  const variantDefault = variantDefaultId ? PI_VIEW_THEMES[variantDefaultId] : undefined;
  return (
    variantDefault ??
    PI_VIEW_THEMES[HARD_FALLBACK_THEME_ID] ??
    BATCH_DEFAULT_THEME
  );
}

/** Tokens previously written to each log element, so stale overrides are
 * removed when switching to a theme that does not declare them. */
const appliedTokens = new WeakMap<HTMLElement, Set<string>>();

/** Scope theme-authored CSS under the theme's data attribute. */
function scopeThemeCss(css: string, id: string): string {
  const scope = `[data-piview-theme="${escapeAttributeValue(id)}"]`;

  const scopeSelectorList = (selectors: string): string =>
    splitTopLevel(selectors, ',')
      .map((selector) => {
        const trimmed = selector.trim();
        if (!trimmed) return '';
        if (trimmed === '&') return scope;
        return `${scope} ${trimmed}`;
      })
      .filter(Boolean)
      .join(', ');

  const transform = (source: string): string => {
    let out = '';
    let i = 0;
    while (i < source.length) {
      const brace = source.indexOf('{', i);
      const semi = source.indexOf(';', i);
      if (brace === -1) {
        out += source.slice(i);
        break;
      }
      if (semi !== -1 && semi < brace) {
        // A block-less at-rule such as @import; leave it alone.
        out += source.slice(i, semi + 1);
        i = semi + 1;
        continue;
      }

      const prelude = source.slice(i, brace).trim();
      const end = findMatchingBrace(source, brace);
      if (end === -1) {
        out += source.slice(i);
        break;
      }
      const body = source.slice(brace + 1, end);

      if (prelude.startsWith('@')) {
        if (/^@(?:media|supports|container|layer|scope|document)\b/i.test(prelude)) {
          out += `${prelude} {\n${transform(body)}\n}`;
        } else {
          // Keyframes, font-face, property, etc. are global by nature. The
          // theme still only uses them through rules scoped above.
          out += `${prelude} {${body}}`;
        }
      } else {
        out += `${scopeSelectorList(prelude)} {${body}}`;
      }
      i = end + 1;
    }
    return out;
  };

  return transform(css);
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let inComment = false;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      inComment = true;
      i++;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (ch === separator && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function ensureThemeStyle(theme: PiViewTheme): void {
  if (!theme.css) return;
  const scoped = scopeThemeCss(theme.css, theme.id);

  const existing = document.querySelector<HTMLStyleElement>(
    `style[data-piview-theme="${escapeAttributeValue(theme.id)}"]`
  );
  if (existing) {
    if (existing.textContent !== scoped) existing.textContent = scoped;
    return;
  }

  const style = document.createElement('style');
  style.setAttribute('data-piview-theme', theme.id);
  style.textContent = scoped;
  (document.head ?? document.documentElement).appendChild(style);
}

/**
 * Apply a theme to one PiView log element. Only that element's `style` and
 * `data-piview-theme` attribute change; no DOM is rebuilt and no view state is
 * touched. Theme `css`, when present, is injected once per theme id into a
 * single `<style data-piview-theme="<id>">` element scoped under the theme's
 * attribute.
 */
export function applyTheme(logEl: HTMLElement, theme: PiViewTheme): void {
  logEl.setAttribute('data-piview-theme', theme.id);

  const previous = appliedTokens.get(logEl);
  if (previous) {
    for (const name of previous) {
      if (!(name in theme.tokens)) logEl.style.removeProperty(name);
    }
  }

  const current = new Set<string>();
  for (const [name, value] of Object.entries(theme.tokens)) {
    logEl.style.setProperty(name, value);
    current.add(name);
  }
  appliedTokens.set(logEl, current);

  ensureThemeStyle(theme);
}
