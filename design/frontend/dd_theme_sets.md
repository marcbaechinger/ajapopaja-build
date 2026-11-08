# Design: Harmonized theme sets (app + interactive PiView + batch PiView)

## 1. Summary

The application currently renders through **three disconnected theme systems**:

| # | Surface | System | Palette today |
|---|---|---|---|
| 1 | App UI (chrome, dashboard, dialogs, footers) | `--app-*` on `<html data-theme="light|dark">` | slate neutrals + `sky-400`/`cyan-400` accents |
| 2 | Interactive session log | `interactive-chat` PiView theme | GitHub-dark neutrals (`#0d1117`/`#161b22`) + `#58a6ff`/`#79c0ff` accents |
| 3 | Batch session log | `batch-terminal` PiView theme | black + `green-400` terminal foreground, `sky`/`cyan` accents |

Each looks good on its own, but side by side the palettes disagree: the
interactive log is blue-gray while the surrounding app is slate/sky, and the
batch log is a green terminal while the interactive log is a neutral chat.

This document specifies a **theme set** — a first-class unit that bundles the
three surfaces under one palette — plus:

1. **Harmonization of the default set**: the interactive palette adopts the app
   palette; the batch palette adopts the interactive palette. Density stays
   distinct (batch = compact sidebar, interactive = generous centre).
2. A **second, alternative set** with a different palette.
3. A **picker in `DashboardView`** so the user chooses the set once and all
   three surfaces follow.

## 2. Current state (facts)

### 2.1 App theme

- `frontend/src/style.css:21` `:root` and `:35` `[data-theme='light']` define
  seven `--app-*` tokens (plus `--syntax-*`):
  - dark: `bg=slate-950`, `surface=slate-900`, `text=slate-100`,
    `muted=slate-400`, `border=slate-800`, `accent-1=sky-400`,
    `accent-2=cyan-400`.
  - light: `bg=slate-50`, `surface=white`, `text=slate-900`, `muted=slate-500`,
    `border=slate-200`, `accent-1=sky-600`, `accent-2=cyan-600`.
- `frontend/src/core/AppContext.ts`: `AppState.theme` is `'light' | 'dark'`
  (line 50), initialised from the `data-theme` attribute with a `'dark'` default
  (line 112) — **no localStorage persistence**. The `toggle_theme` action
  (line 184) flips `data-theme` on `<html>`.
- The header button lives in `frontend/src/ui/views/DashboardView.ts:307`
  (`data-action-click="toggle_theme"`), a single moon/sun icon.

### 2.2 PiView themes

- `frontend/src/ui/components/session/piviewThemes.ts` is the registry. Four
  themes: `batch-terminal` (dense dark transcript), `batch-paper` (light print),
  `interactive-chat` (roomy conversation), `interactive-focus` (low-chrome
  reading). Token bases: `BASE_DARK_TOKENS` (line 77), `BASE_LIGHT_TOKENS`
  (line 179), `BASE_CHAT_TOKENS` (line 251).
- `DEFAULT_THEME_FOR_VARIANT` (line 618): `batch → batch-terminal`,
  `interactive → interactive-chat`.
- `PiView.ts` resolves a theme from `variant` + optional `theme` in the
  constructor (`resolveTheme`, applied via `applyTheme` which writes
  `--piview-*` onto the **log element** and sets `data-piview-theme`). It has
  `setTheme()`, `onThemeChange()`, and never special-cases a theme id.
- Host wiring: batch = `ExecutionEngineController.ts:198` and
  `CoderBotDialog.ts:50` (`variant: 'batch'`); interactive =
  `InteractiveCodingView.ts` (`variant: 'interactive'`, `showFooter: false`).
- The footer/toolbar chrome (and search bar) intentionally stay on `--color-app-*`
  (`PiView.css:620` onward), so it already follows the app theme. Only the
  *log subtree* uses `--piview-*`.

### 2.3 Density is already tokenised

The compact-vs-generous difference is already expressible per surface and is
**orthogonal to palette**:

