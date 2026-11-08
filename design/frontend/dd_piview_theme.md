# Design: A customizable theme for PiView

## 1. Summary

`PiView` renders the output of a Pi agent session for **both** session types in
the product:

| Session type | Host | Mount |
|---|---|---|
| **batch** (`coderbot`) | `CoderBotDialog`, `ExecutionEngineController` (pipeline sidebar) | `#coderbot-piview-mount`, `#engine-piview-mount` |
| **interactive** (`interactive coding`) | `InteractiveCodingView` | `#interactive-piview-mount` |

Both hosts compose the *same* `PiView` class and therefore the same DOM, the
same block set (`text`, `thinking`, `tool`, `bash`, `notice`, `error`,
`divider`, `verification`, `user`) and the same Markdown-rendered *response
element* (`[data-role="formatted"].piview-formatted`).

Today the look & feel is **hard-coded**: colors live as Tailwind utility strings
inside `PiView.ts`, a few semantic `--app-*` tokens are used for chrome, and the
"always-dark terminal" assumption is patched into `style.css` with a
`[data-theme='light'] .piview-log` re-anchor hack. There is no way to restyle
PiView without editing TypeScript, and no way to make a batch log look different
from an interactive chat.

This document specifies a **theme system** that unlocks rich look & feel
customization while keeping the rendered HTML **byte-for-byte structurally
identical** — including the sanitized Markdown markup inside the response
element.

The hard constraint, restated precisely:

> No new elements, no changed nesting, no changed tag names, no changed
> `id`/`data-*`/`aria-*` hooks. Themes may only (a) change CSS custom property
> values, (b) add/remove a *theme selector* attribute on the existing PiView
> root, and (c) — as a small, additive, structure-neutral exception — add a
> `class` token or a `data-kind` attribute to **existing** elements where a
> styling hook is genuinely missing (see §5.3).

## 2. Current state

### 2.1 Where styling lives today

- `frontend/src/ui/components/session/PiView.ts` — ~2 100 lines. Every block is
  built with a Tailwind class string (`createBlockEl`, §1180–1326) and several
  of those strings are **duplicated** in update/toggle paths:
  - `toggleFollow` re-assigns the follow button's whole class string (1718),
  - `updateStatusDot` re-assigns the status dot's class string (2037),
  - `updateThinkingBtn` / `updateCollapseBtn` / `updateErrorBtn` swap classes.
- `frontend/src/style.css` — the PiView-owned rules: `mark.piview-search-match`
  (481), `.piview-formatted` + rhythm/measure (495–626), the
  `[data-theme='light'] .piview-log` re-anchor (628–648, rule at 641), and
  `.piview-thinking-body` (662–670).
- `frontend/src/ui/components/session/Keybinding.css` — `.shortcut-active`
  pulse uses literal `rgba(255,255,255,…)`.
- Global `--app-*` tokens (`style.css:11–60`) and `--syntax-*` (`371–394`) are
  the only existing token layer; `--piview-*` exists but only for *layout*
  (`--piview-gap-*`, `--piview-max-width`, `--piview-pre-max-width`).

### 2.2 Color utilities baked into `PiView.ts`

Census of color-only utilities in the file (excluding layout/spacing):

| Class | Uses | Meaning |
|---|---|---|
| `bg-black` | 6 | log surface, bash block tint, icon-button backdrops, status bar base |
| `text-green-400` | 3 | log default foreground, "session ended" |
| `text-green-300` | 5 | tool/verification bodies, search input, copy icon |
| `text-red-400` | 4 | error blocks, failed verification |
| `text-cyan-300` | 1 | "Format as markup" icon |
| `text-white` | 7 | primary-button foreground |
| `border-red-500/60`, `border-green-500/60`, `bg-red-950/30`, `bg-green-950/30` | 4 | verification error/ok |
| `text-app-accent-1/2`, `text-app-text/*`, `border-app-border/*`, `bg-app-surface*`, `bg-app-bg`, `bg-app-accent-1*` | ~45 | chrome (status bar, toolbar, footer, empty state, user block, thinking, divider) |

`text-yellow-200` / `slate-400` for thinking text live in `style.css`
(`.piview-thinking-body`) — already token-ish but hard-coded, and gated on the
*app* light/dark theme rather than on a PiView theme.

### 2.3 What this costs us

1. **No theming without a code change.** Restyling the log means editing a 2 100
   line TypeScript file; there is no data-only path.
