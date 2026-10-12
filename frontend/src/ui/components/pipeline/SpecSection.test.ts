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
import { Task } from '../../../core/domain.ts';
import {
  renderSpecSection,
  renderSpecProposalResult,
  renderSpecProposalError,
  setTaskSpecProposalUpdater,
  getTaskSpecProposalUpdater,
} from './SpecSection.ts';

function makeTask(overrides: Record<string, any> = {}): Task {
  return new Task({
    id: 't1',
    title: 'A task',
    spec: '- first point\n- second point',
    pipeline_id: 'p1',
    status: 'created',
    version: 3,
    ...overrides,
  });
}

describe('SpecSection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setTaskSpecProposalUpdater(null);
  });

  afterEach(() => {
    setTaskSpecProposalUpdater(null);
    vi.restoreAllMocks();
  });

  describe('renderSpecSection', () => {
    it('mounts an Elaborate button that triggers the SpecAgent', () => {
      const html = renderSpecSection(makeTask(), true);
      expect(html).toContain('Elaborate');
      expect(html).toContain('data-action-click="trigger_specagent"');
      expect(html).toContain('data-task-id="t1"');
      expect(html).toContain('data-pipeline-id="p1"');
      expect(html).toContain('data-oneprompt-target');
    });

    it('omits the Elaborate button for completed tasks', () => {
      const html = renderSpecSection(makeTask({ status: 'implemented' }), true);
      expect(html).not.toContain('trigger_specagent');
    });

    it('renders a copy icon-button next to the Specification label', () => {
      const html = renderSpecSection(makeTask(), true);
      expect(html).toContain('data-action-click="copy_spec"');
      expect(html).toContain('title="Copy Specification"');
      expect(html).toContain('icons.svg#copy-icon');
    });

    it('omits the copy icon-button when there is no specification', () => {
      const html = renderSpecSection(makeTask({ spec: '' }), true);
      expect(html).not.toContain('data-action-click="copy_spec"');
    });

    it('removes the "Click to edit" affordance from the header', () => {
      const html = renderSpecSection(makeTask(), true);
      expect(html).not.toContain('Click to edit');
    });

    it('renders the expand toggle in the header, before the Elaborate button', () => {
      const container = document.createElement('div');
      container.innerHTML = renderSpecSection(makeTask(), true);
      const header = container.querySelector('.spec-view > div')!;
      const toggle = header.querySelector('[data-action-click="toggle_spec_expand"]')!;
      const elaborate = header.querySelector('[data-action-click="trigger_specagent"]')!;

      expect(toggle).not.toBeNull();
      expect(elaborate).not.toBeNull();
      expect(
        toggle.compareDocumentPosition(elaborate) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(toggle.textContent).toContain('Show Less');
    });
  });

  describe('renderSpecProposalResult', () => {
    it('renders the markdown proposal with accept/reject controls', () => {
      const container = document.createElement('div');
      renderSpecProposalResult(container, { spec_md: '# Spec\n\nExpanded **spec**' });

      expect(container.querySelector('.spec-proposal-result')).toBeTruthy();
      expect(container.querySelector('.spec-proposal-content')?.innerHTML).toContain(
        '<strong>spec</strong>'
      );
      expect(
        container.querySelector('[data-spec-proposal-action="accept"]')?.textContent?.trim()
      ).toBe('Accept');
      expect(
        container.querySelector('[data-spec-proposal-action="reject"]')?.textContent?.trim()
      ).toBe('Reject');
    });

    it('honours custom accept/reject labels', () => {
      const container = document.createElement('div');
      renderSpecProposalResult(container, {
        spec_md: '# Spec',
        acceptLabel: 'Apply',
        rejectLabel: 'Discard',
      });
      expect(
        container.querySelector('[data-spec-proposal-action="accept"]')?.textContent?.trim()
      ).toBe('Apply');
      expect(
        container.querySelector('[data-spec-proposal-action="reject"]')?.textContent?.trim()
      ).toBe('Discard');
    });

    it('wires the buttons to the accept/reject callbacks', async () => {
      const container = document.createElement('div');
      const accept = vi.fn();
      const reject = vi.fn();
      renderSpecProposalResult(container, { spec_md: '# Spec', onAccept: accept, onReject: reject });

      container.querySelector<HTMLButtonElement>('[data-spec-proposal-action="accept"]')!.click();
      container.querySelector<HTMLButtonElement>('[data-spec-proposal-action="reject"]')!.click();
      await Promise.resolve();

      expect(accept).toHaveBeenCalledTimes(1);
      expect(accept.mock.calls[0][0]).toContain('# Spec');
      expect(reject).toHaveBeenCalledTimes(1);
    });

    it('accepts the historical callback and result field names', async () => {
      const container = document.createElement('div');
      const accept = vi.fn();
      renderSpecProposalResult(container, { result: '# Old', accept });

      container.querySelector<HTMLButtonElement>('[data-spec-proposal-action="accept"]')!.click();
      await Promise.resolve();
      expect(accept).toHaveBeenCalledWith('# Old');
    });
  });

  describe('renderSpecProposalError', () => {
    it('renders the error message', () => {
      const container = document.createElement('div');
      renderSpecProposalError(container, 'Something went wrong');
      expect(container.querySelector('.spec-proposal-error')?.textContent).toContain(
        'Something went wrong'
      );
    });
  });

  describe('proposal updater', () => {
    it('stores and returns the write-back handler', () => {
      const updater = vi.fn();
      setTaskSpecProposalUpdater(updater);
      expect(getTaskSpecProposalUpdater()).toBe(updater);
      setTaskSpecProposalUpdater(null);
      expect(getTaskSpecProposalUpdater()).toBeNull();
    });
  });
});