| Token | batch (`BASE_DARK_TOKENS`) | interactive (`BASE_CHAT_TOKENS`) |
|---|---|---|
| `--piview-font-size` | `11px` | `12px` |
| `--piview-leading` | `1.25` | `1.5` |
| `--piview-font-size-prose` | `12px` | `13px` |
| `--piview-leading-prose` | `1.375` | `1.55` |
| `--piview-block-gap` | `0.875rem` | `1rem` |
| `--piview-block-padding` | `0.5rem` | `0.75rem` |
| `--piview-radius-block` | `0.25rem` | `0.625rem` |

So "harmonize the colors, keep the density" is already a clean split; the work
is to make that split explicit and to fix the *colors*, not the spacing.

## 3. The mismatch, precisely

| Role | App | interactive-chat | batch-terminal |
|---|---|---|---|
| background | `slate-950` | `#0d1117` | `black` |
| surface | `slate-900` | `#161b22` | `slate-900` |
| text | `slate-100` | `#d7e1ec` | `green-400` |
| muted | `slate-400` | `#8b98a9` | `slate-400` |
| border | `slate-800` | `#2b3440` | `slate-800` |
| accent | `sky-400` | `#58a6ff` | `sky-400` |
| accent-2 | `cyan-400` | `#79c0ff` | `cyan-400` |

Batch already shares the app accents (sky/cyan) but uses a terminal green
foreground; interactive uses a GitHub blue accent family that matches nothing
else. Harmonization = converge everything onto one accent family and one neutral
family.

## 4. Goals and non-goals

**Goals**

1. One palette family drives all three surfaces; no surface invents its own hues.
2. Default set: interactive adopts the app palette; batch adopts the interactive
   palette (neutral text, accent-colored chrome, green demoted to *status* only).
3. Density stays a **surface-role** concern: batch compact, interactive generous
   (larger fonts, more padding/margins), independent of palette.
4. A second, alternative palette set, selectable from `DashboardView`.
5. Choosing a set applies all three surfaces atomically and persists.

**Non-goals**

- Changing PiView's DOM or the rendered Markdown (structure freeze stays).
- Changing the PiView token contract (`--piview-*` names are still additive-only).
- A full theme *editor*; the picker offers fixed sets.
- Backend changes.

## 5. Design overview

```
                      ┌──────────────── Theme Set ────────────────┐
                      │ id, label, mode, shared palette primitives │
                      └──────────────────┬────────────────────────┘
              derives                     │
     ┌───────────────┬────────────────────┼───────────────────────┐
     ▼               ▼                    ▼                       ▼
  App tokens    interactive theme     batch theme           (density is a
  (--app-*)     (--piview-*, roomy)   (--piview-*, compact)  role, not palette)
```

A **theme set** defines a small set of *palette primitives*; each surface maps
those primitives into its own token space. The set is the only place a hue is
chosen. Density is applied per surface role (batch/interactive) and reused
verbatim by every set.

**Single-mode sets and the effective mode.** A set declares `mode: 'both'` or a
single mode (`'dark'`/`'light'`). The requested app mode is always normalised
through the active set: if the set supports the request it is used unchanged,
otherwise it resolves to the set's only/first supported mode. `effectiveMode`
is the single source of truth for `data-theme`, the inline `--app-*` tokens,
persistence and `themeForVariant`, so app chrome and PiView logs can never end
up in different modes. The mode control in the picker disables (with a
title/`aria-disabled` explanation) any mode the active set does not support.

### 5.1 Shared palette primitives

Each set declares ~10 primitives (the hue family):

```
--palette-bg, --palette-surface, --palette-elevated,
--palette-text, --palette-muted, --palette-border,
--palette-accent, --palette-accent-2,
--palette-ok, --palette-error, --palette-warn, --palette-info
```

Mappings (one line each, no duplication of a hue):

- **App** → `--app-bg`, `--app-surface`, `--app-text`, `--app-muted`,
  `--app-border`, `--app-accent-1`, `--app-accent-2`.