2. **Palette is not semantic.** `text-green-300` says "green", not "tool
   output". A theme cannot say "tool output is lavender" without rewriting the
   builder.
3. **Duplicated truth.** The follow button's "on" style exists twice (build +
   toggle); the status dot's three states exist as inline strings. Any theme
   must be applied in every duplication site — a guaranteed drift source.
4. **Batch and interactive look identical** even though they are different
   products: a dense terminal transcript versus a chat. There is no per-variant
   styling dimension at all.
5. **The light-mode hack is a symptom.** `.piview-log` re-declares five
   `--app-*` tokens because the log is "always dark" while app chrome is
   themed. That is a *theme* being smuggled in through app tokens; with real
   PiView themes it can be deleted.
6. **Contrast/effects are unbounded.** No focus-ring token, no reduced-motion
   story, no scrollbar tokens scoped to the log, search highlight colors are
   literal `rgba(251,191,36,…)`.

## 3. Goals and non-goals

**Goals**

1. A **data-only theme definition** (tokens, optionally a little CSS) that can
   restyle PiView completely: colors, typography, density, radii, borders,
   shadows, textures, motion, scrollbars, search highlights, syntax colors.
2. **Two variants with independent themes** — `batch` and `interactive` —
   selected automatically per mount, overridable at runtime.
3. **Zero DOM churn on theme switch**: no re-render, no Markdown re-parse, no
   scroll jump, no lost selection, no flicker.
4. **Structural freeze** of the rendered HTML, guarded by a test.
5. **Elaborate themes stay small.** A theme author should specify a handful of
   *base* tokens; tints/derivations are computed by the default stylesheet.
6. Themeable *and* still accessible: AA contrast for text, visible focus,
   `prefers-reduced-motion` respected, `prefers-contrast` honored.
7. Extensible without touching `PiView.ts`: adding a theme is a new
   code-defined registry entry.

**Non-goals**

- Changing what PiView renders, its block model, the reducer, or the Markdown
  pipeline (`renderMarkdown`, DOMPurify).
- Changing the surrounding app theme system (`--app-*`, `[data-theme]`); PiView
  themes only *consume*/override inside the PiView subtree.
- Backend changes, session lifecycle, multi-session.
- Shipping a theme picker, visual theme editor, user-importable theme format, or
  any per-user/per-pipeline theme persistence.

## 4. Design overview

```
                ┌──────────────────────── PiView mount (host element) ─────────────────────────┐
                │                                                                               │
                │   #log-content-container.piview-log      ← the only themed subtree            │
                │     data-piview-theme="batch-terminal"   ← resolves token set                  │
                │     data-piview-variant="batch"          ← selects default theme / knobs       │
                │     style: --piview-bg, --piview-fg, …   ← tokens applied here (one element)   │
                │                                                                               │
                │     #piview-status-bar                                                         │
                │     #piview-toast                                                              │
                │     #log-blocks (space-y-3.5)                                                  │
                │        [data-block-id][data-kind] .piview-text                                  │
                │           [data-role="raw"]                                                    │
                │           [data-role="formatted"].piview-formatted  ← untouched sanitized HTML │
                │                                                                               │
                │   .piview-footer (toolbar / search / actions)  ← app chrome, not themed        │
                └───────────────────────────────────────────────────────────────────────────────┘
```

Three layers, one direction of dependency:

1. **Primitive layer** — a theme's raw palette (free-form, author's choice).
2. **Semantic layer** — role tokens (`--piview-fg-tool`, `--piview-surface-error`,
   …). Themes may set these directly *or* let them be derived from primitives.
3. **Component layer** — the CSS rules in `PiView.css` consume only semantic
   tokens. No rule may contain a literal color again.

The `PiView.ts` block builders keep **layout/behavior** utilities only
(`relative`, `group`, `hidden`, `whitespace-pre-wrap`, `break-all`, `flex`,
`space-y-3.5`, `h-[60vh]`, `resize-y`, …) and drop **every color utility**.

## 5. The DOM contract

### 5.1 Frozen structure

Everything in the table below is frozen. Themes must be expressible with
descendant/attribute selectors over these hooks. `PiView.ts` keeps emitting the
exact same tree.

