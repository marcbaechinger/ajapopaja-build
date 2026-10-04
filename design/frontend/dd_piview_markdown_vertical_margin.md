# Design: Increase the vertical margin of rendered Markdown in PiView

## 1. Background

`PiView` renders the assistant response element (`RenderBlock.kind === 'text'`,
plus manually toggled blocks) as sanitized Markdown HTML inside a container
carrying `FORMATTED_MARKDOWN_CLASS` (`frontend/src/ui/components/PiView.ts:32`):

```
piview-formatted prose-theme font-sans
prose-p:my-1 prose-headings:my-1 prose-ul:my-1 prose-ol:my-1
prose-li:my-0 prose-pre:my-1 prose-blockquote:my-1 prose-table:my-1
```

The block-level vertical rhythm is actually owned by `frontend/src/style.css`
under `.piview-formatted` (`style.css:376–437`). Those rules are *unlayered*,
so they win over Tailwind's layered `prose-*:my-*` utilities (this is documented
in the existing CSS comment). The **effective** current spacing is therefore:

| Element | top | bottom |
|---|---|---|
| `p, ul, ol, dl, blockquote, figure, table` | `0.2em` | `0.2em` |
| `h1–h6` | `0.4em` | `0.15em` |
| `li` | `0` | `0` |
| `pre` | `0.25em` (`!important`) | `0.25em` (`!important`) |
| `hr` | `0.5em` | `0.5em` |

At the container's `12px` font size `0.2em` is only ~2.4px, which is why
consecutive paragraphs, list items, and the `p ↔ ul` boundary read as cramped.
This is a small, purely visual change: **increase these vertical margins
slightly** so the rendered answer is easier to read, without making it look like
a long-form document inside the dense, terminal-style log.

The existing outer inter-block spacing (`space-y-3.5` on `#log-blocks`) and the
`> :first-child`/`> :last-child` zeroing must be preserved so the rendered block
stays flush inside its wrapper and no double gap appears between log blocks.

## 2. Proposed Changes

### 2.1 Single source of truth for the rhythm

Today the rhythm exists in two places that already disagree (`0.2em` CSS vs the
`my-1` = `0.25rem` utilities that are silently overridden). Rather than update
two places and risk future drift, make `style.css` the **only** owner of the
Markdown vertical rhythm and remove the dead `prose-*:my-*` modifiers from the
class string.

**`frontend/src/ui/components/PiView.ts`**

```ts
const FORMATTED_MARKDOWN_CLASS = 'piview-formatted prose-theme font-sans';
```

Update the doc-comment above the constant to state that the vertical rhythm is
owned by `.piview-formatted` in `style.css` (so the next editor does not
re-introduce `prose-*:my-*`).

Rationale: the cascade guarantees the unlayered `style.css` rules beat the
layered utilities, so the utilities are inert. Removing them eliminates a second
source of truth that would otherwise silently disagree with the new values.

### 2.2 Tunable gap values via CSS custom properties

Introduce a small set of variables on `.piview-formatted` so the whole rhythm is
tunable from one block and the rules below read declaratively. The properties are
inherited by the descendant selectors.

**`frontend/src/style.css`**

```css
.piview-formatted {
  /* One knob per rhythm role; em-based so spacing scales with the 12px size. */
  --piview-gap-block: 0.4em;          /* p, ul, ol, dl, blockquote, figure, table */
  --piview-gap-li: 0.2em;             /* between list items */
  --piview-gap-heading-top: 0.6em;
  --piview-gap-heading-bottom: 0.2em;
  --piview-gap-pre: 0.4em;
  --piview-gap-hr: 0.65em;
  @apply prose-theme text-[12px] leading-snug;
}

.piview-formatted :where(p, ul, ol, dl, blockquote, figure, table) {
  margin-top: var(--piview-gap-block);
  margin-bottom: var(--piview-gap-block);
}

.piview-formatted :where(h1, h2, h3, h4, h5, h6) {
  margin-top: var(--piview-gap-heading-top);
  margin-bottom: var(--piview-gap-heading-bottom);
}

.piview-formatted :where(li) {
  margin-top: var(--piview-gap-li);
  margin-bottom: var(--piview-gap-li);
}
/* Keep list ends flush with the list box, mirroring the container-level reset. */
.piview-formatted :where(li:first-child) { margin-top: 0; }
.piview-formatted :where(li:last-child)  { margin-bottom: 0; }

.piview-formatted :where(hr) {
  margin-top: var(--piview-gap-hr);
  margin-bottom: var(--piview-gap-hr);
}

.piview-formatted pre {
  margin-top: var(--piview-gap-pre) !important;
  margin-bottom: var(--piview-gap-pre) !important;
  padding-top: 0.4rem !important;
  padding-bottom: 0.4rem !important;
}
```

The existing `.piview-formatted > :first-child { margin-top: 0; }` and
`> :last-child { margin-bottom: 0; }` rules stay unchanged.

Proposed increase (all values are the *new* effective values; ~px at 12px):

