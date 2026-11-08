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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManagerPanel } from './SessionManagerPanel.ts';
import { handleQuickPromptResult, resetOnePromptState } from '../../../core/oneprompt.ts';

const confirmResult = vi.fn().mockResolvedValue(true);
vi.mock('../dialogs/ConfirmationDialog.ts', () => ({
  ConfirmationDialog: vi.fn(function ConfirmationDialog() {
    return { show: confirmResult };
  }),
}));

function makeSession(uid: string, overrides: any = {}) {
  return {
    uid,
    kind: 'interactive',
    status: 'paused',
    pipeline_id: 'p1',
    label: `Session ${uid}`,
    resume_count: 2,
    last_active_at: '2026-01-02T03:04:05Z',
    ...overrides,
  };
}

function makeContext(sessions: any[] = []) {
  let sessionsListener: ((s: any[]) => void) | null = null;
  const service = {
    getSessions: vi.fn(() => sessions),
    getSession: vi.fn((uid: string) => sessions.find((s) => s.uid === uid)),
    getCurrentSession: vi.fn(() => ({ pipelineId: null, uid: null, active: false, busy: false })),
    isBusy: vi.fn(() => false),
    isSessionsLoading: vi.fn(() => false),
    getSessionsError: vi.fn(() => null),
    isSwitching: vi.fn(() => null),
    onSessionsChange: vi.fn((l: (s: any[]) => void) => {
      sessionsListener = l;
      return () => (sessionsListener = null);
    }),
    onSessionChange: vi.fn(() => () => {}),
    refreshSessions: vi.fn().mockResolvedValue([]),
    switchSession: vi.fn().mockResolvedValue(undefined),
    pauseSession: vi.fn().mockResolvedValue(undefined),
    discardSession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    getResumeHint: vi.fn(() => null),
    dismissResumeHint: vi.fn(),
  };
  const context = {
    interactiveCodingService: service,
    dataManager: { getPipeline: vi.fn(() => ({ name: 'Pipeline A' })) },
    wsClient: { send: vi.fn() },
  };
  return { context, service, emit: () => sessionsListener?.(sessions) };
}