| Hook | Element | Notes |
|---|---|---|
| `#log-content-container` `.piview-log` | `div` | log scroller; theme scope |
| `#piview-status-bar` `#piview-status-dot` `#piview-status-text` | `div`/`span` | status bar has `aria-live="polite"` |
| `#piview-toast` | `div` | copy toast |
| `#log-blocks` | `div` | `space-y-3.5` block spacing owner |
| `#piview-empty-state`, `#piview-empty-title`, `#piview-empty-state-action` | `div`/`p`/`button` | |
| `#piview-session-ended`, `#piview-session-ended-text` | `div`/`span` | |
| `#piview-search-bar`, `#piview-search-input`, `#piview-search-prev/-next`, `#piview-search-count` | | |
| `[data-block-id]` | every block element | set by `applyBlock` |
| `[data-role="header"]`, `[data-role="body"]`, `[data-role="raw"]`, `[data-role="formatted"]` | block internals | |
| `[data-glyph]`, `[data-label]`, `[data-toggle]` | collapsible header parts | |
| `[data-copy-block]`, `[data-format-block]`, `[data-action]` | buttons | |
| `.piview-user`, `.piview-toolverify`, `.piview-collapsible`, `.piview-thinking`, `.piview-thinking-body`, `.piview-error`, `.piview-text` | block shells | |
| `.piview-copy`, `.piview-format` | per-block buttons | |
| `.piview-search-match`, `.piview-search-current` | `<mark>` | |
| `.piview-formatted` + sanitized Markdown subtree | response element | **immutable** |

### 5.2 Response element: markup is off-limits

`renderMarkdown()` output (elements, attributes, classes emitted by `marked`
+ DOMPurify) is frozen. Theming it happens **only** through the typography
plugin's variables, which are already the sanctioned hook (`style.css:189–231`
maps `--tw-prose-*` to `--app-*`). PiView re-points them inside the theme scope:

```css
.piview-log .piview-formatted {
  --tw-prose-body: var(--piview-fg);
  --tw-prose-headings: var(--piview-fg-heading);
  --tw-prose-links: var(--piview-fg-link);
  --tw-prose-bold: var(--piview-fg-strong);
  --tw-prose-counters: var(--piview-fg-dim);
  --tw-prose-bullets: var(--piview-fg-dim);
  --tw-prose-hr: var(--piview-border);
  --tw-prose-quotes: var(--piview-fg-quote);
  --tw-prose-quote-borders: var(--piview-border-accent-quote);
  --tw-prose-code: var(--piview-fg-code);
  --tw-prose-pre-code: var(--piview-fg-pre);
  --tw-prose-pre-bg: var(--piview-surface-pre);
  --tw-prose-th-borders: var(--piview-border);
  --tw-prose-td-borders: var(--piview-border-subtle);
  /* …and the --tw-prose-invert-* mirrors */
}
```

Because `.piview-formatted` already applies `prose-theme`, no selector or class
change is needed. The existing `--piview-gap-*` / `--piview-max-width` layout
tokens stay exactly where they are; a theme may additionally override them
(a "chat" theme wants a narrower measure, a "transcript" theme a wider one).

### 5.3 Hook gaps (the only permitted DOM-adjacent change)

The audit found blocks that cannot be targeted today without relying on
color utilities or positional CSS. Each fix is **an added class token or
`data-kind` attribute on an element that already exists** — no node added,
removed, or re-parented:

| Block kind | Existing hook | Gap | Added hook |
|---|---|---|---|
| `bash` | none on the `<pre>` | untargetable | `class="piview-bash"` |
| `notice` | none | untargetable | `class="piview-notice"` |
| `divider` | none | untargetable | `class="piview-divider"` |
| `verification` | `.piview-toolverify` (shared with `tool`) | cannot distinguish ok/failed from `tool` | `.piview-verification` + `.piview-verification-ok` / `.piview-verification-error` |
| default/unknown | none | untargetable | `class="piview-block"` |
| all blocks | `[data-block-id]` | kind only knowable from class soup | `data-kind="<BlockKind>"` |

`data-kind` is the recommended long-term selector: it is stable, enumerated by
`BlockKind`, and lets every theme rule be written as
`.piview-log [data-kind="tool"] [data-role="body"]`. It is an attribute on an
existing element, so the structural-freeze test still passes (see §12).

## 6. Token reference

Naming: `--piview-<role>` — same prefix as the existing layout tokens, so there
is one namespace. Tokens are **declared on the PiView log element**
(`#log-content-container.piview-log`, not on `:root`), so two PiViews in one
document can carry different themes.

### 6.1 Surfaces

