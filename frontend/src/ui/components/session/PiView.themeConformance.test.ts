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
 * PiView theme conformance suite.
 *
 * Every check in this file is registry-driven: it iterates
 * `Object.values(PI_VIEW_THEMES)` (and both variants where relevant) instead of
 * naming builtin themes. Registering another theme therefore adds coverage
 * without editing this file. The suite covers the hard structural/markup freeze,
 * WCAG contrast, reduced motion, switch safety and stylesheet isolation.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PiView, type PiSessionService } from './PiView.ts';
import {
  BASE_DARK_TOKENS,
  PI_VIEW_THEMES,
  defineTheme,
  validateTheme,
  type PiViewTheme,
  type PiViewVariant,
} from './piviewThemes.ts';
import type { RenderBlock } from '../../../core/CoderBotService.ts';
import { THEME_SETS } from '../../theme/themeSets.ts';
import piViewCss from './PiView.css?raw';
import keybindingCss from './Keybinding.css?raw';
import tailwindThemeCss from 'tailwindcss/theme.css?raw';

const VARIANTS: readonly PiViewVariant[] = ['batch', 'interactive'];

const FIXTURE: RenderBlock[] = [
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
  { id: 'notice', kind: 'notice', text: '● started' },
  { id: 'error', kind: 'error', text: 'boom alpha' },
  { id: 'divider', kind: 'divider', text: '— turn —' },
  { id: 'verification-ok', kind: 'verification', text: '● PASS', sub: ['- cmd  1'] },
  {
    id: 'verification-error',
    kind: 'verification',
    text: '● FAIL',
    sub: ['- cmd  1'],
    error: true,
  },
];

// PiView coalesces block reconciliation onto an animation frame.
let rafCallbacks: Map<number, FrameRequestCallback>;
let rafNextId: number;

function flushRaf(): void {
  const pending = Array.from(rafCallbacks.values());
  rafCallbacks.clear();
  for (const cb of pending) cb(0);
}

function createStubService(): {
  service: PiSessionService;
  emitBlocks: (blocks: RenderBlock[]) => void;
} {
  const listeners = new Set<(blocks: RenderBlock[]) => void>();
  const service: PiSessionService = {
    getHistory: () => [],
    getCurrentTaskId: () => null,
    isActive: () => false,
    getSessionStartTime: () => null,
    onSessionStartTimeChange: () => () => {},
    clearHistory: () => {},
    stopSession: async () => {},
    onBlocks: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onMessage: () => () => {},
    onSessionStateChange: () => () => {},
  };

  return {
    service,
    emitBlocks: (blocks) => {
      listeners.forEach((listener) => listener(blocks));
      flushRaf();
    },
  };
}

interface RenderedView {
  view: PiView;
  host: HTMLElement;
  log: HTMLElement;
  blocks: HTMLElement;
}

function renderFixture(variant: PiViewVariant, theme?: string | PiViewTheme): RenderedView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const { service, emitBlocks } = createStubService();
  const view = new PiView(service, host, { variant, theme });
  view.render();
  emitBlocks(FIXTURE);
  view.flushAutoFormat();

  const log = host.querySelector('#log-content-container') as HTMLElement;
  const blocks = host.querySelector('#log-blocks') as HTMLElement;
  expect(log).not.toBeNull();
  expect(blocks).not.toBeNull();
  return { view, host, log, blocks };
}

function destroyView(rendered: RenderedView): void {
  rendered.view.destroy();
  rendered.host.remove();
}

// ---------------------------------------------------------------------------
// Structure freeze
// ---------------------------------------------------------------------------

interface NormalizedNode {
  tag: string;
  id: string | null;
  data: Array<[string, string]>;
  aria: Array<[string, string]>;
  classes: string[];
  children: NormalizedNode[];
}

/**
 * The only attribute allowed to differ between themes is the theme selector on
 * the PiView log element. Inline styles are deliberately not part of the
 * structural description: themes are *allowed* to write custom properties.
 * Everything else (tags, nesting, ids, data/aria hooks, class sets) is frozen.
 */
const THEME_SELECTOR_ATTRIBUTE_ALLOW_LIST = new Set(['data-piview-theme']);