| Element | before | after |
|---|---|---|
| `p, ul, ol, dl, blockquote, figure, table` | `0.2em` (~2.4px) | `0.4em` (~4.8px) |
| `li` | `0` | `0.2em` (~2.4px) |
| `h1–h6` top / bottom | `0.4em` / `0.15em` | `0.6em` / `0.2em` |
| `pre` | `0.25em` | `0.4em` |
| `hr` | `0.5em` | `0.65em` |

The exact numbers are intentionally a single-line tuning knob; if a review pass
finds `0.4em` too airy, only the variables change.

### 2.3 Technical notes / gotchas

- **Margin collapsing.** Adjacent block siblings collapse to the larger margin,
  so a `p` followed by a `ul` yields `max(--piview-gap-block, --piview-gap-block)`
  = `0.4em`, not the sum. This makes the increase predictable and is why the same
  variable is used for both.
- **Don't touch the outer spacing.** `space-y-3.5` on `#log-blocks` and the
  `> :first-child/:last-child` resets are deliberately excluded; increasing them
  would also affect non-Markdown block kinds and break the existing spacing test
  (`PiView.test.ts:136`).
- **Scope of impact.** `.piview-formatted` is used only by `PiView` for
  auto-formatted `text` blocks and for manually formatted `tool`/`verification`
  blocks; all of them benefit equally. Other `prose-theme` consumers
  (`SpecSection`, `ReviewDialog`, `AssistantPanel`, editors) are untouched.
- **`pre` needs `!important`.** It must keep winning over the shared
  `.prose-theme pre` rule (`style.css:122`) that pins margins/padding for the
  document editors; this is preserved.
- **`.piview-formatted` inherits custom properties** to descendants, so the
  `:where(...)` selectors can read the variables without re-declaring them.

## 3. Implementation Plan

1. `frontend/src/style.css`: add the `--piview-gap-*` custom properties to
   `.piview-formatted`, point the existing block/heading/`li`/`hr`/`pre` rules at
   them, bump their values per §2.2, add the `li:first-child`/`li:last-child`
   resets, and update the surrounding comment to describe the new rhythm.
2. `frontend/src/ui/components/PiView.ts`: shorten `FORMATTED_MARKDOWN_CLASS` to
   `'piview-formatted prose-theme font-sans'` and update its doc-comment.
3. `frontend/src/ui/components/PiView.test.ts`: add the regression guard test
   (§4) and keep existing formatting tests green; `frontend/vite.config.ts`
   processes `style.css` so the `?raw` import is populated.
4. Add this design doc to `design/frontend/`.
5. Run `npm run build` (tsc + vite) and `npm test` from `frontend/`; visually
   confirm in `npm run dev` that paragraphs, list items and the `p ↔ ul` boundary
   gained a slightly larger, even gap and that the block remains flush with its
   neighbours.

## 4. Test Strategy

`style.css` is not imported by the jsdom test environment and jsdom has no layout
engine, so computed `em` margins cannot be asserted behaviourally. Cover the
change with a deterministic **source guard** plus the existing behavioural tests.
The CSS source is imported with Vite's `?raw` suffix
(`import styleCss from '../../style.css?raw'`), which needs no Node typings and
works in both the `vitest` transform and `tsc` (`vite/client` declares the
`*?raw` module). Because Vitest stubs CSS imports to an empty module by default,
`vite.config.ts` enables processing for that one file only
(`test.css.include: [/style\.css/]`), leaving every other stylesheet stubbed as
before.

- **New unit test (`PiView.test.ts`)** — assert:
  - `.piview-formatted` declares `--piview-gap-block: 0.4em` and
    `--piview-gap-li: 0.2em` (i.e. the larger values are present, guarding
    against an accidental re-tightening), plus the heading/`pre` knobs;
  - the block/list/heading rules reference the `var(--piview-gap-*)` properties.
- **Class-string test** — assert the formatted container still carries
  `piview-formatted` and `prose-theme`, and that the spacing utilities
  `prose-p:my-*`/`prose-li:my-*` are no longer present, pinning the
  single-source-of-truth decision.
- **Existing suite** — all `PiView.test.ts` formatting/auto-format/copy tests
  must still pass (they assert structure and content, not spacing, so removing
  the inert utilities is safe).
- **Manual/visual** — render a block containing paragraphs, a list and code in
  both themes; confirm the gaps are only slightly larger and that no double gap
  appears between adjacent log blocks.

Run the full frontend suite plus `tsc` (`npm run build`, `npm test`).

## 5. Alternatives Considered

- **Keep and sync the `prose-*:my-*` utilities** to matching values instead of
  removing them. Lower risk if the layer ordering were ever to change, but it
  keeps two sources of truth that must be edited in lockstep (and mixes `rem`
  utilities with the `em` CSS values). Rejected in favour of one owner.
- **Change the global Tailwind Typography defaults** (plugin config or a shared
  `prose` override). Would bloat design docs, reviews and editor previews too.
  Rejected — the request is scoped to the PiView response element.
- **Increase `space-y-3.5` on `#log-blocks`.** That is *inter-block* spacing
  between log sections, not the vertical margins *within* a rendered Markdown
  block; it also affects every block kind and the spacing test. Rejected.
- **Increase font size / line-height** instead of margins. Out of scope (the
  task targets vertical margins) and would fight the `leading-snug` density
  choice.