| Token | Today | Purpose |
|---|---|---|
| `--piview-bg` | `bg-black` | log background |
| `--piview-bg-image` | – | optional texture/gradient (`none` by default) |
| `--piview-surface` | `--app-surface` | base raised surface for blocks |
| `--piview-surface-sticky` | `bg-black/95` | status bar (needs alpha) |
| `--piview-surface-tool` | `bg-app-surface/40` | tool block |
| `--piview-surface-bash` | `bg-black/40` | bash block |
| `--piview-surface-user` | `bg-app-accent-1/10` | user message |
| `--piview-surface-verification-ok` | `bg-green-950/30` | passed verification |
| `--piview-surface-verification-error` | `bg-red-950/30` | failed verification |
| `--piview-surface-formatted-active` | `bg-black/20` | block that is Markdown-rendered |
| `--piview-surface-pre` | `--app-surface` | `pre` inside the response element |
| `--piview-surface-code` | `--app-surface/80` | inline `code` |
| `--piview-surface-hover` | `bg-black/80` | per-block icon button hover state |

### 6.2 Foreground

| Token | Today | Purpose |
|---|---|---|
| `--piview-fg` | `text-green-400` | log default text |
| `--piview-fg-dim` | `text-app-text/40..50` | dividers, glyphs, placeholder |
| `--piview-fg-tool` | `text-green-300` | tool/verification body |
| `--piview-fg-thinking` | `yellow-200` / `slate-400` | thinking body |
| `--piview-fg-notice` | `text-app-accent-2` | notice |
| `--piview-fg-error` | `text-red-400` | error block, failed verification |
| `--piview-fg-ok` | `text-green-400` | passed verification, "session ended" |
| `--piview-fg-user-label` | `text-app-accent-1` | "You" label |
| `--piview-fg-status` | `text-green-300` | status bar text |
| `--piview-fg-heading` / `-link` / `-strong` / `-quote` / `-code` / `-pre` | `--app-*` | response element typography |
| `--piview-fg-icon` | `text-green-300`, `text-cyan-300` | per-block action icons |

### 6.3 Borders, accents, highlights

| Token | Today | Purpose |
|---|---|---|
| `--piview-border` | `border-app-border` | generic block border |
| `--piview-border-subtle` | `border-app-border/40..60` | status bar, divider |
| `--piview-border-accent-user` | `border-app-accent-1/60` | user left accent |
| `--piview-border-accent-thinking` | `border-app-text/20` | thinking left accent |
| `--piview-border-accent-bash` | `border-app-accent-2/40` | bash left accent |
| `--piview-border-verification-ok/-error` | `border-green-500/60`, `border-red-500/60` | verification frame |
| `--piview-accent` | `--app-accent-1` | primary action |
| `--piview-accent-2` | `--app-accent-2` | secondary |
| `--piview-accent-fg` | `text-white` | on-accent text |
| `--piview-selection` | `selection:bg-app-accent-1/30` | text selection in log |
| `--piview-search-hit` / `-fg` | `rgba(251,191,36,.35)` / inherit | `<mark>` |
| `--piview-search-current` / `-fg` | `rgba(251,191,36,.9)` / `#000` | current match |
| `--piview-focus-ring` | (new) | `:focus-visible` outline |
| `--piview-danger` / `--piview-danger-hover` | `red-600` / `red-700` | Stop button |

### 6.4 Typography, density, chrome, motion

| Token | Today | Purpose |
|---|---|---|
| `--piview-font-log` | `font-mono` | log font stack |
| `--piview-font-prose` | `font-sans` (via class) | response element font |
| `--piview-font-size` | `text-[11px]` | log base size |
| `--piview-leading` | `leading-tight` | log line height |
| `--piview-font-size-prose` / `--piview-leading-prose` | `12px` / `leading-snug` | response element |
| `--piview-block-gap` | `space-y-3.5` | inter-block spacing |
| `--piview-block-padding` | `p-2` | block padding |
| `--piview-radius-block` / `-chrome` | `rounded` | radii |
| `--piview-shadow-block` | – | optional elevation |
| `--piview-scrollbar-thumb` / `-track` | global `--app-border` | log-scoped scrollbar |
| `--piview-status-dot-idle` / `-active` | `bg-app-text/40` / `bg-green-400` | status dot |
| `--piview-motion-pulse` | `animate-pulse` | active dot animation (set `none` for reduced motion) |
| `--piview-syntax-*` (10 tokens) | global `--syntax-*` | highlight.js inside the log |

