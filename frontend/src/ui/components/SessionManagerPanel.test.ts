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

const confirmResult = vi.fn().mockResolvedValue(true);
vi.mock('./ConfirmationDialog.ts', () => ({
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
    getResumeHint: vi.fn(() => null),
    dismissResumeHint: vi.fn(),
  };
  const context = {
    interactiveCodingService: service,
    dataManager: { getPipeline: vi.fn(() => ({ name: 'Pipeline A' })) },
  };
  return { context, service, emit: () => sessionsListener?.(sessions) };
}

describe('SessionManagerPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    confirmResult.mockResolvedValue(true);
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
});