function normalizeNode(el: Element): NormalizedNode {
  const data: Array<[string, string]> = [];
  const aria: Array<[string, string]> = [];

  for (const attr of Array.from(el.attributes)) {
    if (THEME_SELECTOR_ATTRIBUTE_ALLOW_LIST.has(attr.name)) continue;
    if (attr.name.startsWith('data-')) data.push([attr.name, attr.value]);
    else if (attr.name.startsWith('aria-')) aria.push([attr.name, attr.value]);
  }

  const byName = (a: [string, string], b: [string, string]) => a[0].localeCompare(b[0]);
  data.sort(byName);
  aria.sort(byName);

  return {
    tag: el.tagName,
    id: el.id || null,
    data,
    aria,
    classes: Array.from(el.classList).sort(),
    children: Array.from(el.children, normalizeNode),
  };
}

// ---------------------------------------------------------------------------
// Contrast helpers
// ---------------------------------------------------------------------------

type Rgba = { r: number; g: number; b: number; a: number };

interface ContrastPair {
  name: string;
  fg: string;
  bg: string;
  /** Optional opaque layer under an alpha background token (typically the log bg). */
  base?: string;
}

/**
 * The documented WCAG AA pairs. These are role names from the token contract,
 * not theme-specific token values; every registered theme is checked against
 * every pair automatically.
 */
const CONTRAST_PAIRS: ContrastPair[] = [
  { name: 'log body', fg: '--piview-fg', bg: '--piview-bg' },
  {
    name: 'tool body',
    fg: '--piview-fg-tool',
    bg: '--piview-surface-tool',
    base: '--piview-bg',
  },
  {
    name: 'verification error',
    fg: '--piview-fg-error',
    bg: '--piview-surface-verification-error',
    base: '--piview-bg',
  },
  {
    name: 'status text',
    fg: '--piview-fg-status',
    bg: '--piview-surface-sticky',
    base: '--piview-bg',
  },
  {
    name: 'response body',
    fg: '--piview-fg',
    bg: '--piview-surface-formatted-active',
    base: '--piview-bg',
  },
  {
    name: 'response heading',
    fg: '--piview-fg-heading',
    bg: '--piview-surface-formatted-active',
    base: '--piview-bg',
  },
  { name: 'session ended', fg: '--piview-fg-ok', bg: '--piview-bg' },
  {
    name: 'verification ok',
    fg: '--piview-fg-ok',
    bg: '--piview-surface-verification-ok',
    base: '--piview-bg',
  },
  { name: 'thinking body', fg: '--piview-fg-thinking', bg: '--piview-bg' },
  { name: 'notice', fg: '--piview-fg-notice', bg: '--piview-bg' },
  {
    name: 'user label',
    fg: '--piview-fg-user-label',
    bg: '--piview-surface-user',
    base: '--piview-bg',
  },
  { name: 'accent button', fg: '--piview-accent-fg', bg: '--piview-accent' },
];

const AA_CONTRAST_RATIO = 4.5;

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseTailwindPalette(css: string): Map<string, string> {
  const palette = new Map<string, string>();
  for (const match of css.matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    palette.set(match[1], match[2].trim());
  }
  return palette;
}

function parseTokenDefaults(css: string): Map<string, string> {
  const block = css.match(/\.piview-log\s*\{([\s\S]*?)\}/);
  const defaults = new Map<string, string>();
  if (!block) return defaults;
  for (const match of block[1].matchAll(/(--piview-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    defaults.set(match[1], match[2].trim().replace(/\s+/g, ' '));
  }
  return defaults;
}

const TAILWIND_PALETTE = parseTailwindPalette(tailwindThemeCss);
const PI_VIEW_CSS_SOURCE = stripCssComments(piViewCss);
const PI_VIEW_DEFAULT_TOKENS = parseTokenDefaults(PI_VIEW_CSS_SOURCE);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return sign * (abs <= 0.0031308 ? abs * 12.92 : 1.055 * abs ** (1 / 2.4) - 0.055);
}

function srgbToOklab(color: Rgba): [number, number, number] {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return [
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  ];
}

function oklabToSrgb([L, a, b]: [number, number, number], alpha: number): Rgba {
  const lRoot = L + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = L - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = L - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;

  return {
    r: clamp01(linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    a: alpha,
  };
}

function parseAlpha(value: string | undefined): number {
  if (!value) return 1;
  const trimmed = value.trim();
  return clamp01(trimmed.endsWith('%') ? parseFloat(trimmed) / 100 : parseFloat(trimmed));
}

function parseHex(value: string): Rgba {
  let hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    hex = Array.from(hex, (char) => char + char).join('');
  }
  if (hex.length !== 6 && hex.length !== 8) {
    throw new Error(`Unsupported hex color: ${value}`);
  }
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}

function parseRgb(value: string): Rgba {
  const body = value.match(/^rgba?\((.*)\)$/i)?.[1];
  if (!body) throw new Error(`Unsupported rgb color: ${value}`);
  const slashParts = body.split('/');
  const channels = slashParts[0].trim().split(/[\s,]+/);
  const alpha = slashParts[1] !== undefined ? parseAlpha(slashParts[1]) : channels[3] ? parseAlpha(channels[3]) : 1;
  const channel = (part: string) =>
    part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part) / 255;
  return {
    r: clamp01(channel(channels[0])),
    g: clamp01(channel(channels[1])),
    b: clamp01(channel(channels[2])),
    a: alpha,
  };
}