### 6.5 Derivation: elaborate themes from few knobs

A theme author should not have to specify 60 tokens. The default stylesheet
declares **derived defaults** that a theme can override individually:

```css
.piview-log {
  /* base knobs a theme is expected to set */
  --piview-bg: #05070a;
  --piview-fg: #4ade80;
  --piview-accent: #38bdf8;
  --piview-accent-2: #22d3ee;
  --piview-fg-error: #f87171;
  --piview-fg-ok: var(--piview-fg);

  /* derived: sane defaults, individually overridable */
  --piview-surface: color-mix(in oklab, var(--piview-bg) 82%, var(--piview-fg) 18%);
  --piview-surface-tool: color-mix(in oklab, var(--piview-surface) 40%, transparent);
  --piview-surface-bash: color-mix(in oklab, var(--piview-bg) 60%, #000 40%);
  --piview-border: color-mix(in oklab, var(--piview-fg) 18%, transparent);
  --piview-border-subtle: color-mix(in oklab, var(--piview-border) 55%, transparent);
  --piview-fg-dim: color-mix(in oklab, var(--piview-fg) 45%, transparent);
  --piview-fg-tool: color-mix(in oklab, var(--piview-fg) 80%, var(--piview-accent-2) 20%);
  --piview-fg-thinking: color-mix(in oklab, var(--piview-fg) 55%, #fde68a 45%);
  /* …*/
}
```

Consequences:

- `color-mix(in oklab, …)` gives perceptually sane tints and lets one knob
  drive dozens of shades, including alpha (`… 40%, transparent`).
- A *minimal* theme is ~6 declarations; an *elaborate* theme can pin every
  token. Overriding a derived token wins because it is the same custom property.
- No `!important` arms race with Tailwind: all PiView rules are unlayered
  component CSS that only consume variables.

### 6.6 Authoring a theme

A theme is a `defineTheme({...})` entry in `piviewThemes.ts`. Start from the
token reference in §6 (the registry's `BASE_*_TOKENS` and `PiView.css` are the
complete current list) and override only the roles the theme changes.

- **Derivation:** the stylesheet derives surfaces, borders and secondary
  foreground roles from six base knobs (`--piview-bg`, `--piview-fg`,
  `--piview-accent`, `--piview-accent-2`, `--piview-fg-error`,
  `--piview-fg-ok`) via `color-mix()`. A minimal theme needs only those; an
  elaborate theme may pin any derived token.
- **Accessibility floors:** every theme must meet WCAG AA (4.5:1) for the
  documented foreground/background pairs in §10, and must not reduce
  `--piview-font-size` below 11px or `--piview-leading` below 1.2.
- **Validation:** run `validateTheme()` (or let `defineTheme()` do it eagerly)
  to reject a malformed id, unsupported/duplicate variant, non-`--piview-*`
  token name, empty token value, or non-string `css`.
- **Structure is off-limits:** a theme may only change CSS custom-property
  values and add scoped CSS that targets the existing hooks. It may never alter
  DOM structure — no added/removed/re-parented elements or changed `id`/
  `data-*`/`aria-*` hooks — and may never change the rendered Markdown markup
  inside `.piview-formatted`. Theme CSS is scoped under
  `[data-piview-theme="<id>"]` by the loader.

## 7. Theme registry and API

### 7.1 Types

New module `frontend/src/ui/components/session/piviewThemes.ts` (pure data + tiny
helpers, no DOM building):

```ts
export type PiViewVariant = 'batch' | 'interactive';

/** Tokens are plain CSS values. */
export type PiViewTokens = Record<`--piview-${string}`, string>;

export interface PiViewTheme {
  /** Stable id, exposed as `data-piview-theme`. */
  id: string;
  /** Human-readable name for code-defined selection and diagnostics. */
  label: string;
  /** One-line description for code-defined selection and diagnostics. */
  description?: string;
  /** Variants this theme is designed for (a theme may serve both). */
  variants: PiViewVariant[];
  /** Semantic tokens applied to the PiView log element. */
  tokens: PiViewTokens;
  /**
   * Optional extra CSS for what variables cannot express (textures, pseudo-
   * elements, keyframes). Scoped to `[data-piview-theme="<id>"]` by the loader,
   * so it can only affect PiView. Never allowed to change layout structure.
   */
  css?: string;
}

export const PI_VIEW_THEMES: Record<string, PiViewTheme>;
export const DEFAULT_THEME_FOR_VARIANT: Record<PiViewVariant, string>;
export function resolveTheme(
  variant: PiViewVariant,
  id?: string | PiViewTheme
): PiViewTheme;
export function applyTheme(logEl: HTMLElement, theme: PiViewTheme): void;
export function validateTheme(theme: PiViewTheme): string[];
```

