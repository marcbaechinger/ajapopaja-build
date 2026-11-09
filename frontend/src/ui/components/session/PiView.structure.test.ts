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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PiView, type PiSessionService } from './PiView.ts';
import type { BlockKind, RenderBlock } from '../../../core/CoderBotService.ts';

// PiView coalesces block reconciliations onto the next animation frame. Tests
// drive that frame manually via flushRaf() so DOM assertions stay synchronous.
let rafCallbacks: Map<number, FrameRequestCallback>;
let rafNextId: number;

function flushRaf() {
  const pending = Array.from(rafCallbacks.values());
  rafCallbacks.clear();
  for (const cb of pending) cb(0);
}

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
});

function createStubService(overrides: Partial<PiSessionService> = {}) {
  const listeners: {
    blocks: Set<(blocks: RenderBlock[]) => void>;
    message: Set<(content: string) => void>;
    state: Set<(active: boolean) => void>;
  } = {
    blocks: new Set(),
    message: new Set(),
    state: new Set(),
  };

  const emitBlocks = (blocks: RenderBlock[]) => {
    listeners.blocks.forEach((l) => l(blocks));
    flushRaf();
  };

  const service: PiSessionService = {
    getHistory: vi.fn(() => []),
    getCurrentTaskId: vi.fn(() => null),
    isActive: vi.fn(() => false),
    getSessionStartTime: vi.fn(() => null),
    onSessionStartTimeChange: vi.fn(() => () => { }),
    clearHistory: vi.fn(),
    stopSession: vi.fn(async () => { }),
    onBlocks: vi.fn((l) => {
      listeners.blocks.add(l);
      return () => listeners.blocks.delete(l);
    }),
    onMessage: vi.fn((l) => {
      listeners.message.add(l);
      return () => listeners.message.delete(l);
    }),
    onSessionStateChange: vi.fn((l) => {
      listeners.state.add(l);
      return () => listeners.state.delete(l);
    }),
    ...overrides,
  };

  return { service, listeners, emitBlocks };
}

interface BlockHook {
  id: string;
  /** The public BlockKind, plus `unknown` for the defensive default branch. */
  kind: BlockKind | 'unknown';
  tag: string;
  classes: string[];
  roles?: Array<{ selector: string; tag: string }>;
}

const unknownBlock = {
  id: 'unknown',
  kind: 'unknown',
  text: 'unrecognized block',
} as unknown as RenderBlock;

/**
 * The hook contract for every block kind. Later theme tasks are allowed to
 * change colors/tokens, but this map (tag, class hooks and data hooks) is the
 * frozen part of the DOM.
 */
