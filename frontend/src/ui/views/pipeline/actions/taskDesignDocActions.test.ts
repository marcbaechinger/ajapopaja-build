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
import { registerTaskDesignDocActions } from './taskDesignDocActions.ts';
import { createPipelineDetailState } from '../PipelineDetailCtx.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';
import type { ActionHandler } from '../../../../core/ActionRegistry.ts';
import { ConfirmationDialog } from '../../../components/dialogs/ConfirmationDialog.ts';
import { DesignDocDialog } from '../../../components/dialogs/DesignDocDialog.ts';
import { DesignDocDiffDialog } from '../../../components/dialogs/DesignDocDiffDialog.ts';
import { TaskItem } from '../../../components/pipeline/TaskItem.ts';
import EasyMDE from 'easymde';

vi.mock('../../../components/dialogs/ConfirmationDialog.ts', () => ({
  ConfirmationDialog: vi.fn(function ConfirmationDialog() {
    return { show: vi.fn().mockResolvedValue(true) };
  }),
}));

vi.mock('../../../components/dialogs/DesignDocDialog.ts', () => ({
  DesignDocDialog: vi.fn(function DesignDocDialog() {
    return { show: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('../../../components/dialogs/DesignDocDiffDialog.ts', () => ({
  DesignDocDiffDialog: vi.fn(function DesignDocDiffDialog() {
    return { show: vi.fn().mockResolvedValue(undefined) };
  }),
}));

// EasyMDE needs a real DOM + CodeMirror; the actions only use a tiny slice of
// its API (`value`, `toTextArea`, `codemirror.focus` and `onFullScreen`).
vi.mock('easymde', () => ({
  default: vi.fn(function EasyMDE(this: any, options: any) {
    return {
      options,
      codemirror: { focus: vi.fn() },
      value: vi.fn(() => ''),
      toTextArea: vi.fn(),
    };
  }),
}));

/** The handlers never read the event; a placeholder keeps the signature. */
const noEvent = null as unknown as Event;

const editorInstances = (): any[] =>
  (EasyMDE as any).mock.results.map((result: any) => result.value);

const lastEditor = (): any => {
  const instances = editorInstances();
  return instances[instances.length - 1];
};

/**
 * Builds the `.design-doc-container` markup the handlers expect. When
 * `editing` is true the container starts in edit mode (view/actions hidden,
 * editor visible) so the cancel path can be asserted.
 */
function buildContainer(opts: { taskId?: string; version?: string; editing?: boolean } = {}): {
  container: HTMLElement;
  button: HTMLButtonElement;
} {
  const container = document.createElement('div');
  container.className = 'design-doc-container';
  if (opts.taskId) container.setAttribute('data-task-id', opts.taskId);
  if (opts.version) container.setAttribute('data-version', opts.version);

  const view = document.createElement('div');
  view.className = 'design-doc-view' + (opts.editing ? ' hidden' : '');

  const actions = document.createElement('div');
  actions.className = 'design-doc-actions' + (opts.editing ? ' hidden' : '');

  const edit = document.createElement('div');
  edit.className = 'design-doc-edit' + (opts.editing ? '' : ' hidden');
  const textarea = document.createElement('textarea');
  edit.appendChild(textarea);

  const editToggle = document.createElement('button');
  editToggle.setAttribute('data-action-click', 'toggle_edit_design_doc_expand');
  if (opts.editing) editToggle.classList.add('hidden');
  editToggle.textContent = opts.editing ? 'Show Less' : 'Show More';

  const display = document.createElement('div');
  display.className = 'design-doc-display';

  const button = document.createElement('button');
  button.textContent = 'Design Doc';

  container.append(view, actions, edit, editToggle, display, button);
  document.body.appendChild(container);
  return { container, button };
}

describe('registerTaskDesignDocActions', () => {
  let registry: Map<string, ActionHandler>;
  let ctx: PipelineDetailCtx;
  let updateDetails: ReturnType<typeof vi.fn>;
  let acceptDesign: ReturnType<typeof vi.fn>;
  let rejectDesign: ReturnType<typeof vi.fn>;
  let clipboardWrite: ReturnType<typeof vi.fn>;

  const getAction = (name: string): ActionHandler => {
    const handler = registry.get(name);
    if (!handler) throw new Error(`action "${name}" was not registered`);
    return handler;
  };

  const task = (id: string, designDoc?: string) =>
    ({ id, title: id, design_doc: designDoc, version: 1 } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    registry = new Map<string, ActionHandler>();
    updateDetails = vi.fn().mockResolvedValue({ id: 't1' });
    acceptDesign = vi.fn().mockResolvedValue({});
    rejectDesign = vi.fn().mockResolvedValue({});
    clipboardWrite = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: clipboardWrite } });
    vi.stubGlobal('alert', vi.fn());

    const state = createPipelineDetailState();

    ctx = {
      context: {
        actionRegistry: {
          register: (name: string, handler: ActionHandler) => registry.set(name, handler),
        },
        taskClient: { updateDetails, acceptDesign, rejectDesign },
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

    registerTaskDesignDocActions(ctx, {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registers all eleven design-document actions', () => {
    expect([...registry.keys()].sort()).toEqual(
      [
        'accept_design',
        'cancel_design_doc',
        'copy_design_doc',
        'edit_design_doc',
        'reject_design',
        'save_design_doc',
        'toggle_design_doc_expand',
        'toggle_design_doc_toc',
        'toggle_edit_design_doc_expand',
        'view_design_doc',
        'view_design_doc_history',
      ].sort(),
    );
  });

  describe('view_design_doc', () => {
    it('opens DesignDocDialog when the task has a non-empty design doc', async () => {
      ctx.state.allLoadedTasks = [task('t1', '# Design')];
      const { button } = buildContainer({ taskId: 't1' });

      await getAction('view_design_doc')(noEvent, button);

      expect(DesignDocDialog).toHaveBeenCalledTimes(1);
      expect(DesignDocDialog).toHaveBeenCalledWith('Design Document', '# Design');
      expect((DesignDocDialog as any).mock.results[0].value.show).toHaveBeenCalled();
    });

    it('is a no-op when the task has no design doc', async () => {
      ctx.state.allLoadedTasks = [task('t1')];
      const { button } = buildContainer({ taskId: 't1' });

      await getAction('view_design_doc')(noEvent, button);

      expect(DesignDocDialog).not.toHaveBeenCalled();
    });

    it('is a no-op when the task is not loaded', async () => {
      ctx.state.allLoadedTasks = [];
      const { button } = buildContainer({ taskId: 'missing' });

      await getAction('view_design_doc')(noEvent, button);

      expect(DesignDocDialog).not.toHaveBeenCalled();
    });

    it('is a no-op outside a design-doc container', async () => {
      ctx.state.allLoadedTasks = [task('t1', '# Design')];
      const button = document.createElement('button');

      await getAction('view_design_doc')(noEvent, button);

      expect(DesignDocDialog).not.toHaveBeenCalled();
    });
  });

  describe('view_design_doc_history', () => {
    it('opens DesignDocDiffDialog with the context and task', async () => {
      const loaded = task('t1', '# Design');
      ctx.state.allLoadedTasks = [loaded];
      const { button } = buildContainer({ taskId: 't1' });

      await getAction('view_design_doc_history')(noEvent, button);

      expect(DesignDocDiffDialog).toHaveBeenCalledTimes(1);
      expect(DesignDocDiffDialog).toHaveBeenCalledWith(ctx.context, loaded);
      expect((DesignDocDiffDialog as any).mock.results[0].value.show).toHaveBeenCalled();
    });

    it('is a no-op when the task is not loaded', async () => {
      ctx.state.allLoadedTasks = [];
      const { button } = buildContainer({ taskId: 'missing' });

      await getAction('view_design_doc_history')(noEvent, button);

      expect(DesignDocDiffDialog).not.toHaveBeenCalled();
    });
  });

  describe('edit_design_doc', () => {
    it('hides the view/actions, shows the editor and stores the EasyMDE instance', async () => {
      const { container, button } = buildContainer({ taskId: 't1' });

      await getAction('edit_design_doc')(noEvent, button);

      expect(container.querySelector('.design-doc-view')!.classList.contains('hidden')).toBe(true);
      expect(container.querySelector('.design-doc-actions')!.classList.contains('hidden')).toBe(true);
      expect(container.querySelector('.design-doc-edit')!.classList.contains('hidden')).toBe(false);

      expect(EasyMDE).toHaveBeenCalledTimes(1);
      const editor = lastEditor();
      expect(ctx.state.activeEditors.get('t1')).toBe(editor);
      expect(editor.codemirror.focus).toHaveBeenCalled();
    });

    it('adds and removes the full-screen backdrop and z-index class', async () => {
      const { container, button } = buildContainer({ taskId: 't1' });

      await getAction('edit_design_doc')(noEvent, button);
      const onFullScreen = lastEditor().options.onFullScreen;

      onFullScreen(true);
      expect(container.classList.contains('z-[100]')).toBe(true);
      expect(document.getElementById('editor-backdrop')).not.toBeNull();

      onFullScreen(false);
      expect(container.classList.contains('z-[100]')).toBe(false);
      expect(document.getElementById('editor-backdrop')).toBeNull();
    });

    it('is a no-op without a task id or textarea', async () => {
      const container = document.createElement('div');
      container.className = 'design-doc-container';
      container.setAttribute('data-task-id', 't2');
      const button = document.createElement('button');
      container.appendChild(button);
      document.body.appendChild(container);

      await getAction('edit_design_doc')(noEvent, button);

      expect(EasyMDE).not.toHaveBeenCalled();
    });
  });

  describe('toggle_edit_design_doc_expand', () => {
    it('flips the CodeMirror expanded class and the label', async () => {
      const { container, button } = buildContainer({ taskId: 't1' });
      const cm = document.createElement('div');
      cm.className = 'CodeMirror';
      container.appendChild(cm);

      await getAction('toggle_edit_design_doc_expand')(noEvent, button);
      expect(cm.classList.contains('expanded-editor')).toBe(true);
      expect(button.textContent).toBe('Show Less');

      await getAction('toggle_edit_design_doc_expand')(noEvent, button);
      expect(cm.classList.contains('expanded-editor')).toBe(false);
      expect(button.textContent).toBe('Show More');
    });

    it('is a no-op without a .CodeMirror element', async () => {
      const { button } = buildContainer({ taskId: 't1' });
      button.textContent = 'Original';

      await getAction('toggle_edit_design_doc_expand')(noEvent, button);

      expect(button.textContent).toBe('Original');
    });
  });

  describe('toggle_design_doc_expand', () => {
    it('flips the display expanded class and the label', async () => {
      const { container, button } = buildContainer({ taskId: 't1' });
      const display = container.querySelector('.design-doc-display')!;

      await getAction('toggle_design_doc_expand')(noEvent, button);
      expect(display.classList.contains('expanded')).toBe(true);
      expect(button.textContent).toBe('Show Less');

      await getAction('toggle_design_doc_expand')(noEvent, button);
      expect(display.classList.contains('expanded')).toBe(false);
      expect(button.textContent).toBe('Show More');
    });
  });

  describe('toggle_design_doc_toc', () => {
    afterEach(() => {
      TaskItem.closeDesignDocToc();
    });

    it('opens the table of contents for the task design doc', async () => {
      ctx.state.allLoadedTasks = [task('t1', '# Alpha\n## Beta')];
      const { button } = buildContainer({ taskId: 't1' });

      await getAction('toggle_design_doc_toc')(noEvent, button);

      const overlay = document.getElementById('design-doc-toc-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay!.textContent).toContain('Alpha');
      expect(overlay!.textContent).toContain('Beta');
    });

    it('opens an empty table of contents when the task has no design doc', async () => {
      ctx.state.allLoadedTasks = [task('t1')];
      const { button } = buildContainer({ taskId: 't1' });

      await getAction('toggle_design_doc_toc')(noEvent, button);

      const overlay = document.getElementById('design-doc-toc-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay!.textContent).toContain('No headings found.');
    });
  });

  describe('copy_design_doc', () => {
    it('writes the doc to the clipboard and restores the button', async () => {
      vi.useFakeTimers();
      ctx.state.allLoadedTasks = [task('t1', '# Design')];
      const { button } = buildContainer({ taskId: 't1' });
      button.innerHTML = 'ORIGINAL';

      await getAction('copy_design_doc')(noEvent, button);

      expect(clipboardWrite).toHaveBeenCalledWith('# Design');
      expect(button.innerHTML).toContain('Copied!');

      vi.advanceTimersByTime(2000);
      expect(button.innerHTML).toBe('ORIGINAL');
    });

    it('logs and leaves the button untouched when the write fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      clipboardWrite.mockRejectedValueOnce(new Error('denied'));
      ctx.state.allLoadedTasks = [task('t1', '# Design')];
      const { button } = buildContainer({ taskId: 't1' });
      button.innerHTML = 'ORIGINAL';

      await getAction('copy_design_doc')(noEvent, button);

      expect(errorSpy).toHaveBeenCalledWith('Failed to copy text: ', expect.any(Error));
      expect(button.innerHTML).toBe('ORIGINAL');
    });

    it('is a no-op when the task has no design doc', async () => {
      ctx.state.allLoadedTasks = [task('t1')];
      const { button } = buildContainer({ taskId: 't1' });

      await getAction('copy_design_doc')(noEvent, button);

      expect(clipboardWrite).not.toHaveBeenCalled();
    });
  });

  describe('cancel_design_doc', () => {
    it('destroys the editor, deletes it from the map and restores the view', async () => {
      const { container, button } = buildContainer({ taskId: 't1', editing: true });
      const editor = { toTextArea: vi.fn() };
      ctx.state.activeEditors.set('t1', editor as any);

      await getAction('cancel_design_doc')(noEvent, button);

      expect(editor.toTextArea).toHaveBeenCalledTimes(1);
      expect(ctx.state.activeEditors.has('t1')).toBe(false);
      expect(container.querySelector('.design-doc-view')!.classList.contains('hidden')).toBe(false);
      expect(container.querySelector('.design-doc-actions')!.classList.contains('hidden')).toBe(false);
      expect(container.querySelector('.design-doc-edit')!.classList.contains('hidden')).toBe(true);

      const toggle = container.querySelector('[data-action-click="toggle_edit_design_doc_expand"]')!;
      expect(toggle.classList.contains('hidden')).toBe(false);
      expect(toggle.textContent).toBe('Show More');
    });
  });

  describe('save_design_doc', () => {
    it('is a no-op without an editor for the task', async () => {
      const { button } = buildContainer({ taskId: 't1', version: '2' });

      await getAction('save_design_doc')(noEvent, button);

      expect(updateDetails).not.toHaveBeenCalled();
    });

    it('updates with the trimmed value and destroys the editor', async () => {
      const { button } = buildContainer({ taskId: 't1', version: '2' });
      const editor = {
        value: vi.fn(() => '  # Hello  '),
        toTextArea: vi.fn(),
      };
      ctx.state.activeEditors.set('t1', editor as any);

      await getAction('save_design_doc')(noEvent, button);

      expect(updateDetails).toHaveBeenCalledWith('t1', 2, { design_doc: '# Hello' });
      expect(editor.toTextArea).toHaveBeenCalledTimes(1);
      expect(ctx.state.activeEditors.has('t1')).toBe(false);
    });

    it('keeps the editor and alerts when the update fails', async () => {
      updateDetails.mockRejectedValueOnce(new Error('boom'));
      const { button } = buildContainer({ taskId: 't1', version: '2' });
      const editor = {
        value: vi.fn(() => '# Hello'),
        toTextArea: vi.fn(),
      };
      ctx.state.activeEditors.set('t1', editor as any);

      await getAction('save_design_doc')(noEvent, button);

      expect(alert).toHaveBeenCalledWith('Failed to save design doc. Please try again.');
      expect(editor.toTextArea).not.toHaveBeenCalled();
      expect(ctx.state.activeEditors.has('t1')).toBe(true);
    });
  });

  describe('accept_design', () => {
    it('calls acceptDesign with the parsed version', async () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', 't1');
      const button = document.createElement('button');
      button.setAttribute('data-version', '3');
      wrapper.appendChild(button);

      await getAction('accept_design')(noEvent, button);

      expect(acceptDesign).toHaveBeenCalledWith('t1', 3);
    });

    it('defaults the version to 1 when data-version is missing', async () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', 't1');
      const button = document.createElement('button');
      wrapper.appendChild(button);

      await getAction('accept_design')(noEvent, button);

      expect(acceptDesign).toHaveBeenCalledWith('t1', 1);
    });

    it('is a no-op without a task id', async () => {
      const button = document.createElement('button');

      await getAction('accept_design')(noEvent, button);

      expect(acceptDesign).not.toHaveBeenCalled();
    });

    it('alerts when the request fails', async () => {
      acceptDesign.mockRejectedValueOnce(new Error('boom'));
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', 't1');
      const button = document.createElement('button');
      wrapper.appendChild(button);

      await getAction('accept_design')(noEvent, button);

      expect(alert).toHaveBeenCalledWith('Failed to accept design');
    });
  });

  describe('reject_design', () => {
    it('confirms then calls rejectDesign with the parsed version', async () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', 't1');
      const button = document.createElement('button');
      button.setAttribute('data-version', '4');
      wrapper.appendChild(button);

      await getAction('reject_design')(noEvent, button);

      expect(ConfirmationDialog).toHaveBeenCalledWith(
        'Reject Design',
        'Are you sure you want to reject this design? This task will be marked as DISCARDED.',
        'Reject',
      );
      expect(rejectDesign).toHaveBeenCalledWith('t1', 4);
    });

    it('does nothing when the confirmation is cancelled', async () => {
      (ConfirmationDialog as any).mockImplementationOnce(function CancelledDialog() {
        return { show: vi.fn().mockResolvedValue(false) };
      });
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', 't1');
      const button = document.createElement('button');
      wrapper.appendChild(button);

      await getAction('reject_design')(noEvent, button);

      expect(rejectDesign).not.toHaveBeenCalled();
    });

    it('alerts when the request fails', async () => {
      rejectDesign.mockRejectedValueOnce(new Error('boom'));
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', 't1');
      const button = document.createElement('button');
      wrapper.appendChild(button);

      await getAction('reject_design')(noEvent, button);

      expect(alert).toHaveBeenCalledWith('Failed to reject design');
    });
  });
});
