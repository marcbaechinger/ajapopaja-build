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
 * working while new themes opt into new roles.
 *
 * Themes do not need to be complete. `PiView.css` supplies the default
 * (batch-terminal parity) values for every token, so a theme may override only
 * the handful of roles it cares about.
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

/** The batch-terminal parity palette lifted from the pre-theme PiView token block. */
export const BASE_DARK_TOKENS: PiViewTokens = {
  '--piview-bg': 'var(--color-black)',
  '--piview-bg-image': 'none',

  '--piview-surface': 'var(--color-slate-900)',
  '--piview-surface-sticky': 'color-mix(in oklab, var(--color-black) 95%, transparent)',
  '--piview-surface-tool': 'color-mix(in oklab, var(--color-slate-900) 40%, transparent)',
  '--piview-surface-bash': 'color-mix(in oklab, var(--color-black) 40%, transparent)',
  '--piview-surface-user': 'color-mix(in oklab, var(--color-sky-400) 10%, transparent)',
  '--piview-surface-verification-ok':
    'color-mix(in oklab, var(--color-green-950) 30%, transparent)',
  '--piview-surface-verification-error':
    'color-mix(in oklab, var(--color-red-950) 30%, transparent)',
  '--piview-surface-formatted-active':
    'color-mix(in oklab, var(--color-black) 20%, transparent)',
  '--piview-surface-pre': 'var(--color-slate-900)',
  '--piview-surface-code': 'color-mix(in oklab, var(--color-slate-900) 80%, transparent)',
  '--piview-surface-hover': 'color-mix(in oklab, var(--color-black) 80%, transparent)',
  '--piview-surface-icon': 'color-mix(in oklab, var(--color-black) 50%, transparent)',

  '--piview-fg': 'var(--color-green-400)',
  '--piview-fg-dim': 'color-mix(in oklab, var(--color-slate-100) 50%, transparent)',
  '--piview-fg-faint': 'color-mix(in oklab, var(--color-slate-100) 40%, transparent)',
  '--piview-fg-title': 'color-mix(in oklab, var(--color-slate-100) 70%, transparent)',
  '--piview-fg-muted': 'var(--color-slate-400)',
  '--piview-fg-tool': 'var(--color-green-300)',
  '--piview-fg-thinking': 'var(--color-yellow-200)',
  '--piview-fg-notice': 'var(--color-cyan-400)',
  '--piview-fg-error': 'var(--color-red-400)',
  '--piview-fg-ok': 'var(--color-green-400)',
  '--piview-fg-user-label': 'var(--color-sky-400)',
  '--piview-fg-status': 'var(--color-green-300)',
  '--piview-fg-heading': 'var(--color-sky-400)',
  '--piview-fg-link': 'var(--color-sky-400)',
  '--piview-fg-strong': 'var(--color-cyan-400)',
  '--piview-fg-quote': 'var(--color-slate-100)',
  '--piview-fg-code': 'var(--color-cyan-400)',
  '--piview-fg-pre': 'var(--color-slate-100)',
  '--piview-fg-icon': 'var(--color-green-300)',
  '--piview-fg-icon-format': 'var(--color-cyan-300)',

  '--piview-border': 'var(--color-slate-800)',
  '--piview-border-subtle': 'color-mix(in oklab, var(--color-slate-800) 40%, transparent)',
  '--piview-border-tool': 'color-mix(in oklab, var(--color-slate-800) 60%, transparent)',
  '--piview-border-accent-user': 'color-mix(in oklab, var(--color-sky-400) 60%, transparent)',
  '--piview-border-accent-thinking':
    'color-mix(in oklab, var(--color-slate-100) 20%, transparent)',
  '--piview-border-accent-bash': 'color-mix(in oklab, var(--color-cyan-400) 40%, transparent)',
  '--piview-border-accent-quote': 'var(--color-sky-400)',
  '--piview-border-verification-ok':
    'color-mix(in oklab, var(--color-green-500) 60%, transparent)',
  '--piview-border-verification-error':
    'color-mix(in oklab, var(--color-red-500) 60%, transparent)',

  '--piview-accent': 'var(--color-sky-400)',
  '--piview-accent-2': 'var(--color-cyan-400)',
  '--piview-accent-fg': 'var(--color-white)',
  '--piview-selection': 'color-mix(in oklab, var(--color-sky-400) 30%, transparent)',
  '--piview-search-hit': 'rgba(251, 191, 36, 0.35)',
  '--piview-search-hit-fg': 'inherit',
  '--piview-search-current': 'rgba(251, 191, 36, 0.9)',
  '--piview-search-current-fg': '#000',
  '--piview-search-current-outline': 'rgba(255, 255, 255, 0.7)',
  '--piview-focus-ring': 'var(--color-sky-400)',
  '--piview-danger': 'var(--color-red-600)',
  '--piview-danger-hover': 'var(--color-red-700)',

  '--piview-font-log': 'var(--font-mono)',
  '--piview-font-prose': 'var(--font-sans)',
  '--piview-font-size': '11px',
  '--piview-leading': '1.25',
  '--piview-font-size-prose': '12px',
  '--piview-leading-prose': '1.375',
  '--piview-block-gap': '0.875rem',
  '--piview-block-padding': '0.5rem',
  '--piview-radius-block': '0.25rem',
  '--piview-radius-chrome': '0.25rem',
  '--piview-shadow-block': 'none',
  '--piview-scrollbar-thumb': 'var(--color-slate-800)',
  '--piview-scrollbar-track': 'transparent',
  '--piview-status-dot-idle': 'color-mix(in oklab, var(--color-slate-100) 40%, transparent)',
  '--piview-status-dot-active': 'var(--color-green-400)',
  '--piview-motion-pulse': 'pulse',
  '--piview-shortcut-flash': 'rgba(255, 255, 255, 0.15)',

  '--piview-syntax-comment': '#8b949e',
  '--piview-syntax-keyword': '#ff7b72',
  '--piview-syntax-string': '#a5d6ff',
  '--piview-syntax-number': '#79c0ff',
  '--piview-syntax-built-in': '#ffa657',
  '--piview-syntax-title': '#d2a8ff',
  '--piview-syntax-tag': '#7ee787',
  '--piview-syntax-meta': '#8b949e',
  '--piview-syntax-addition': '#7ee787',
  '--piview-syntax-deletion': '#ffa198',
};