`applyTheme` sets the theme attribute on the log element and writes tokens with
`style.setProperty(name, value)` — one element touched, no DOM rebuild.

### 7.2 `PiViewOptions` additions

```ts
export interface PiViewOptions {
  /* …existing… */
  /**
   * Session variant this view renders. Selects the default theme and lets a
   * theme vary knobs (density, radii) per session type. Default 'batch'.
   */
  variant?: PiViewVariant;
  /**
   * Explicit theme id (or theme object for data-only embedding/tests),
   * overriding the variant default. Unknown ids fall back to the variant
   * default (and log a dev warning) instead of breaking the log. Nothing is
   * persisted.
   */
  theme?: string | PiViewTheme;
}
```

Plus small public methods, mirroring existing `isFollowing()` /
`toggleFollow()`:

```ts
getVariant(): PiViewVariant;
getThemeId(): string;
setTheme(idOrTheme: string | PiViewTheme): void; // runtime switch, no re-render
onThemeChange(listener: (id: string) => void): () => void;
```

### 7.3 Resolution order

```
options.theme (string id or theme object)
  → DEFAULT_THEME_FOR_VARIANT[variant]
  → 'batch-terminal'  (hard fallback, builtin, cannot be missing)
```

Resolution happens in the constructor (before `render()`), so the first paint is
already themed — no flash of default colors. `applyTheme` runs again on
`setTheme()`.

### 7.4 Integration with the app theme

PiView themes are **self-contained**: each declares its own base mode and does
not read `--app-*` (or `[data-theme]`) for log-internal roles. This is what makes
deleting the `[data-theme='light'] .piview-log` hack possible: fixed-mode themes
such as `batch-terminal` are dark regardless of the surrounding app theme, while
`batch-paper` is light.

The footer, toolbar and search bar are **not** part of the themed subtree. They
stay on the host app's chrome tokens (`--app-*`, mapped to `--color-app-*` in
CSS), so an embedded sidebar keeps its host's controls even when its log uses a
paper or chat preset. Every `--piview-*` consumer is scoped under `.piview-log`;
footer rules never read `--piview-*`.

## 8. Batch vs interactive

### 8.1 What should differ

The two session types are different products, so the *defaults* should differ
even though the DOM is shared:

| Aspect | `batch` (transcript) | `interactive` (chat) |
|---|---|---|
| Log font | monospace, 11px, tight | mono for tool output, prose-forward for answers |
| Measure | wide (`87ch`/`130ch` today) | narrower (`~72ch`) for readable prose |
| User block | inline accent bar | distinct bubble, larger radius, more padding |
| Blocks | square-ish (`4px`), flat, dense | rounded (`10px`), slight elevation |
| Tool blocks | expanded, border-framed | collapsed by default (already the case) |
| Thinking | muted italic | muted, collapsible, even dimmer |
| Status bar | always visible, telemetry-like | subtle, blends with the chat surface |
| Response element | full-width answer, `font-sans` | card-like answer surface with padding |
| Motion | none / minimal | caret + gentle fade-in for new blocks |
| Palette | terminal green/cyan | calmer neutral + accent |

Behavioral differences already exist and stay: interactive mounts with
`blocksCollapsedInitially: true` and `showFooter: false`.

### 8.2 Variant propagation

`variant` is supplied by the host (it knows what it mounted):

- `CoderBotDialog` → default (batch)
- `ExecutionEngineController.mountCoderBotPiView` → `variant: 'batch'`
- `InteractiveCodingView` → `variant: 'interactive'`

Optionally, `PiSessionService` gains an optional
`getSessionKind?(): PiViewVariant`; when `variant` is omitted and the service
implements it, PiView resolves the variant itself (and re-resolves on session
state changes). The existing `InteractiveCodingService` adapter already refuses
to attach batch sessions, so this is a convenience, not the primary mechanism.

### 8.3 Built-in themes

- `batch-terminal` (default batch) — dark terminal transcript, tokenized,
  pixel-parity target.
- `batch-paper` — light, print-like transcript for screenshot/archival use.
- `interactive-chat` (default interactive) — chat surface, bubbles, soft radii.
- `interactive-focus` — low-chrome, high-contrast reading mode for long
  conversations.