const FIXTURE: Array<{ block: RenderBlock; hook: BlockHook }> = [
  {
    block: { id: 'user', kind: 'user', header: 'You', text: 'hello' },
    hook: {
      id: 'user',
      kind: 'user',
      tag: 'DIV',
      classes: ['piview-user'],
      roles: [
        { selector: '[data-role="header"]', tag: 'DIV' },
        { selector: '[data-role="body"]', tag: 'DIV' },
      ],
    },
  },
  {
    block: {
      id: 'text',
      kind: 'text',
      text: '# Heading\n\n**bold** and *italic*',
      complete: true,
    },
    hook: {
      id: 'text',
      kind: 'text',
      tag: 'DIV',
      classes: ['piview-text'],
      roles: [{ selector: '[data-role="formatted"]', tag: 'DIV' }],
    },
  },
  {
    block: { id: 'thinking', kind: 'thinking', text: 'hmm' },
    hook: {
      id: 'thinking',
      kind: 'thinking',
      tag: 'DIV',
      classes: ['piview-thinking', 'piview-collapsible'],
      roles: [
        { selector: '[data-role="header"]', tag: 'DIV' },
        { selector: '[data-role="body"]', tag: 'PRE' },
      ],
    },
  },
  {
    block: { id: 'tool', kind: 'tool', header: '→ Calling write', text: 'const x = 1' },
    hook: {
      id: 'tool',
      kind: 'tool',
      tag: 'DIV',
      classes: ['piview-toolverify', 'piview-collapsible'],
      roles: [
        { selector: '[data-role="header"]', tag: 'DIV' },
        { selector: '[data-role="body"]', tag: 'PRE' },
      ],
    },
  },
  {
    block: { id: 'bash', kind: 'bash', text: '$ cmd' },
    hook: {
      id: 'bash',
      kind: 'bash',
      tag: 'PRE',
      classes: ['piview-bash'],
    },
  },
  {
    block: { id: 'notice', kind: 'notice', text: '● started' },
    hook: {
      id: 'notice',
      kind: 'notice',
      tag: 'DIV',
      classes: ['piview-notice'],
    },
  },
  {
    block: { id: 'error', kind: 'error', text: 'boom' },
    hook: {
      id: 'error',
      kind: 'error',
      tag: 'DIV',
      classes: ['piview-error'],
    },
  },
  {
    block: { id: 'divider', kind: 'divider', text: '— turn —' },
    hook: {
      id: 'divider',
      kind: 'divider',
      tag: 'DIV',
      classes: ['piview-divider'],
    },
  },
  {
    block: { id: 'verification-ok', kind: 'verification', text: '● PASS', sub: ['- cmd  1'] },
    hook: {
      id: 'verification-ok',
      kind: 'verification',
      tag: 'DIV',
      classes: [
        'piview-toolverify',
        'piview-collapsible',
        'piview-verification',
        'piview-verification-ok',
      ],
      roles: [
        { selector: '[data-role="header"]', tag: 'DIV' },
        { selector: '[data-role="body"]', tag: 'PRE' },
      ],
    },
  },
  {
    block: {
      id: 'verification-error',
      kind: 'verification',
      text: '● FAIL',
      sub: ['- cmd  1'],
      error: true,
    },
    hook: {
      id: 'verification-error',
      kind: 'verification',
      tag: 'DIV',
      classes: [
        'piview-toolverify',
        'piview-collapsible',
        'piview-verification',
        'piview-verification-error',
      ],
      roles: [
        { selector: '[data-role="header"]', tag: 'DIV' },
        { selector: '[data-role="body"]', tag: 'PRE' },
      ],
    },
  },
  {
    block: unknownBlock,
    hook: {
      id: 'unknown',
      kind: 'unknown',
      tag: 'DIV',
      classes: ['piview-block'],
    },
  },
];

// Chrome, block shells, action-icon SVG and sanitized Markdown output are the
// only element types allowed inside the log scroller.
const ALLOWED_LOG_TAGS = new Set([
  'DIV',
  'SPAN',
  'PRE',
  'P',
  'BUTTON',
  'SVG',
  'USE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'STRONG',
  'EM',
  'DEL',
  'CODE',
  'BLOCKQUOTE',
  'HR',
  'A',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TH',
  'TD',
  'BR',
  'IMG',
]);