/**
 * A light base palette for print/paper-like themes. It starts from the dark
 * palette so themes only need to override what differs; the values are chosen
 * to keep the same role structure as {@link BASE_DARK_TOKENS}.
 */
export const BASE_LIGHT_TOKENS: PiViewTokens = {
  ...BASE_DARK_TOKENS,
  '--piview-bg': '#faf9f5',
  '--piview-bg-image': 'none',
  '--piview-surface': '#f2efe8',
  '--piview-surface-sticky': 'color-mix(in oklab, #faf9f5 95%, transparent)',
  '--piview-surface-tool': 'color-mix(in oklab, #f2efe8 60%, transparent)',
  '--piview-surface-bash': 'color-mix(in oklab, #faf9f5 60%, #d9d4c8 40%)',
  '--piview-surface-user': 'color-mix(in oklab, #0284c7 8%, transparent)',
  '--piview-surface-verification-ok': 'color-mix(in oklab, #bbf7d0 35%, transparent)',
  '--piview-surface-verification-error': 'color-mix(in oklab, #fecaca 35%, transparent)',
  '--piview-surface-formatted-active': 'color-mix(in oklab, #f2efe8 70%, transparent)',
  '--piview-surface-pre': '#f2efe8',
  '--piview-surface-code': 'color-mix(in oklab, #f2efe8 80%, transparent)',
  '--piview-surface-hover': 'color-mix(in oklab, #e8e3d8 80%, transparent)',
  '--piview-surface-icon': 'color-mix(in oklab, #f2efe8 70%, transparent)',

  '--piview-fg': '#1f2937',
  '--piview-fg-dim': 'color-mix(in oklab, #1f2937 55%, transparent)',
  '--piview-fg-faint': 'color-mix(in oklab, #1f2937 40%, transparent)',
  '--piview-fg-title': '#111827',
  '--piview-fg-muted': '#4b5563',
  '--piview-fg-tool': '#166534',
  '--piview-fg-thinking': '#92400e',
  '--piview-fg-notice': '#0e7490',
  '--piview-fg-error': '#b91c1c',
  '--piview-fg-ok': '#15803d',
  '--piview-fg-user-label': '#0369a1',
  '--piview-fg-status': '#15803d',
  '--piview-fg-heading': '#0f172a',
  '--piview-fg-link': '#0369a1',
  '--piview-fg-strong': '#0f172a',
  '--piview-fg-quote': '#374151',
  '--piview-fg-code': '#0e7490',
  '--piview-fg-pre': '#1f2937',
  '--piview-fg-icon': '#15803d',
  '--piview-fg-icon-format': '#0e7490',

  '--piview-border': '#d8d2c4',
  '--piview-border-subtle': 'color-mix(in oklab, #d8d2c4 60%, transparent)',
  '--piview-border-tool': 'color-mix(in oklab, #d8d2c4 70%, transparent)',
  '--piview-border-accent-user': 'color-mix(in oklab, #0284c7 50%, transparent)',
  '--piview-border-accent-thinking': 'color-mix(in oklab, #1f2937 20%, transparent)',
  '--piview-border-accent-bash': 'color-mix(in oklab, #0e7490 40%, transparent)',
  '--piview-border-accent-quote': '#0284c7',
  '--piview-border-verification-ok': 'color-mix(in oklab, #22c55e 55%, transparent)',
  '--piview-border-verification-error': 'color-mix(in oklab, #ef4444 55%, transparent)',

  '--piview-accent': '#0284c7',
  '--piview-accent-2': '#0e7490',
  '--piview-accent-fg': '#ffffff',
  '--piview-selection': 'color-mix(in oklab, #0284c7 22%, transparent)',
  '--piview-search-hit': 'rgba(251, 191, 36, 0.45)',
  '--piview-search-hit-fg': '#111827',
  '--piview-search-current': 'rgba(251, 191, 36, 0.95)',
  '--piview-search-current-fg': '#111827',
  '--piview-search-current-outline': 'rgba(17, 24, 39, 0.6)',
  '--piview-focus-ring': '#0284c7',
  '--piview-danger': '#dc2626',
  '--piview-danger-hover': '#b91c1c',

  '--piview-scrollbar-thumb': '#d8d2c4',
  '--piview-scrollbar-track': 'transparent',
  '--piview-status-dot-idle': 'color-mix(in oklab, #1f2937 35%, transparent)',
  '--piview-status-dot-active': '#15803d',
  '--piview-shortcut-flash': 'rgba(17, 24, 39, 0.12)',
};