function parseOklch(value: string): Rgba {
  const body = value.match(/^oklch\((.*)\)$/i)?.[1];
  if (!body) throw new Error(`Unsupported oklch color: ${value}`);
  const [coords, alphaPart] = body.split('/');
  const parts = coords.trim().split(/\s+/);
  const lightness = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
  const chroma = parts[1].endsWith('%') ? parseFloat(parts[1]) / 100 : parseFloat(parts[1]);
  const hue = parseFloat(parts[2]) * (Math.PI / 180);
  return oklabToSrgb(
    [lightness, chroma * Math.cos(hue), chroma * Math.sin(hue)],
    parseAlpha(alphaPart)
  );
}

function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function mixOklab(first: Rgba, firstWeight: number, second: Rgba, secondWeight: number): Rgba {
  const alpha = first.a * firstWeight + second.a * secondWeight;
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };

  const aLab = srgbToOklab(first);
  const bLab = srgbToOklab(second);
  const mixed: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    mixed[i] = (aLab[i] * first.a * firstWeight + bLab[i] * second.a * secondWeight) / alpha;
  }
  return oklabToSrgb(mixed, alpha);
}

function parseMixComponent(
  value: string,
  theme: PiViewTheme,
  seen: Set<string>
): { color: Rgba; percentage: number | null } {
  const match = value.trim().match(/^(.*?)(?:\s+([\d.]+)%)$/);
  const colorText = match ? match[1].trim() : value.trim();
  return {
    color: parseColor(colorText, theme, seen),
    percentage: match ? parseFloat(match[2]) / 100 : null,
  };
}

function parseColorMix(value: string, theme: PiViewTheme, seen: Set<string>): Rgba {
  const body = value.match(/^color-mix\((.*)\)$/i)?.[1];
  if (!body) throw new Error(`Unsupported color-mix: ${value}`);

  const parts = splitTopLevelCommas(body).map((part) => part.trim());
  if (parts[0]?.toLowerCase().startsWith('in ')) parts.shift();
  if (parts.length !== 2) {
    throw new Error(`Expected two color-mix components: ${value}`);
  }

  const first = parseMixComponent(parts[0], theme, seen);
  const second = parseMixComponent(parts[1], theme, seen);
  let firstWeight = first.percentage ?? (second.percentage !== null ? 1 - second.percentage : 0.5);
  let secondWeight = second.percentage ?? (first.percentage !== null ? 1 - first.percentage : 0.5);
  const total = firstWeight + secondWeight;
  if (total <= 0) throw new Error(`color-mix weights must be positive: ${value}`);
  firstWeight /= total;
  secondWeight /= total;

  return mixOklab(first.color, firstWeight, second.color, secondWeight);
}