- **PiView (both variants)** → `--piview-bg`, `--piview-surface`,
  `--piview-fg`, `--piview-fg-muted`, `--piview-border`, `--piview-accent`,
  `--piview-accent-2`, `--piview-fg-ok`, `--piview-fg-error`, and the
  status/notice/thinking roles derived from `ok`/`info`/`warn` where sensible.

The semantic `ok`/`error`/`warn`/`info` primitives are what let "green" survive
only as a *status* color in the harmonized batch theme rather than as the
default foreground.

### 5.1.1 Syntax and search derivation

The ten PiView syntax roles and the five search-highlight roles are **derived
from the palette primitives**, not from a fixed syntax family. The derivation
keeps each role recognisable and still makes it set-dependent by blending the
semantic base with the set's accent family:

| Role | Derivation (via the shared `blend()` helper) |
|---|---|
| `syntax-comment` / `syntax-meta` | muted + text |
| `syntax-keyword` / `syntax-deletion` | error + accent-2 + text |
| `syntax-string` / `syntax-addition` | ok + accent |
| `syntax-number` | accent + accent-2 |
| `syntax-built-in` | warn + accent-2 |
| `syntax-title` | accent |
| `syntax-tag` | ok + accent-2 |
| `search-hit` | accent at alpha |
| `search-current` | warn + accent at alpha |
| `search-hit-fg` / `search-current-fg` | palette text |
| `search-current-outline` | text + accent |

**Exceptions:** none. No syntax or search role is deliberately semantic-only.
The `ok`/`error`/`warn` palette primitives remain semantic *inputs*, but each
syntax role also mixes in the set's accent so every registered set changes the
whole code and search palette, not just its chrome. `batch-paper` is built with
the same derivation helper as the set themes; only its paper surfaces and
print typography are preset refinements.

### 5.2 Density roles

Two density presets, owned by the surface role and shared by all sets:

