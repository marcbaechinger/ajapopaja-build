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
import { registerTaskSpecActions } from './taskSpecActions.ts';
import type { TaskSpecActionsDeps } from './taskSpecActions.ts';
import { createPipelineDetailState } from '../PipelineDetailCtx.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';
import type { ActionHandler } from '../../../../core/ActionRegistry.ts';

/** The handlers never read the event; a placeholder keeps the signature. */
const noEvent = null as unknown as Event;

const makeTitleContainer = (taskId: string, title: string): HTMLElement => {
  const el = document.createElement('div');
  el.className = 'title-container';
  el.setAttribute('data-task-id', taskId);
  el.setAttribute('data-version', '1');
  el.innerHTML = `
    <div class="title-view"><span class="font-medium">${title}</span></div>
    <div class="title-edit hidden"><input value="${title}"></div>
  `;
  document.body.appendChild(el);
  return el;
};

const makeSpecContainer = (taskId: string, spec = 'old spec'): HTMLElement => {
  const el = document.createElement('div');
  el.className = 'spec-container';
  el.setAttribute('data-task-id', taskId);
  el.setAttribute('data-version', '1');
  el.innerHTML = `
    <div class="spec-view">
      <div class="spec-display"></div>
    </div>
    <button data-action-click="toggle_spec_expand">Show More</button>
    <div class="spec-edit hidden">
      <input type="checkbox">
      <textarea>${spec}</textarea>
      <button data-action-click="cancel_spec_edit">Cancel</button>
      <button data-action-click="save_spec">Save</button>
    </div>
  `;
  document.body.appendChild(el);
  return el;
};