function parseColor(value: string, theme: PiViewTheme, seen: Set<string>): Rgba {
  const trimmed = value.trim();
  if (trimmed === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (trimmed === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (trimmed === 'white') return { r: 1, g: 1, b: 1, a: 1 };
  if (trimmed.startsWith('#')) return parseHex(trimmed);
  if (/^rgba?\(/i.test(trimmed)) return parseRgb(trimmed);
  if (/^oklch\(/i.test(trimmed)) return parseOklch(trimmed);
  if (/^color-mix\(/i.test(trimmed)) return parseColorMix(trimmed, theme, seen);

  const variable = trimmed.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  if (variable) {
    const name = variable[1];
    if (name.startsWith('--piview-')) return resolveToken(name, theme, seen);
    const paletteValue = TAILWIND_PALETTE.get(name);
    if (paletteValue) return parseColor(paletteValue, theme, seen);
  }

  throw new Error(`Cannot resolve color value: ${value}`);
}

function tokenValue(theme: PiViewTheme, name: string): string | undefined {
  return (theme.tokens as Record<string, string>)[name];
}

function resolveToken(name: string, theme: PiViewTheme, seen: Set<string> = new Set()): Rgba {
  if (seen.has(name)) throw new Error(`Cyclic token reference: ${name}`);
  const value = tokenValue(theme, name) ?? PI_VIEW_DEFAULT_TOKENS.get(name);
  if (!value) throw new Error(`No value for token ${name}`);
  const nextSeen = new Set(seen);
  nextSeen.add(name);
  return parseColor(value, theme, nextSeen);
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  };
}

function relativeLuminance(color: Rgba): number {
  return (
    0.2126 * srgbToLinear(color.r) +
    0.7152 * srgbToLinear(color.g) +
    0.0722 * srgbToLinear(color.b)
  );
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function pairContrast(theme: PiViewTheme, pair: ContrastPair): number {
  let background = resolveToken(pair.bg, theme);
  if (pair.base) background = composite(background, resolveToken(pair.base, theme));
  if (background.a < 1) background = composite(background, resolveToken('--piview-bg', theme));
  const foreground = composite(resolveToken(pair.fg, theme), background);
  return contrastRatio(foreground, background);
}

function missingTokenKeys(theme: PiViewTheme, requiredKeys: readonly string[]): string[] {
  return requiredKeys.filter((key) => (tokenValue(theme, key) ?? '').trim() === '');
}

/**
 * Theme-set app palette contrast. App tokens are CSS-variable references into
 * the same Tailwind palette the PiView themes use, so the color resolver above
 * can check them without a browser. Like the PiView checks, this iterates the
 * registry: every set and both modes get covered automatically.
 */
const APP_CONTRAST_PAIRS = [
  { name: 'app body', fg: '--app-text', bg: '--app-bg' },
  { name: 'app accent', fg: '--app-accent-1', bg: '--app-surface' },
] as const;

function resolveAppToken(
  set: (typeof THEME_SETS)[string],
  mode: 'dark' | 'light',
  name: string
): Rgba {
  const value = set.appTokens[mode]?.[name];
  if (!value) throw new Error(`${set.id}/${mode} has no ${name}`);
  return parseColor(value, Object.values(PI_VIEW_THEMES)[0], new Set());
}

function appPairContrast(
  set: (typeof THEME_SETS)[string],
  mode: 'dark' | 'light',
  pair: (typeof APP_CONTRAST_PAIRS)[number]
): number {
  const background = resolveAppToken(set, mode, pair.bg);
  const foreground = resolveAppToken(set, mode, pair.fg);
  return contrastRatio(foreground, background);
}

// ---------------------------------------------------------------------------
// Additional theme registered inside the suite
// ---------------------------------------------------------------------------

/**
 * A locally defined theme proves the suite is data-driven: once registered it
 * participates in every structural, markup, contrast, token, motion, switch and
 * stylesheet check below without a single test edit. Its tokens are cloned from
 * a registered theme so no palette is duplicated here.
 */
const EXTRA_THEME_ID = 'conformance-extra';
let extraTheme: PiViewTheme;

beforeAll(() => {
  const sourceTheme = Object.values(PI_VIEW_THEMES)[0];
  extraTheme = defineTheme({
    id: EXTRA_THEME_ID,
    label: 'Conformance extra',
    description: 'Locally registered theme used to prove the suite is data-driven.',
    variants: [...VARIANTS],
    tokens: { ...sourceTheme.tokens },
  });
  PI_VIEW_THEMES[extraTheme.id] = extraTheme;
});

afterAll(() => {
  delete PI_VIEW_THEMES[EXTRA_THEME_ID];
});

beforeEach(() => {
  rafCallbacks = new Map();
  rafNextId = 0;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    const id = ++rafNextId;
    rafCallbacks.set(id, cb);
    return id;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id: number) => {
    rafCallbacks.delete(id);
  });
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.querySelectorAll('style[data-piview-theme]').forEach((el) => el.remove());
});

describe('PiView theme conformance: structure freeze', () => {
  for (const variant of VARIANTS) {
    it(`renders an identical normalized DOM for every theme (${variant})`, () => {
      const themes = Object.values(PI_VIEW_THEMES);
      expect(themes.length).toBeGreaterThan(0);

      let baseline: NormalizedNode | undefined;
      for (const theme of themes) {
        const rendered = renderFixture(variant, theme.id);
        const normalized = normalizeNode(rendered.host);
        if (baseline === undefined) {
          baseline = normalized;
        } else {
          expect(normalized, `${theme.id} changed the DOM structure for ${variant}`).toEqual(
            baseline
          );
        }
        destroyView(rendered);
      }
    });
  }

  it('includes the locally registered extra theme in the structure sweep', () => {
    expect(Object.values(PI_VIEW_THEMES)).toContain(extraTheme);
    expect(extraTheme.id).toBe(EXTRA_THEME_ID);
  });
});

describe('PiView theme conformance: markup freeze', () => {
  for (const variant of VARIANTS) {
    it(`keeps auto-formatted and manually formatted response markup identical (${variant})`, () => {
      const themes = Object.values(PI_VIEW_THEMES);
      let baselineAuto: string | undefined;
      let baselineManual: Record<string, string> | undefined;

      for (const theme of themes) {
        const rendered = renderFixture(variant, theme.id);

        // Auto-formatted completed response element.
        const auto = rendered.log.querySelector(
          '[data-kind="text"] [data-role="formatted"]'
        ) as HTMLElement | null;
        expect(auto, `${theme.id} did not auto-format the response`).not.toBeNull();

        // Manually toggle two non-auto blocks into Markdown view.
        const manual: Record<string, string> = {};
        for (const kind of ['thinking', 'tool']) {
          const block = rendered.log.querySelector(
            `[data-kind="${kind}"][data-block-id]`
          ) as HTMLElement;
          (block.querySelector('.piview-format') as HTMLButtonElement).click();
          const formatted = block.querySelector('[data-role="formatted"]') as HTMLElement | null;
          expect(formatted, `${theme.id} did not manually format ${kind}`).not.toBeNull();
          manual[kind] = formatted?.innerHTML ?? '';
        }

        const autoHtml = auto?.innerHTML ?? '';
        if (baselineAuto === undefined) {
          baselineAuto = autoHtml;
          baselineManual = manual;
        } else {
          expect(autoHtml, `${theme.id} changed the auto-formatted markup`).toBe(baselineAuto);
          expect(manual, `${theme.id} changed the manually formatted markup`).toEqual(
            baselineManual
          );
        }

        destroyView(rendered);
      }
    });
  }
});

describe('PiView theme conformance: tokens and contrast', () => {
  it('validates every registered theme and resolves every stylesheet token', () => {
    const referenced = new Set(
      Array.from(PI_VIEW_CSS_SOURCE.matchAll(/var\(\s*(--piview-[a-z0-9-]+)/g), (m) => m[1])
    );
    expect(referenced.size).toBeGreaterThan(0);

    for (const theme of Object.values(PI_VIEW_THEMES)) {
      expect(validateTheme(theme), `${theme.id} is not a valid theme`).toEqual([]);

      for (const name of referenced) {
        expect(
          tokenValue(theme, name) ?? PI_VIEW_DEFAULT_TOKENS.get(name),
          `${theme.id} cannot resolve ${name}`
        ).toBeTruthy();
      }

      // Colour roles used by the contrast contract must also resolve to an
      // actual colour, not merely be present as a string.
      const contrastTokens = new Set(
        CONTRAST_PAIRS.flatMap((pair) => [pair.fg, pair.bg, ...(pair.base ? [pair.base] : [])])
      );
      for (const name of contrastTokens) {
        expect(() => resolveToken(name, theme), `${theme.id}: ${name}`).not.toThrow();
      }
    }
  });

  it('meets WCAG AA for every documented pair in every theme and variant', () => {
    for (const variant of VARIANTS) {
      for (const theme of Object.values(PI_VIEW_THEMES)) {
        for (const pair of CONTRAST_PAIRS) {
          const ratio = pairContrast(theme, pair);
          expect(
            ratio,
            `${theme.id}/${variant} ${pair.name} contrast ${ratio.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(AA_CONTRAST_RATIO);
        }
      }
    }
  });

  it('meets WCAG AA for the app palette in every set and mode', () => {
    for (const set of Object.values(THEME_SETS)) {
      for (const mode of ['dark', 'light'] as const) {
        if (!set.appTokens[mode]) continue;
        for (const pair of APP_CONTRAST_PAIRS) {
          const ratio = appPairContrast(set, mode, pair);
          expect(
            ratio,
            `${set.id}/${mode} ${pair.name} contrast ${ratio.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(AA_CONTRAST_RATIO);
        }
      }
    }
  });

  it('fails a deliberately wrong theme that drops a token and one with low contrast', () => {
    const sourceTheme = Object.values(PI_VIEW_THEMES)[0];
    const contractKeys = Object.keys(BASE_DARK_TOKENS);
    const [firstPair] = CONTRAST_PAIRS;

    const droppedTokens = { ...sourceTheme.tokens };
    delete (droppedTokens as Record<string, string>)[firstPair.fg];
    const droppedTheme: PiViewTheme = {
      ...sourceTheme,
      id: 'conformance-dropped-token',
      tokens: droppedTokens,
    };
    expect(missingTokenKeys(droppedTheme, contractKeys)).toContain(firstPair.fg);

    const emptyTokenTheme: PiViewTheme = {
      ...sourceTheme,
      id: 'conformance-empty-token',
      tokens: { ...sourceTheme.tokens, [firstPair.fg]: '' },
    };
    expect(validateTheme(emptyTokenTheme).join(' ')).toContain(firstPair.fg);

    const lowContrastTheme: PiViewTheme = {
      ...sourceTheme,
      id: 'conformance-low-contrast',
      tokens: {
        ...sourceTheme.tokens,
        [firstPair.fg]: tokenValue(sourceTheme, firstPair.bg) ?? '',
      },
    };
    expect(pairContrast(lowContrastTheme, firstPair)).toBeLessThan(AA_CONTRAST_RATIO);
  });
});

describe('PiView theme conformance: reduced motion', () => {
  const reducedMotionBlock = (css: string): string => {
    const match = stripCssComments(css).match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}\s*$/m
    );
    return match?.[1] ?? '';
  };

  it('disables the status-dot pulse and every log animation under reduced motion', () => {
    const reduced = reducedMotionBlock(piViewCss);
    expect(reduced).toContain('--piview-motion-pulse: none');
    expect(reduced).toMatch(/\.piview-log\s*\*/);
    expect(reduced).toMatch(/animation:\s*none/);
    expect(reduced).toContain('#piview-status-dot');
  });

  it('disables the shortcut flash animation under reduced motion', () => {
    const reduced = reducedMotionBlock(keybindingCss);
    expect(reduced).toContain('.shortcut-active');
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it('disables animations declared by every registered theme', () => {
    // The base PiView stylesheet applies `animation: none` to every element in
    // the log under reduced motion. This check makes that guarantee explicit for
    // theme-authored CSS: a theme that adds animation must be covered by the
    // base rule or ship its own reduced-motion override.
    const baseReduced = reducedMotionBlock(piViewCss);
    const baseCoversAllLogAnimations =
      /\.piview-log\s*\*/.test(baseReduced) && /animation:\s*none/.test(baseReduced);

    for (const theme of Object.values(PI_VIEW_THEMES)) {
      const css = stripCssComments(theme.css ?? '');
      if (!/\banimation\s*:/.test(css)) continue;
      const ownReduced = reducedMotionBlock(css);
      expect(
        baseCoversAllLogAnimations || /animation:\s*none/.test(ownReduced),
        `${theme.id} declares animation without a reduced-motion escape`
      ).toBe(true);
    }
  });
});

describe('PiView theme conformance: switch safety', () => {
  for (const variant of VARIANTS) {
    it(`preserves view state, is idempotent, and switches through every theme (${variant})`, () => {
      const themes = Object.values(PI_VIEW_THEMES);
      const rendered = renderFixture(variant, themes[0].id);
      const { view, log, blocks } = rendered;

      // Collapse thinking + tool/verification blocks, leave follow mode.
      (rendered.host.querySelector('#thinking-toggle-btn') as HTMLButtonElement).click();
      (rendered.host.querySelector('#collapse-blocks-btn') as HTMLButtonElement).click();
      (rendered.host.querySelector('#follow-btn') as HTMLButtonElement).click();
      expect(view.isFollowing()).toBe(false);

      // A writable scroll position lets us prove setTheme never resets it.
      let scrollTopValue = 321;
      Object.defineProperty(log, 'scrollTop', {
        configurable: true,
        get: () => scrollTopValue,
        set: (value: number) => {
          scrollTopValue = value;
        },
      });

      // Apply search highlights through the normal debounced input path.
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      });
      const input = rendered.host.querySelector(
        '#piview-search-input'
      ) as HTMLInputElement;
      input.value = 'alpha';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(200);
      expect(rendered.host.querySelectorAll('mark.piview-search-match').length).toBeGreaterThan(0);

      const baselineBlocks = blocks.innerHTML;
      const baselineSearch = (
        rendered.host.querySelector('#piview-search-count') as HTMLElement
      ).textContent;
      const baselineFormatted = Array.from(
        rendered.log.querySelectorAll('[data-role="formatted"]')
      ) as HTMLElement[];
      expect(baselineFormatted.length).toBeGreaterThan(0);

      for (const theme of themes) {
        view.setTheme(theme.id);
        expect(view.getThemeId()).toBe(theme.id);
        expect(log.getAttribute('data-piview-theme')).toBe(theme.id);
        expect(blocks.innerHTML).toBe(baselineBlocks);
        expect(log.scrollTop).toBe(321);
        expect(view.isFollowing()).toBe(false);
        expect(
          (rendered.host.querySelector('#piview-search-count') as HTMLElement).textContent
        ).toBe(baselineSearch);
        const formattedNow = Array.from(
          rendered.log.querySelectorAll('[data-role="formatted"]')
        ) as HTMLElement[];
        expect(formattedNow).toEqual(baselineFormatted);
        formattedNow.forEach((el) => expect(el.isConnected).toBe(true));

        // Switching to the same theme again is a no-op for the view state.
        const styleAfterFirstSwitch = log.getAttribute('style');
        view.setTheme(theme.id);
        expect(view.getThemeId()).toBe(theme.id);
        expect(log.getAttribute('style')).toBe(styleAfterFirstSwitch);
        expect(blocks.innerHTML).toBe(baselineBlocks);
        expect(log.scrollTop).toBe(321);
        expect(view.isFollowing()).toBe(false);
      }

      destroyView(rendered);
    });
  }
});

describe('PiView theme conformance: stylesheet isolation', () => {
  it('never references app/syntax tokens or the app data-theme selector', () => {
    const stylesheets = [
      PI_VIEW_CSS_SOURCE,
      stripCssComments(keybindingCss),
      ...Object.values(PI_VIEW_THEMES).map((theme) => stripCssComments(theme.css ?? '')),
    ];

    for (const css of stylesheets) {
      expect(css).not.toMatch(/(^|[^\w-])--app-[a-z0-9-]+/m);
      expect(css).not.toMatch(/(^|[^\w-])--syntax-[a-z0-9-]+/m);
      expect(css).not.toMatch(/\[data-theme\s*=/);
    }
  });

  it('keeps footer chrome unaffected by a theme switch', () => {
    const themes = Object.values(PI_VIEW_THEMES);
    const rendered = renderFixture('batch', themes[0].id);
    const footer = rendered.host.querySelector('.piview-footer') as HTMLElement;
    expect(footer).not.toBeNull();

    const footerBefore = footer.outerHTML;
    for (const theme of themes) {
      rendered.view.setTheme(theme.id);
      expect(footer.outerHTML).toBe(footerBefore);
      expect(footer.hasAttribute('data-piview-theme')).toBe(false);
      expect(footer.querySelector('[data-piview-theme]')).toBeNull();
      expect(rendered.log.getAttribute('data-piview-theme')).toBe(theme.id);
    }

    destroyView(rendered);
  });

  it('does not let footer rules consume PiView theme tokens', () => {
    const footerBlocks = Array.from(
      PI_VIEW_CSS_SOURCE.matchAll(/([^{}]*\.piview-footer[^{}]*)\{([^{}]*)\}/g)
    );
    expect(footerBlocks.length).toBeGreaterThan(0);
    for (const [, selector, declarations] of footerBlocks) {
      expect(selector).not.toContain('[data-piview-theme');
      expect(declarations).not.toMatch(/var\(\s*--piview-/);
    }
  });
});
