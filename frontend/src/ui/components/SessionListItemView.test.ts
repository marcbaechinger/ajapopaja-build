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

import { describe, it, expect } from 'vitest';
import { SessionListItemView, sessionStatusMeta } from './SessionListItemView.ts';
import type { PiSessionSummary } from '../../core/InteractiveCodingService.ts';

const session = (overrides: Partial<PiSessionSummary> = {}): PiSessionSummary => ({
  uid: 'u1',
  kind: 'interactive',
  status: 'paused',
  pipeline_id: 'p1',
  resume_count: 3,
  last_active_at: '2026-01-02T03:04:05Z',
  ...overrides,
});

function mount(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('SessionListItemView', () => {
  it('renders the status label and colour per status', () => {
    const cases: [PiSessionSummary['status'], string][] = [
      ['running', 'Active'],
      ['paused', 'Paused'],
      ['completed', 'Completed'],
      ['failed', 'Failed'],
      ['discarded', 'Discarded'],
    ];
    for (const [status, label] of cases) {
      const el = mount(SessionListItemView.render(session({ status })));
      const badge = el.querySelector('[data-session-status]');
      expect(badge?.textContent).toContain(label);
      expect(badge?.className).toContain(sessionStatusMeta(status).color.replace('text-', ''));
    }
  });

  it('falls back to (untitled) when no label or task id is present', () => {
    const el = mount(SessionListItemView.render(session({ label: null, task_id: null })));
    expect(el.textContent).toContain('(untitled)');
  });

  it('shows a Switch action for resumable statuses', () => {
    for (const status of ['paused', 'completed', 'failed'] as PiSessionSummary['status'][]) {
      const el = mount(SessionListItemView.render(session({ status })));
      const switchBtn = el.querySelector('[data-session-action="switch"]');
      expect(switchBtn).not.toBeNull();
      expect(switchBtn?.getAttribute('data-session-uid')).toBe('u1');
    }
  });

  it('shows a Pause action instead of Switch for the active session', () => {
    const el = mount(SessionListItemView.render(session({ status: 'running' }), { isActive: true }));
    expect(el.querySelector('[data-session-action="pause"]')).not.toBeNull();
    expect(el.querySelector('[data-session-action="switch"]')).toBeNull();
  });

  it('hides resumable actions for discarded sessions', () => {
    const el = mount(SessionListItemView.render(session({ status: 'discarded' })));
    expect(el.querySelector('[data-session-action="switch"]')).toBeNull();
    expect(el.querySelector('[data-session-action="pause"]')).toBeNull();
  });

  it('renders turn count, relative time and pipeline name', () => {
    const el = mount(
      SessionListItemView.render(session(), { pipelineName: 'Pipeline A' })
    );
    expect(el.textContent).toContain('Pipeline A');
    expect(el.textContent).toContain('3 turns');
    expect(el.querySelector('[data-session-relative]')?.textContent).toBeTruthy();
  });

  it('exposes a disable state while switching', () => {
    const el = mount(
      SessionListItemView.render(session(), { switchingUid: 'u1' })
    );
    const switchBtn = el.querySelector('[data-session-action="switch"]') as HTMLButtonElement;
    expect(switchBtn.disabled).toBe(true);
    expect(switchBtn.textContent).toContain('Switching');
  });
});