describe('registerTaskSpecActions', () => {
  let registry: Map<string, ActionHandler>;
  let ctx: PipelineDetailCtx;
  let deps: TaskSpecActionsDeps;
  let updateDetails: ReturnType<typeof vi.fn>;

  const getAction = (name: string): ActionHandler => {
    const handler = registry.get(name);
    if (!handler) throw new Error(`action "${name}" was not registered`);
    return handler;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    registry = new Map<string, ActionHandler>();
    updateDetails = vi.fn().mockResolvedValue({ id: 't1' });
    vi.stubGlobal('alert', vi.fn());

    const state = createPipelineDetailState();

    ctx = {
      context: {
        actionRegistry: {
          register: (name: string, handler: ActionHandler) => registry.set(name, handler),
        },
        taskClient: { updateDetails },
      },
      pipelineId: 'p1',
      state,
      refresh: {
        header: vi.fn(),
        backlog: vi.fn(),
        selectedTask: vi.fn(),
        executionEngine: vi.fn(),
        sessionList: vi.fn(),
        specProposals: vi.fn(),
      },
    } as unknown as PipelineDetailCtx;

    deps = {
      focusSpecAfterTitleSave: vi.fn(),
      markSpecEditPending: vi.fn(),
      markScheduleFocusPending: vi.fn(),
      applyPendingScheduleFocus: vi.fn(),
    };

    registerTaskSpecActions(ctx, deps);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registers all task/title/spec actions', () => {
    expect([...registry.keys()].sort()).toEqual(
      [
        'cancel_spec_edit',
        'cancel_title_edit',
        'edit_spec',
        'edit_title',
        'save_spec',
        'save_title',
        'toggle_spec_expand',
      ].sort(),
    );
  });

  describe('edit_title', () => {
    it('reveals the edit form and focuses/selects the input', () => {
      const selectSpy = vi.spyOn(HTMLInputElement.prototype, 'select');
      const container = makeTitleContainer('t1', 'Existing Title');

      getAction('edit_title')(noEvent, container.querySelector('.title-view') as HTMLElement);

      expect(container.querySelector('.title-view')!.classList.contains('hidden')).toBe(true);
      expect(container.querySelector('.title-edit')!.classList.contains('hidden')).toBe(false);
      const input = container.querySelector('input') as HTMLInputElement;
      expect(document.activeElement).toBe(input);
      expect(selectSpy).toHaveBeenCalled();
    });

    it('is a no-op without a .title-container ancestor', () => {
      const el = document.createElement('button');
      document.body.appendChild(el);

      expect(() => getAction('edit_title')(noEvent, el)).not.toThrow();
    });
  });

  describe('cancel_title_edit', () => {
    it('restores the title view', () => {
      const container = makeTitleContainer('t1', 'Existing Title');
      container.querySelector('.title-view')!.classList.add('hidden');
      container.querySelector('.title-edit')!.classList.remove('hidden');

      getAction('cancel_title_edit')(noEvent, container);

      expect(container.querySelector('.title-view')!.classList.contains('hidden')).toBe(false);
      expect(container.querySelector('.title-edit')!.classList.contains('hidden')).toBe(true);
    });

    it('is a no-op without a .title-container ancestor', () => {
      const el = document.createElement('button');
      expect(() => getAction('cancel_title_edit')(noEvent, el)).not.toThrow();
    });
  });

  describe('save_title', () => {
    it('is a no-op (no updateDetails) and swallows the event when the title is unchanged', async () => {
      const container = makeTitleContainer('t1', 'Existing Title');
      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

      await getAction('save_title')(event as any, container);

      expect(updateDetails).not.toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(deps.focusSpecAfterTitleSave).not.toHaveBeenCalled();
    });

    it('still saves when the title actually changes and hands focus to the spec', async () => {
      const container = makeTitleContainer('t1', 'Existing Title');
      const input = container.querySelector('input') as HTMLInputElement;
      input.value = 'Brand New Title';
      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

      await getAction('save_title')(event as any, container);

      expect(updateDetails).toHaveBeenCalledTimes(1);
      expect(updateDetails).toHaveBeenCalledWith('t1', 1, { title: 'Brand New Title' });
      expect(deps.focusSpecAfterTitleSave).toHaveBeenCalledWith(container);
    });

    it('is a no-op when the input is empty', async () => {
      const container = makeTitleContainer('t1', 'Existing Title');
      (container.querySelector('input') as HTMLInputElement).value = '   ';

      await getAction('save_title')(noEvent, container);

      expect(updateDetails).not.toHaveBeenCalled();
      expect(deps.focusSpecAfterTitleSave).not.toHaveBeenCalled();
    });

    it('is a no-op without a .title-container ancestor', async () => {
      const el = document.createElement('button');

      await getAction('save_title')(noEvent, el);

      expect(updateDetails).not.toHaveBeenCalled();
    });

    it('alerts when the update rejects', async () => {
      updateDetails.mockRejectedValueOnce(new Error('boom'));
      const container = makeTitleContainer('t1', 'Existing Title');
      (container.querySelector('input') as HTMLInputElement).value = 'New Title';

      await getAction('save_title')(noEvent, container);

      expect(alert).toHaveBeenCalledWith('Failed to save title');
      expect(deps.focusSpecAfterTitleSave).not.toHaveBeenCalled();
    });
  });

  describe('edit_spec', () => {
    it('reveals the edit form, hides the expand toggle and focuses the textarea', () => {
      const container = makeSpecContainer('t1');

      getAction('edit_spec')(noEvent, container.querySelector('.spec-view') as HTMLElement);

      expect(container.querySelector('.spec-view')!.classList.contains('hidden')).toBe(true);
      expect(
        container.querySelector('[data-action-click="toggle_spec_expand"]')!.classList.contains('hidden'),
      ).toBe(true);
      expect(container.querySelector('.spec-edit')!.classList.contains('hidden')).toBe(false);
      expect(document.activeElement).toBe(container.querySelector('textarea'));
    });

    it('is a no-op without a .spec-container ancestor', () => {
      const el = document.createElement('button');
      expect(() => getAction('edit_spec')(noEvent, el)).not.toThrow();
    });
  });

  describe('cancel_spec_edit', () => {
    it('restores the spec view, the expand toggle and clears the pending marker', () => {
      const container = makeSpecContainer('t1');
      container.querySelector('.spec-view')!.classList.add('hidden');
      container.querySelector('.spec-edit')!.classList.remove('hidden');
      ctx.state.pendingSpecEditTaskId = 't1';

      getAction('cancel_spec_edit')(noEvent, container);

      expect(container.querySelector('.spec-view')!.classList.contains('hidden')).toBe(false);
      expect(
        container.querySelector('[data-action-click="toggle_spec_expand"]')!.classList.contains('hidden'),
      ).toBe(false);
      expect(container.querySelector('.spec-edit')!.classList.contains('hidden')).toBe(true);
      expect(deps.markSpecEditPending).toHaveBeenCalledWith(null);
    });

    it('leaves the pending marker alone for a different task id', () => {
      const container = makeSpecContainer('t1');
      ctx.state.pendingSpecEditTaskId = 'other';

      getAction('cancel_spec_edit')(noEvent, container);

      expect(deps.markSpecEditPending).not.toHaveBeenCalled();
    });

    it('is a no-op without a .spec-container ancestor', () => {
      const el = document.createElement('button');
      expect(() => getAction('cancel_spec_edit')(noEvent, el)).not.toThrow();
    });
  });

  describe('save_spec', () => {
    it('saves the spec, arms and immediately applies the schedule focus hand-off', async () => {
      const container = makeSpecContainer('t1');
      (container.querySelector('textarea') as HTMLTextAreaElement).value = 'new spec';
      (container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked = true;

      await getAction('save_spec')(noEvent, container);

      expect(updateDetails).toHaveBeenCalledWith('t1', 1, {
        spec: 'new spec',
        want_design_doc: true,
      });
      expect(deps.markScheduleFocusPending).toHaveBeenCalledWith('t1');
      expect(deps.applyPendingScheduleFocus).toHaveBeenCalledWith(null, 't1');
    });

    it('clears the pending spec-edit marker when the saved task matches', async () => {
      const container = makeSpecContainer('t1');
      ctx.state.pendingSpecEditTaskId = 't1';

      await getAction('save_spec')(noEvent, container);

      expect(deps.markSpecEditPending).toHaveBeenCalledWith(null);
    });

    it('keeps the spec expanded after a successful save', async () => {
      const container = makeSpecContainer('t1');
      ctx.state.collapsedSpecs.add('t1');

      await getAction('save_spec')(noEvent, container);

      expect(ctx.state.collapsedSpecs.has('t1')).toBe(false);
    });

    it('re-arms the focus marker when the card is inside #selected-task-view', async () => {
      const selectedView = document.createElement('div');
      selectedView.id = 'selected-task-view';
      const taskEl = document.createElement('div');
      taskEl.setAttribute('data-view-id', 't1');
      selectedView.appendChild(taskEl);
      document.body.appendChild(selectedView);
      const container = document.createElement('div');
      container.className = 'spec-container';
      container.setAttribute('data-task-id', 't1');
      container.setAttribute('data-version', '1');
      container.innerHTML = `
        <textarea>new spec</textarea>
        <input type="checkbox">
        <button data-action-click="save_spec">Save</button>
      `;
      taskEl.appendChild(container);

      await getAction('save_spec')(noEvent, container);

      expect(deps.applyPendingScheduleFocus).toHaveBeenCalledWith(taskEl, 't1');
      expect(deps.markScheduleFocusPending).toHaveBeenNthCalledWith(1, 't1');
      expect(deps.markScheduleFocusPending).toHaveBeenNthCalledWith(2, 't1');
      expect((deps.markScheduleFocusPending as any).mock.calls).toHaveLength(2);
    });

    it('clears the focus marker (and alerts) when the save fails', async () => {
      updateDetails.mockRejectedValueOnce(new Error('boom'));
      const container = makeSpecContainer('t1');

      await getAction('save_spec')(noEvent, container);

      expect(deps.markScheduleFocusPending).toHaveBeenCalledWith('t1');
      expect(deps.markScheduleFocusPending).toHaveBeenLastCalledWith(null);
      expect(deps.applyPendingScheduleFocus).not.toHaveBeenCalled();
      expect(alert).toHaveBeenCalledWith('Failed to save specification');
    });

    it('only ever passes its own task id to the focus marker', async () => {
      const container = makeSpecContainer('t1');

      await getAction('save_spec')(noEvent, container);

      const markerCalls = (deps.markScheduleFocusPending as any).mock.calls;
      expect(markerCalls.length).toBeGreaterThan(0);
      expect(markerCalls.every((c: any[]) => c[0] === 't1')).toBe(true);
      expect((deps.applyPendingScheduleFocus as any).mock.calls.every((c: any[]) => c[1] === 't1')).toBe(true);
    });

    it('is a no-op without a .spec-container ancestor', async () => {
      const el = document.createElement('button');

      await getAction('save_spec')(noEvent, el);

      expect(updateDetails).not.toHaveBeenCalled();
      expect(deps.markScheduleFocusPending).not.toHaveBeenCalled();
    });
  });

  describe('toggle_spec_expand', () => {
    it('flips the expanded class, label and collapsedSpecs set', () => {
      const container = makeSpecContainer('t1');
      const toggle = container.querySelector('[data-action-click="toggle_spec_expand"]') as HTMLElement;
      const display = container.querySelector('.spec-display') as HTMLElement;

      getAction('toggle_spec_expand')(noEvent, toggle);

      expect(display.classList.contains('expanded')).toBe(true);
      expect(toggle.textContent).toBe('Show Less');
      expect(ctx.state.collapsedSpecs.has('t1')).toBe(false);

      getAction('toggle_spec_expand')(noEvent, toggle);

      expect(display.classList.contains('expanded')).toBe(false);
      expect(toggle.textContent).toBe('Show More');
      expect(ctx.state.collapsedSpecs.has('t1')).toBe(true);
    });

    it('is a no-op without a .spec-container ancestor', () => {
      const el = document.createElement('button');
      expect(() => getAction('toggle_spec_expand')(noEvent, el)).not.toThrow();
    });
  });
});