| Preset | Applies to | Values (inherited from today's bases) |
|---|---|---|
| `compact` | batch | font 11px, leading 1.25, prose 12px/1.375, gap 0.875rem, padding 0.5rem, radius 0.25rem |
| `roomy` | interactive | font 12px, leading 1.5, prose 13px/1.55, gap 1rem, padding 0.75rem, radius 10px |

A set therefore contains a palette plus *two* PiView themes that share the
palette and differ only in density (plus the interactive theme's chat
refinements: user bubble, formatted-answer card, fade-in — all already
implemented as `interactive-chat`'s token overrides + `css`).

## 6. The default set (harmonized)

Keep the app's existing slate + sky/cyan identity and converge the two PiView
themes onto it.

| Role | Default set value |
|---|---|
| accent / accent-2 | `sky-400` / `cyan-400` (dark), `sky-700` / `cyan-700` (light; AA on the light surface) |
| neutrals | slate (as today's `--app-*`) |
| ok / error / warn / info | green / red / amber / cyan (status only) |

Concrete changes:

1. **`interactive-chat` → adopt sky/cyan.** Replace `#58a6ff`→`sky-400` and
   `#79c0ff`→`cyan-400`; surfaces `#0d1117`→`slate-950`, `#161b22`→`slate-900`,
   text `#d7e1ec`→`slate-100`, border `#2b3440`→`slate-800`. The chat look
   (density, radii, bubble, answer card, fade-in) is unchanged.
2. **`batch-terminal` → adopt the interactive neutral palette.** Replace the
   `green-400` foreground with `slate-100` text; keep `green` only for
   `--piview-fg-ok`/`--piview-status-dot-active`/verification-ok. Accents are
   already sky/cyan, so they align with no change. This turns the "green
   terminal" into a "dark slate transcript" that matches the chat.
3. **Rename for clarity (optional but recommended).** `batch-terminal` →
   `batch-default`, `interactive-chat` → `interactive-default`, so the id no
   longer implies a look ("terminal"/"chat") that the harmonized palettes no
   longer differ on. Keep `batch-terminal`/`interactive-chat` as deprecated
   aliases so existing `PiViewOptions.theme` values keep working.

Light mode: the default set supports both `light` and `dark` app modes (today's
`data-theme`). The two PiView themes gain a light variant derived directly from
the set's light palette (with the same sky/cyan accents), so a light app is
matched by light logs. `BASE_LIGHT_TOKENS` remains an exported token base for
print-like presets such as `batch-paper`; it is not spread into the derived
default/Ember light themes. (See §10 open question 1 for the alternative: each
set is single-mode.)

## 7. The alternative set

A second palette family with the same structure and the same two density roles.
Illustrative example — "**Amber / Rose**" (warm) rather than sky/cyan:

| Primitive | dark | light |
|---|---|---|
| accent / accent-2 | `amber-400` / `rose-400` | `amber-700` / `rose-700` |
| neutrals | `stone-950/900/100/400/800` | `stone-50/white/900/500/200` |
| ok / error / warn / info | green / red / amber / rose (unchanged semantic) | |

This is delivered as a second `ThemeSet` entry; its PiView themes are `{ ...density
tokens, ...palette overrides }`. The exact hue family is a product decision (§10.2).

## 8. Architecture / plumbing

### 8.1 New module `frontend/src/ui/theme/themeSets.ts`

```ts
export type ThemeMode = 'dark' | 'light';
export interface PalettePrimitives {
  '--palette-bg': string; /* …10 primitives… */
}
export interface ThemeSet {
  id: string;
  label: string;
  description?: string;
  mode: ThemeMode | 'both';            // base mode(s) of the set
  palette: Record<ThemeMode, PalettePrimitives>;
  /** app tokens derived from the palette (per mode). */
  appTokens: Record<ThemeMode, PiViewTokens>;      // reuses --piview-* type or a generic token map
  /** The two PiView themes, sharing the palette, differing by density role. */
  interactiveTheme: PiViewTheme;
  batchTheme: PiViewTheme;
}
export const THEME_SETS: Record<string, ThemeSet>;
export const DEFAULT_THEME_SET: string;
export function validateThemeSet(set: ThemeSet): string[];
```

Reuse `PiViewTheme`/`defineTheme` from `piviewThemes.ts`; the set's two themes
are ordinary registry themes (so the existing structure-freeze, markup-freeze,
contrast and token-completeness suites keep working against them).

### 8.2 `ThemeManager` store (framework-agnostic singleton)

```ts
export class ThemeManager {
  getActiveSetId(): string;
  getActiveSet(): ThemeSet;
  getActiveMode(): ThemeMode;                     // always the effective mode
  getSupportedModes(): ThemeMode[];
  getEffectiveMode(): ThemeMode;
  setMode(mode: ThemeMode): void;                 // normalises to a supported mode
  setSet(id: string): void;                       // also normalises the mode
  themeForVariant(variant: PiViewVariant): PiViewTheme;  // set.batchTheme / set.interactiveTheme
  onSetChange(cb: (setId: string) => void): () => void;
}
export const themeManager: ThemeManager;          // module singleton
```

`effectiveMode(set, requested)` returns `requested` when the set supports it,
otherwise the set's only/first supported mode. `setSet`, `setMode`, the
persisted-state restore and `themeForVariant` all use this one helper; there is
no "fall back to the other mode" path. A persisted selection whose mode is
unsupported by its restored set is rewritten to the normalised `{ setId, mode }`.

`setSet`/`setMode`:

1. resolve the effective mode for the active set;
2. set `data-theme-set="<id>"` and `data-theme="<effective-mode>"` on `<html>`;
3. write the effective mode's `--app-*` tokens (and `--syntax-*` if a set
   overrides them) as inline custom properties on `<html>` (or a dedicated
   `<style>`), so the app chrome, footers and editors all follow;
4. persist `{ setId, mode: effectiveMode }` to `localStorage`
   (`ajapopaja:theme-set`);
5. notify subscribers.

### 8.3 PiView integration (minimal)

`PiView` already accepts a theme *object* via `resolveTheme(variant, theme)`
and exposes `setTheme`/`onThemeChange`. Change only the **default source**:

- When the host passes no explicit `theme`, the effective theme comes from
  `themeManager.themeForVariant(this.variant)` instead of
  `DEFAULT_THEME_FOR_VARIANT[variant]`.
- PiView subscribes to `themeManager.onSetChange` and re-applies its theme on
  change (idempotent, no DOM rebuild). Unsubscribe in `destroy()`.
- An explicit host `theme`/`variant` still wins (unchanged), preserving the
  "host is source of truth" rule and every existing test fixture.

This keeps PiView free of any theme-id special-casing and reuses the existing
single-element `applyTheme` path, so a set switch re-themes every mounted log in
place (scroll/collapse/search/format state all preserved).

`DEFAULT_THEME_FOR_VARIANT` in `piviewThemes.ts` becomes a fallback used only
when the manager is not yet initialised (e.g. tests importing the registry
directly); `batch-terminal`/`interactive-chat` remain as the hard fallback.

### 8.4 AppContext + DashboardView

- `AppContext` initialises `themeManager` from `localStorage` on startup,
  registers a `set_theme_set` action (`(setId) => themeManager.setSet(setId)`),
  and re-derives `AppState.theme` (light/dark) from the manager so the existing
  light/dark toggle keeps working as a *mode* switch.
- `DashboardView` replaces the `toggle_theme` icon button with a small
  **theme-set picker** (dropdown/popover listing `THEME_SETS`, showing label +
  a palette swatch, current set highlighted). Selecting a set calls
  `set_theme_set`. The existing `toggle_theme` shortcut can remain as a
  light/dark mode toggle, or be retired (§10.3).

## 9. Migration plan

**Phase A — primitives + manager (no visual change).**
1. Add `PalettePrimitives`, `ThemeSet`, `THEME_SETS` (one set), `ThemeManager`.
2. Express the *current* app palette and the *current* `interactive-chat`/
   `batch-terminal` tokens as the first set's primitives + mappings, with pixel
   parity. Verify side-by-side screenshots (app + both logs, light + dark).
3. Wire `AppContext` → `ThemeManager` and add the `set_theme_set` action; add
   `localStorage` persistence.

**Phase B — harmonize the default set.**
4. Change the default set's palette mappings so interactive and batch converge
   onto sky/cyan/slate (per §6). This is now a *data* change in the registry,
   not a code change.
5. Add light variants for the two PiView themes so light app mode is matched.

**Phase C — picker + alternative set.**
6. Add the second `ThemeSet` entry (per §7) reusing the same density roles.
7. Replace the `toggle_theme` button with the theme-set picker in `DashboardView`.

**Phase D — cleanup.**
8. Decide the fate of `batch-paper`/`interactive-focus` presets (§10.2); add the
   deprecated aliases from §6.3 if we rename the defaults.

**Files touched:** new `frontend/src/ui/theme/themeSets.ts`;
`frontend/src/ui/components/session/piviewThemes.ts` (light variants, aliases,
`DEFAULT_THEME_FOR_VARIANT` fallback semantics); `PiView.ts` (manager as default
source + subscription); `frontend/src/core/AppContext.ts`; `frontend/src/ui/views/DashboardView.ts`;
`frontend/src/style.css` (only if the app-token block moves to JS-driven tokens).

## 10. Testing

1. **Palette parity/snapshot tests** — each set's `appTokens` and the two PiView
   themes resolve to the expected primitives; a change to a primitive propagates
   to all three surfaces (assert the mapping, not hex literals scattered around).
2. **Contrast** — extend the existing PiView `validateTheme`/conformance suite to
   also check the app palette (`--app-text` on `--app-bg`, accent-1 on surface)
   at AA; every set is covered because sets iterate the registry.
3. **Density invariant** — for every set, `batchTheme` tokens satisfy the
   `compact` floor (≤ font 11px, ≤ padding 0.5rem, ≤ radius 0.25rem) and
   `interactiveTheme` satisfies `roomy` (≥ font 12px, ≥ padding 0.75rem), so a
   new set can't accidentally equalise or invert the densities.
4. **Structure/markup freeze** — unchanged suites keep passing for the new set
   themes (they are ordinary registry themes).
5. **Propagation** — switching sets re-themes a mounted PiView without rebuild
   and preserves scroll/follow/collapse/search/format state; the footer follows
   `--app-*` automatically.
6. **Picker + persistence** — selecting a set persists to `localStorage` and is
   restored on load; unknown/stale ids fall back to `DEFAULT_THEME_SET`.
7. **Light/dark** — mode switch re-maps all three surfaces consistently.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Palette drift creeps back (a surface re-hard-codes a hue) | Primitives are the only hue source; the parity/snapshot tests fail on a stray literal. |
| A new set accidentally changes density | Density-invariant test (§10.3) clamps each role. |
| Set switch causes PiView flicker/rebuild | Reuses `setTheme`/`applyTheme` (single element, no DOM rebuild); propagation test asserts state survival. |
| Footer chrome vs log split regresses | Footer stays on `--app-*` (already true); harmonization only unifies the *palette source*, not the token namespaces. |
| `DEFAULT_THEME_FOR_VARIANT` semantics change | Kept as a registry-level fallback; manager is layered above it, so direct-registry consumers (tests) are unaffected. |
| Renaming default themes breaks `PiViewOptions.theme` strings | Deprecated aliases keep old ids resolving to the harmonized themes. |

## 12. Open questions

1. **Light/dark within a set vs single-mode sets.** Recommendation: keep
   light/dark as a *mode* inside each set (matches the existing `data-theme`
   toggle and the light `--app-*` block). Alternative: each set is single-mode
   and light/dark disappears. Needs a product call.
2. **The alternative set's palette.** The "Amber/Rose" example in §7 is
   illustrative; the actual second hue family is a product/branding decision.
3. **Fate of `batch-paper` and `interactive-focus`.** Options: (a) retire them
   and fold their value into set modes, (b) keep them as extra code-selectable
   presets, (c) surface them in the picker as additional per-variant choices.
   Recommendation: keep them as code-selectable presets (no picker) to avoid
   scope creep.
4. **Does the picker replace `toggle_theme`, or is the toggle kept as a
   light/dark shortcut?** Recommendation: picker replaces the icon; light/dark
   becomes a secondary control within the set.
5. **Should the app token block move from `style.css` into JS-written tokens**
   (so `--app-*` come from the set like `--piview-*` do)? Recommendation: yes,
   write them from `ThemeManager` so there is one source; keep `style.css`'s
   `@theme` indirection (`--color-app-*`) for Tailwind utilities.

## 13. Acceptance criteria

- [ ] One palette primitive drives all three surfaces; no surface hard-codes a hue.
- [ ] Default set: interactive log uses sky/cyan/slate; batch log uses neutral
      slate text with green only as status.
- [ ] Batch stays compact, interactive stays generous (larger font, more space).
- [ ] A second, differently-paletted set is selectable from `DashboardView`.
- [ ] Selecting a set atomically re-themes app + interactive + batch, persists,
      and survives reload.
- [ ] All existing PiView conformance tests (structure/markup freeze, contrast,
      token completeness) pass against both sets.
- [ ] `tsc` + full frontend suite green.

## 14. Cleanup decisions (Phase D)

- **`batch-paper` / `interactive-focus`:** kept as code-selectable presets
  (no picker entry). They still pass `validateTheme` and the registry-driven
  conformance suite; comments in the registry record why they remain even
  though the harmonized light/interactive defaults now overlap conceptually.
- **Deprecated aliases:** `batch-terminal` and `interactive-chat` remain
  registered as aliases of `batch-default` / `interactive-default`, are
  documented as deprecated in the registry, and are covered by tests.
- **Static app-token fallback:** the `:root` and `[data-theme='light']`
  `--app-*` blocks in `style.css` stay as the pre-JS first-paint fallback.
  `ThemeManager` writes the active set's tokens inline on `<html>` after load,
  and the existing `@theme` mapping (`--color-app-*` → `var(--app-*)`) keeps
  Tailwind utilities following either source.
- **Light accents:** both sets use the Tailwind 700 step for light-mode accents
  (instead of the illustrative 600 step) so accent text clears WCAG AA against
  the light surface. Dark mode keeps the brighter 400 accents.