/**
 * A chat-oriented base. Kept separate from the dark transcript palette so an
 * interactive theme can change typography/density without repeating colors.
 */
export const BASE_CHAT_TOKENS: PiViewTokens = {
  ...BASE_DARK_TOKENS,
  '--piview-font-size': '12px',
  '--piview-leading': '1.5',
  '--piview-font-size-prose': '13px',
  '--piview-leading-prose': '1.55',
  '--piview-block-gap': '1rem',
  '--piview-block-padding': '0.75rem',
  '--piview-radius-block': '0.625rem',
  '--piview-radius-chrome': '0.5rem',
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

const BATCH_TERMINAL_THEME = defineTheme({
  id: 'batch-terminal',
  label: 'Terminal',
  description: 'Dense terminal-style transcript on a dark surface.',
  variants: ['batch', 'interactive'],
  tokens: { ...BASE_DARK_TOKENS },
});

/**
 * Chat-specific refinements layered over {@link BASE_CHAT_TOKENS}. The neutral
 * palette keeps the answer readable without the terminal's green/cyan tints,
 * and the surface/typography overrides make an interactive session read as a
 * conversation rather than a dense transcript.
 */
const INTERACTIVE_CHAT_OVERRIDES: PiViewTokens = {
  '--piview-bg': '#0d1117',
  '--piview-surface': '#161b22',
  '--piview-surface-sticky': 'color-mix(in oklab, #0d1117 92%, transparent)',
  '--piview-surface-tool': 'color-mix(in oklab, #161b22 70%, transparent)',
  '--piview-surface-bash': 'color-mix(in oklab, #0d1117 82%, #000 18%)',
  '--piview-surface-user': 'color-mix(in oklab, #58a6ff 14%, #161b22)',
  '--piview-surface-verification-ok': 'color-mix(in oklab, #7ee787 14%, transparent)',
  '--piview-surface-verification-error': 'color-mix(in oklab, #ff7b72 14%, transparent)',
  '--piview-surface-formatted-active': 'color-mix(in oklab, #161b22 82%, #58a6ff 18%)',
  '--piview-surface-pre': '#0d1117',
  '--piview-surface-code': 'color-mix(in oklab, #161b22 80%, transparent)',
  '--piview-surface-hover': 'color-mix(in oklab, #161b22 85%, transparent)',
  '--piview-surface-icon': 'color-mix(in oklab, #161b22 65%, transparent)',

  '--piview-fg': '#d7e1ec',
  '--piview-fg-dim': 'color-mix(in oklab, #d7e1ec 55%, transparent)',
  '--piview-fg-faint': 'color-mix(in oklab, #d7e1ec 40%, transparent)',
  '--piview-fg-title': 'color-mix(in oklab, #d7e1ec 85%, transparent)',
  '--piview-fg-muted': '#8b98a9',
  '--piview-fg-tool': '#a9c7e8',
  '--piview-fg-thinking': 'color-mix(in oklab, #d7e1ec 55%, #f2cc60 45%)',
  '--piview-fg-notice': '#79c0ff',
  '--piview-fg-error': '#ff7b72',
  '--piview-fg-ok': '#7ee787',
  '--piview-fg-user-label': '#58a6ff',
  '--piview-fg-status': '#8b98a9',
  '--piview-fg-heading': '#e6edf3',
  '--piview-fg-link': '#79c0ff',
  '--piview-fg-strong': '#e6edf3',
  '--piview-fg-quote': '#b3c0cf',
  '--piview-fg-code': '#79c0ff',
  '--piview-fg-pre': '#d7e1ec',
  '--piview-fg-icon': '#8b98a9',
  '--piview-fg-icon-format': '#79c0ff',

  '--piview-border': '#2b3440',
  '--piview-border-subtle': 'color-mix(in oklab, #2b3440 40%, transparent)',
  '--piview-border-tool': 'color-mix(in oklab, #2b3440 65%, transparent)',
  '--piview-border-accent-user': 'color-mix(in oklab, #58a6ff 35%, transparent)',
  '--piview-border-accent-thinking': 'color-mix(in oklab, #d7e1ec 18%, transparent)',
  '--piview-border-accent-bash': 'color-mix(in oklab, #79c0ff 30%, transparent)',
  '--piview-border-accent-quote': '#58a6ff',
  '--piview-border-verification-ok': 'color-mix(in oklab, #7ee787 55%, transparent)',
  '--piview-border-verification-error': 'color-mix(in oklab, #ff7b72 55%, transparent)',

  '--piview-accent': '#58a6ff',
  '--piview-accent-2': '#79c0ff',
  '--piview-accent-fg': '#0d1117',
  '--piview-selection': 'color-mix(in oklab, #58a6ff 30%, transparent)',
  '--piview-focus-ring': '#58a6ff',
  '--piview-danger': '#da3633',
  '--piview-danger-hover': '#b62324',
  '--piview-scrollbar-thumb': '#2b3440',
  '--piview-scrollbar-track': 'transparent',
  '--piview-status-dot-idle': 'color-mix(in oklab, #d7e1ec 30%, transparent)',
  '--piview-status-dot-active': '#7ee787',

  '--piview-block-padding': '0.75rem',
  '--piview-radius-block': '10px',
  '--piview-radius-chrome': '8px',
  '--piview-shadow-block': '0 1px 2px rgba(0, 0, 0, 0.25)',
  '--piview-max-width': '72ch',
  '--piview-motion-pulse': 'piview-chat-pulse',
};

const INTERACTIVE_CHAT_THEME = defineTheme({
  id: 'interactive-chat',
  label: 'Chat',
  description: 'Conversational layout with a calmer, roomier rhythm.',
  variants: ['interactive'],
  tokens: { ...BASE_CHAT_TOKENS, ...INTERACTIVE_CHAT_OVERRIDES },
  css: `
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

.piview-bash,
.piview-thinking {
  border-radius: var(--piview-radius-block);
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
`,
});

/**
 * The single source of truth for available themes. Add a `defineTheme(...)`
 * entry here (and optionally point a variant default at it); no PiView code or
 * test needs to change.
 */
export const PI_VIEW_THEMES: Record<string, PiViewTheme> = {
  [BATCH_TERMINAL_THEME.id]: BATCH_TERMINAL_THEME,
  [INTERACTIVE_CHAT_THEME.id]: INTERACTIVE_CHAT_THEME,
};

/** Hard fallback if a variant has no (or an unknown) default theme. */
const HARD_FALLBACK_THEME_ID = 'batch-terminal';

/** The default theme for each session variant. */
export const DEFAULT_THEME_FOR_VARIANT: Record<PiViewVariant, string> = {
  batch: 'batch-terminal',
  interactive: 'interactive-chat',
};

/**
 * Resolve the effective theme for a variant. Resolution order is:
 *
 *   explicit id/theme -> variant default -> `batch-terminal` hard fallback.
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
    BATCH_TERMINAL_THEME
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