describe('SessionManagerPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    confirmResult.mockResolvedValue(true);
    resetOnePromptState();
    vi.clearAllMocks();
  });

  it('renders sessions grouped by status', () => {
    const { context } = makeContext([
      makeSession('u1', { status: 'running', label: 'Active one' }),
      makeSession('u2', { status: 'paused', label: 'Paused one' }),
      makeSession('u3', { status: 'completed', label: 'Done one' }),
      makeSession('u4', { status: 'failed', label: 'Failed one' }),
    ]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();

    const body = panel['container'].querySelector('#session-manager-body') as HTMLElement;
    expect(body.textContent).toContain('Active one');
    expect(body.textContent).toContain('Paused one');
    expect(body.textContent).toContain('Done one');
    expect(body.textContent).toContain('Failed one');
    expect(body.querySelectorAll('[data-session-group]')).toHaveLength(4);
  });

  it('filters by search query', () => {
    const { context } = makeContext([
      makeSession('u1', { label: 'Fix the auth test' }),
      makeSession('u2', { label: 'Refactor parser' }),
    ]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();
    const search = panel['container'].querySelector('#session-manager-search') as HTMLInputElement;
    search.value = 'auth';
    search.dispatchEvent(new Event('input'));

    const body = panel['container'].querySelector('#session-manager-body') as HTMLElement;
    expect(body.textContent).toContain('Fix the auth test');
    expect(body.textContent).not.toContain('Refactor parser');
  });

  it('filters with status chips', () => {
    const { context } = makeContext([
      makeSession('u1', { status: 'paused', label: 'Paused one' }),
      makeSession('u2', { status: 'completed', label: 'Done one' }),
    ]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();
    const chip = panel['container'].querySelector('[data-session-filter="completed"]') as HTMLElement;
    chip.click();
    const body = panel['container'].querySelector('#session-manager-body') as HTMLElement;
    expect(body.textContent).toContain('Done one');
    expect(body.textContent).not.toContain('Paused one');
  });

  it('hides batch (coderbot) sessions unless the Batch toggle is checked', () => {
    const { context } = makeContext([
      makeSession('u1', { kind: 'interactive', label: 'Interactive one' }),
      makeSession('u2', { kind: 'coderbot', status: 'completed', label: 'Batch one' }),
    ]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();

    const body = panel['container'].querySelector('#session-manager-body') as HTMLElement;
    const showBatch = panel['container'].querySelector(
      '#session-manager-show-batch'
    ) as HTMLInputElement;

    // Batch sessions are hidden by default...
    expect(body.textContent).toContain('Interactive one');
    expect(body.textContent).not.toContain('Batch one');

    // ...and appear once the toggle is enabled.
    showBatch.checked = true;
    showBatch.dispatchEvent(new Event('change'));
    expect(body.textContent).toContain('Batch one');

    // Unticking it hides them again.
    showBatch.checked = false;
    showBatch.dispatchEvent(new Event('change'));
    expect(body.textContent).not.toContain('Batch one');
  });

  it('renders batch (coderbot) sessions read-only (no switch/pause action)', () => {
    const { context } = makeContext([
      makeSession('u2', { kind: 'coderbot', status: 'completed', label: 'Batch one' }),
    ]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();

    const showBatch = panel['container'].querySelector(
      '#session-manager-show-batch'
    ) as HTMLInputElement;
    showBatch.checked = true;
    showBatch.dispatchEvent(new Event('change'));

    const body = panel['container'].querySelector('#session-manager-body') as HTMLElement;
    const row = body.querySelector('[data-session-uid="u2"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.querySelector('[data-session-action="switch"]')).toBeNull();
    expect(row.querySelector('[data-session-action="pause"]')).toBeNull();
    // The read-only affordances remain available.
    expect(row.querySelector('[data-session-action="discard"]')).not.toBeNull();
    expect(row.querySelector('[data-session-action="open"]')).not.toBeNull();
  });

  it('does not switch to a batch (coderbot) session through a stray row action', async () => {
    const { context, service } = makeContext([
      makeSession('u2', { kind: 'coderbot', status: 'completed', label: 'Batch one' }),
    ]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();

    // Simulate a stale/keyboard-triggered switch action on the read-only row.
    const body = panel['container'].querySelector('#session-manager-body') as HTMLElement;
    body.innerHTML = '<button data-session-action="switch" data-session-uid="u2">go</button>';
    (body.querySelector('button') as HTMLElement).click();
    await Promise.resolve();

    expect(service.switchSession).not.toHaveBeenCalled();
  });

  it('highlights the selected filter chip', () => {
    const { context } = makeContext([
      makeSession('u1', { status: 'paused' }),
      makeSession('u2', { status: 'completed' }),
    ]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();

    const chipFor = (filter: string) =>
      panel['container'].querySelector(`[data-session-filter="${filter}"]`) as HTMLElement;

    // Initially "all" is the selected chip.
    expect(chipFor('all').classList.contains('bg-app-accent-2')).toBe(true);
    expect(chipFor('completed').classList.contains('bg-app-accent-2')).toBe(false);

    chipFor('completed').click();

    // The highlight must follow the newly selected filter.
    expect(chipFor('completed').classList.contains('bg-app-accent-2')).toBe(true);
    expect(chipFor('completed').classList.contains('text-app-accent-fg')).toBe(true);
    expect(chipFor('completed').classList.contains('border-app-accent-2')).toBe(true);
    expect(chipFor('all').classList.contains('bg-app-accent-2')).toBe(false);
    expect(chipFor('all').classList.contains('text-app-muted')).toBe(true);

    chipFor('failed').click();
    expect(chipFor('failed').classList.contains('bg-app-accent-2')).toBe(true);
    expect(chipFor('completed').classList.contains('bg-app-accent-2')).toBe(false);
  });

  it('shows an empty state', () => {
    const { context } = makeContext([]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();
    const body = panel['container'].querySelector('#session-manager-body') as HTMLElement;
    expect(body.textContent).toContain('No sessions yet');
  });

  it('switches to a paused session', async () => {
    const { context, service } = makeContext([makeSession('u2')]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();
    const switchBtn = panel['container'].querySelector(
      '[data-session-action="switch"]'
    ) as HTMLElement;
    switchBtn.click();
    await Promise.resolve();
    expect(service.switchSession).toHaveBeenCalledWith('u2');
  });

  it('switches the active row to a Switch action after pausing', async () => {
    const sessions = [makeSession('u1', { status: 'running' }) as any];
    let active = true;
    const listeners = new Set<(s: any[]) => void>();
    const service = {
      getSessions: vi.fn(() => sessions),
      getSession: vi.fn((uid: string) => sessions.find((s) => s.uid === uid)),
      getCurrentSession: vi.fn(() => ({ pipelineId: 'p1', uid: 'u1', active, busy: false })),
      isBusy: vi.fn(() => false),
      isSessionsLoading: vi.fn(() => false),
      getSessionsError: vi.fn(() => null),
      isSwitching: vi.fn(() => null),
      onSessionsChange: vi.fn((l: (s: any[]) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      }),
      onSessionChange: vi.fn(() => () => {}),
      refreshSessions: vi.fn().mockResolvedValue([]),
      switchSession: vi.fn().mockResolvedValue(undefined),
      pauseSession: vi.fn().mockImplementation(async () => {
        active = false;
        sessions[0].status = 'paused';
        listeners.forEach((l) => l(sessions));
      }),
      discardSession: vi.fn().mockResolvedValue(undefined),
      renameSession: vi.fn().mockResolvedValue(undefined),
      getResumeHint: vi.fn(() => null),
      dismissResumeHint: vi.fn(),
    };
    const context = {
      interactiveCodingService: service,
      dataManager: { getPipeline: vi.fn(() => ({ name: 'Pipeline A' })) },
      wsClient: { send: vi.fn() },
    };
    const panel = new SessionManagerPanel(context as any);
    panel.open();

    let body = panel['container'].querySelector('#session-manager-body') as HTMLElement;
    const pauseBtn = body.querySelector('[data-session-action="pause"]') as HTMLElement;
    expect(pauseBtn).not.toBeNull();

    pauseBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    body = panel['container'].querySelector('#session-manager-body') as HTMLElement;
    expect(service.pauseSession).toHaveBeenCalled();
    expect(body.querySelector('[data-session-action="pause"]')).toBeNull();
    expect(body.querySelector('[data-session-action="switch"]')).not.toBeNull();
  });

  it('confirms before discarding', async () => {
    const { context, service } = makeContext([makeSession('u2')]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();
    const discardBtn = panel['container'].querySelector(
      '[data-session-action="discard"]'
    ) as HTMLElement;
    discardBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(confirmResult).toHaveBeenCalled();
    expect(service.discardSession).toHaveBeenCalledWith('u2');
  });

  it('does not discard when the confirmation is declined', async () => {
    confirmResult.mockResolvedValue(false);
    const { context, service } = makeContext([makeSession('u2')]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();
    const discardBtn = panel['container'].querySelector(
      '[data-session-action="discard"]'
    ) as HTMLElement;
    discardBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(service.discardSession).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const { context } = makeContext([makeSession('u1')]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();
    expect(panel.isVisible()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.isVisible()).toBe(false);
  });

  it('sends a session_generate_title quick_prompt from the title button', async () => {
    const { context } = makeContext([makeSession('u1')]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();

    const button = panel['container'].querySelector(
      '[data-session-action="generate-title"]'
    ) as HTMLElement;
    expect(button).not.toBeNull();
    button.click();
    await Promise.resolve();

    const send = context.wsClient.send as ReturnType<typeof vi.fn>;
    expect(send).toHaveBeenCalledTimes(1);
    const [type, payload] = send.mock.calls[0] as [string, any];
    expect(type).toBe('quick_prompt');
    expect(payload.promptId).toBe('session_generate_title');
    expect(payload.context).toEqual({ sessionUid: 'u1' });
  });

  it('renders an editable title and accepts it via renameSession', async () => {
    const { context, service } = makeContext([makeSession('u1')]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();

    (
      panel['container'].querySelector(
        '[data-session-action="generate-title"]'
      ) as HTMLElement
    ).click();
    await Promise.resolve();
    const payload = (context.wsClient.send as ReturnType<typeof vi.fn>).mock.calls[0][1] as any;

    handleQuickPromptResult({
      type: 'quick_prompt_result',
      payload: {
        runId: payload.runId,
        promptId: 'session_generate_title',
        context: { sessionUid: 'u1', max_title_length: 80 },
        result: 'Fix the auth test',
        status: 'ok',
        meta: {},
      },
    });

    const input = panel['container'].querySelector(
      '[data-session-title-input]'
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.maxLength).toBe(80);
    expect(input.value).toBe('Fix the auth test');

    input.value = 'Renamed title';
    (
      panel['container'].querySelector(
        '[data-oneprompt-action="accept"]'
      ) as HTMLElement
    ).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.renameSession).toHaveBeenCalledWith('u1', 'Renamed title');
  });

  it('drops a stale title result once the row is gone', async () => {
    const { context } = makeContext([makeSession('u1')]);
    const panel = new SessionManagerPanel(context as any);
    panel.open();

    (
      panel['container'].querySelector(
        '[data-session-action="generate-title"]'
      ) as HTMLElement
    ).click();
    await Promise.resolve();
    const payload = (context.wsClient.send as ReturnType<typeof vi.fn>).mock.calls[0][1] as any;

    const body = panel['container'].querySelector('#session-manager-body') as HTMLElement;
    body.innerHTML = '';

    const handled = handleQuickPromptResult({
      type: 'quick_prompt_result',
      payload: {
        runId: payload.runId,
        promptId: 'session_generate_title',
        context: { sessionUid: 'u1' },
        result: 'stale',
        status: 'ok',
        meta: {},
      },
    });

    expect(handled).toBe(false);
  });
});