Themes declare `variants`, so a preset may serve one or both variants. They are
selected from code through the `theme` option (or `setTheme()`); there is no
picker. A theme with `variants: ['batch', 'interactive']` is selectable for both.

## 9. Selecting a theme (code)

Themes are resolved from code; there is no picker, user selection, `localStorage`
or per-pipeline persistence.

1. **Host/constructor** — pass `variant: 'batch' | 'interactive'` and optionally
   `theme: '<id>'`. An omitted `theme` uses
   `DEFAULT_THEME_FOR_VARIANT[variant]`; an unknown id warns once and falls back
   to the variant default.
2. **Runtime** — `setTheme(id)` switches the existing log in place without
   re-rendering; `getThemeId()` and `onThemeChange()` expose the effective theme.
3. **Adding a preset** — add a `defineTheme(...)` entry to `piviewThemes.ts` and,
   to make it a default, point `DEFAULT_THEME_FOR_VARIANT` at its id. No picker,
   persistence, import or editor code is involved.

## 10. Accessibility

- **Contrast**: every shipped theme must pass WCAG AA (4.5:1) for
  `--piview-fg` on `--piview-bg`, `--piview-fg-tool` on
  `--piview-surface-tool`, `--piview-fg-error` on
  `--piview-surface-verification-error`, and the status text. The
  registry-driven conformance suite checks every documented pair for every
  registered theme and both variants.
- **Focus**: `--piview-focus-ring` drives a real `:focus-visible` outline on
  toolbar, search, copy and format buttons (today they rely on browser defaults
  while using dark backgrounds).
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` sets
  `--piview-motion-pulse: none` and disables the `.shortcut-active` animation.
- **Search highlights** must not be conveyed by color alone in the current-match
  case (keep the outline) and must respect `forced-colors`.
- Themes may not reduce `--piview-font-size` below 11px or `--piview-leading`
  below 1.2. `validateTheme()` validates the theme's shape (id, label, variants,
  token names/values, `css` type) but does not silently repair an inaccessible
  palette. Contrast is checked by the conformance suite; the font-size/leading
  floors are authoring rules checked in review.

## 11. Performance

- Theme switch = `setAttribute` + `N × style.setProperty` on **one** element.
  No block reconciliation, no `renderMarkdown`, no reflow of the block list
  beyond style recalculation. Expected cost « 1 frame.
- No FOUC: the theme is applied before `render()` appends the log area.
- `--piview-*` values are static per element, so they are cheap in the style
  engine; avoid per-block inline vars.
- The optional `css` field of a theme is injected once per theme id into a
  single `<style data-piview-theme="<id>">` element, not per block.

## 12. Testing

The theme work is covered by three registry-driven suites plus the existing
PiView and host-wiring tests:

1. **`PiView.structure.test.ts` (Task 1)** — the frozen DOM contract: tag names,
   class hooks and `data-kind`/`data-*` attributes for every `BlockKind`,
   collapsible internals, and the allow-list of element types inside
   `#log-content-container`.
2. **`PiView.themeConformance.test.ts` (Task 8)** — registry-driven coverage
   across every registered theme and both variants:
   - structure freeze (normalized DOM equality),
   - Markdown/markup freeze (`.piview-formatted` `innerHTML` equality,
     including manual formatting),
   - token resolution and WCAG AA contrast for every documented pair,
   - reduced-motion handling,
   - switch safety (scroll position, follow mode, collapse state, search
     highlights and formatted blocks survive `setTheme()`),
   - stylesheet isolation, including footer chrome staying on app tokens.
3. **`piviewThemes.test.ts`** — registry/`validateTheme()` shape checks,
   explicit → variant-default → hard-fallback resolution, token application and
   stale-token cleanup, derivation defaults for a six-knob theme, and the
   `interactive-chat` preset.
4. **Existing suites stay green:** `PiView.test.ts`,
   `PiView.keyboard.test.ts`, and the host-wiring tests
   (`InteractiveCodingView.test.ts`, `CoderBotDialog.test.ts`,
   `ExecutionEngineController.test.ts`).
5. `tsc` + the full frontend suite, as with every other change here.

## 13. Migration plan

**Phase 0 — de-hardcode (no behavior change).**
1. Add the §5.3 hooks (`piview-bash`, `piview-notice`, `piview-divider`,
   `piview-verification*`, `data-kind`).