describe('PiView DOM structure contract', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderFixture() {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks(FIXTURE.map((entry) => entry.block));
    // The completed `text` block is Markdown-rendered on the idle queue.
    view.flushAutoFormat();
    return view;
  }

  it('exposes the frozen tag, class and data hooks for every block kind', () => {
    const view = renderFixture();
    const blocks = mount.querySelector('#log-blocks') as HTMLElement;
    expect(blocks).not.toBeNull();

    const blockEls = Array.from(blocks.querySelectorAll<HTMLElement>(':scope > [data-block-id]'));
    expect(blockEls).toHaveLength(FIXTURE.length);

    for (const { block, hook } of FIXTURE) {
      const el = blocks.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`);
      expect(el, `missing block element for ${block.id}`).not.toBeNull();
      if (!el) continue;

      expect(el.tagName).toBe(hook.tag);
      expect(el.getAttribute('data-block-id')).toBe(hook.id);
      expect(el.getAttribute('data-kind')).toBe(hook.kind);
      for (const className of hook.classes) {
        expect(el.classList.contains(className), `${block.id} missing .${className}`).toBe(true);
      }

      // Every block keeps its per-block copy and format action hooks.
      expect(el.querySelector(`button[data-copy-block="${block.id}"]`)?.tagName).toBe('BUTTON');
      expect(el.querySelector(`button[data-format-block="${block.id}"]`)?.tagName).toBe('BUTTON');

      for (const role of hook.roles ?? []) {
        const roleEl = el.querySelector<HTMLElement>(role.selector);
        expect(roleEl, `${block.id} missing ${role.selector}`).not.toBeNull();
        expect(roleEl?.tagName).toBe(role.tag);
      }
    }

    // The two verification flavours are distinguishable from each other and
    // from ordinary tool blocks.
    const verificationOk = blocks.querySelector('[data-block-id="verification-ok"]')!;
    const verificationError = blocks.querySelector('[data-block-id="verification-error"]')!;
    expect(verificationOk.classList.contains('piview-verification-ok')).toBe(true);
    expect(verificationOk.classList.contains('piview-verification-error')).toBe(false);
    expect(verificationError.classList.contains('piview-verification-error')).toBe(true);
    expect(verificationError.classList.contains('piview-verification-ok')).toBe(false);

    view.destroy();
  });

  it('makes every BlockKind selectable via [data-kind] inside #log-blocks', () => {
    const view = renderFixture();
    const blocks = mount.querySelector('#log-blocks') as HTMLElement;

    const kinds: BlockKind[] = [
      'user',
      'text',
      'thinking',
      'tool',
      'bash',
      'notice',
      'error',
      'divider',
      'verification',
    ];
    for (const kind of kinds) {
      expect(
        blocks.querySelectorAll(`[data-kind="${kind}"]`).length,
        `no block selectable by [data-kind="${kind}"]`
      ).toBeGreaterThan(0);
    }

    // Every block element carries a kind, including the defensive default.
    blocks.querySelectorAll<HTMLElement>(':scope > [data-block-id]').forEach((el) => {
      expect(el.getAttribute('data-kind')).toBeTruthy();
    });
    expect(blocks.querySelector('[data-kind="unknown"]')).not.toBeNull();

    view.destroy();
  });

  it('keeps collapsible block internals on their data-role / data-toggle hooks', () => {
    const view = renderFixture();
    const blocks = mount.querySelector('#log-blocks') as HTMLElement;

    for (const id of ['tool', 'thinking', 'verification-ok', 'verification-error']) {
      const el = blocks.querySelector<HTMLElement>(`[data-block-id="${id}"]`)!;
      const header = el.querySelector<HTMLElement>('[data-role="header"]');
      expect(header, `${id} missing header`).not.toBeNull();
      expect(header?.hasAttribute('data-toggle')).toBe(true);
      expect(header?.querySelector('[data-glyph]')?.tagName).toBe('SPAN');
      if (id !== 'thinking') {
        expect(header?.querySelector('[data-label]')?.tagName).toBe('SPAN');
      }
    }

    view.destroy();
  });

  it('contains no unexpected element types inside #log-content-container', () => {
    const view = renderFixture();
    const container = mount.querySelector('#log-content-container') as HTMLElement;
    expect(container).not.toBeNull();

    // The direct children are the frozen chrome + blocks containers.
    expect(Array.from(container.children).map((el) => el.tagName)).toEqual([
      'DIV',
      'DIV',
      'DIV',
      'DIV',
    ]);
    expect(
      Array.from(container.children).map((el) => (el as HTMLElement).id).filter(Boolean)
    ).toEqual([
      'piview-status-bar',
      'log-blocks',
      'piview-empty-state',
      'piview-session-ended',
    ]);

    // The toast overlay lives in the non-scrolling frame so it stays visible
    // while the log content scrolls.
    const frame = container.parentElement as HTMLElement;
    expect(frame?.classList.contains('piview-log-frame')).toBe(true);
    expect(frame.querySelector('#piview-toast')).not.toBeNull();

    const unexpected = Array.from(container.querySelectorAll('*'))
      // SVG elements report lowercase tag names even in an HTML document.
      .map((el) => el.tagName.toUpperCase())
      .filter((tag) => !ALLOWED_LOG_TAGS.has(tag));
    expect(unexpected).toEqual([]);

    view.destroy();
  });
});