2. Move every color utility out of `PiView.ts` into `PiView.css` rules keyed on
   the frozen hooks; keep layout/behavior utilities in TS.
3. De-duplicate the class strings in `toggleFollow`, `updateStatusDot`,
   `updateThinkingBtn`/`updateCollapseBtn`/`updateErrorBtn` into state-driven
   attributes (`data-state="on|off"`, `data-active`) so the CSS owns appearance
   and TS owns state.
4. Introduce the token layer with values that reproduce today's rendering
   **exactly**; verify with side-by-side screenshots (light + dark).
5. Delete `[data-theme='light'] .piview-log` (628–648) and
   `.piview-thinking-body`'s light-mode branch; both are replaced by theme
   tokens.

**Phase 1 — registry + variants.**
6. Add `piviewThemes.ts`, `variant`/`theme` options, `setTheme`, and variant
   wiring for the three hosts.
7. Ship `batch-terminal` (parity) and `interactive-chat`; wire the three hosts.

**Phase 2 — presets and conformance.**
8. Add `batch-paper` and `interactive-focus` as code-selectable presets in the
   registry.
9. Add the registry-driven conformance suite: structure and markup freeze, AA
   contrast, reduced motion, switch safety and stylesheet isolation.

There is no picker, action-registry command, user/pipeline persistence, JSON
import, theme editor, or versioning/migration phase.

**Files touched:** `PiView.ts`, `PiView.css`, `style.css` (remove the light
hack), `piviewThemes.ts`, `InteractiveCodingView.ts`,
`ExecutionEngineController.ts`, `CoderBotDialog.ts`, `Keybinding.css`,
`PiView.test.ts`, `PiView.structure.test.ts`, `PiView.themeConformance.test.ts`,
`piviewThemes.test.ts`.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Structure-freeze test is too strict and blocks legitimate future markup changes | The test compares against a checked-in expected map per block kind; updating it is an explicit, reviewed diff — that is the point. |
| Cascade fights: Tailwind utilities vs unlayered `PiView.css` | Remove color utilities from TS entirely; keep layout utilities (layered) untouched. No `!important` in theme rules. |
| Theme leak into the Markdown editors (`prose-theme` is shared) | All new rules are scoped under `.piview-log` / `[data-piview-theme="<id>"]`; `--tw-prose-*` re-pointing is scoped to `.piview-log .piview-formatted`. |
| `color-mix` browser support | Baseline in all current evergreen browsers; the builtin themes also pin explicit token values where parity matters. |
| Two PiViews with different themes on one page | Tokens and the theme attribute live on each log element, not `:root`; the conformance suite switches each view through every theme. |
| Existing tests assert color classes | Phase 0 retargets them deliberately; the current suites are listed in §12. |
| Theme author breaks accessibility | Registry-driven AA contrast checks in the conformance suite plus documented font-size/leading floors and `validateTheme()` shape checks. |

## 15. Resolved decisions

- **Chrome stays host-owned.** The footer, toolbar and search bar stay on the
  app's `--app-*` chrome tokens; only the `.piview-log` subtree is themed. This
  keeps embedded sidebars visually consistent with their host.
- **Two variants only.** PiView supports `batch` and `interactive`. There is no
  `replay`/archived variant; archived output is rendered through `batch`.
- **Code-resolved, not user-selected.** The theme comes from the `theme` option,
  falling back to `DEFAULT_THEME_FOR_VARIANT[variant]`. There is no picker UI,
  no user selection, no `localStorage`, and no per-pipeline persistence.
- **No data/import format.** Themes are code-defined registry entries. There is
  no JSON/user-importable theme format, no theme versioning, and no migration
  path.
- **Density is per-role, not a single knob.** Density is expressed through the
  typography/padding/radius tokens (for example `--piview-block-padding`), not a
  `--piview-density` multiplier.

## 16. Acceptance criteria

- [ ] PiView renders identically (structurally) across all themes; freeze tests
      pass for both variants.
- [ ] No color literal or color utility remains in `PiView.ts`.
- [ ] `batch` and `interactive` mount with different themes by default.
- [ ] `setTheme()` switches look in a single frame without losing scroll,
      follow mode, collapse state, formatted blocks or search highlights.
- [ ] `[data-theme='light'] .piview-log` hack is gone.
- [ ] All shipped themes pass the contrast checks; reduced-motion is honored.
- [ ] `tsc` and the full frontend test suite are green.
