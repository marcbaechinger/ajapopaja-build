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
import { PipelineEditDialog, type PipelineEditDialogProps } from './PipelineEditDialog.ts';
import { Pipeline } from '../../../core/domain.ts';

describe('PipelineEditDialog', () => {
  let mockProps: PipelineEditDialogProps;

  beforeEach(() => {
    document.body.innerHTML = '';
    
    // Mock showModal and close since JSDOM doesn't implement them
    HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) {
      this.open = false;
    });

    mockProps = {
      mode: 'edit',
      pipeline: new Pipeline({
        _id: 'pipeline-1',
        name: 'Test Pipeline',
        status: 'active',
        version: 1,
        workspace_path: '/tmp/test',
      }),
      pipelineId: 'pipeline-1',
      context: {
        pipelineClient: {
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({}),
          getModelOptions: vi.fn().mockResolvedValue({ ollama: [], coderbot: [] }),
        },
      } as any,
    };

    vi.stubGlobal('alert', vi.fn());
  });

  const mkCreateProps = (): PipelineEditDialogProps => ({
    mode: 'create',
    context: {
      pipelineClient: {
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
        getModelOptions: vi.fn().mockResolvedValue({ ollama: [], coderbot: [] }),
      },
    } as any,
  });

  const switchToTab = (tab: 'local' | 'remote') => {
    const btn = document.querySelector(`[data-tab="${tab}"]`) as HTMLButtonElement;
    btn.click();
  };

  const switchToCmdTab = (tab: 'test' | 'lint' | 'build' | 'serve' | 'models') => {
    const btn = document.querySelector(`[data-cmd-tab="${tab}"]`) as HTMLButtonElement;
    btn.click();
  };

  it('should render the dialog with correct initial values', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    // show() adds it to the body
    const showPromise = dialog.show();

    const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
    const statusSelect = document.querySelector('select[name="pipeline_status"]') as HTMLSelectElement;
    const workspaceInput = document.querySelector('input[name="workspace_path"]') as HTMLInputElement;

    expect(nameInput.value).toBe('Test Pipeline');
    expect(statusSelect.value).toBe('active');
    expect(workspaceInput.value).toBe('/tmp/test');

    // Cleanup
    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should render workspace_path as readonly', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const workspaceInput = document.querySelector('input[name="workspace_path"]') as HTMLInputElement;
    expect(workspaceInput.readOnly).toBe(true);

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should select the local tab and lock remote fields for a local pipeline', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    // Local tab is active by default for a local pipeline.
    const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
    expect(nameInput.readOnly).toBe(false);

    // Switching to the remote tab shows read-only remote fields.
    switchToTab('remote');
    const repoUriInput = document.querySelector('input[name="repo_uri"]') as HTMLInputElement;
    const usernameInput = document.querySelector('input[name="repo_username"]') as HTMLInputElement;
    const tokenInput = document.querySelector('input[name="repo_token"]') as HTMLInputElement;
    expect(repoUriInput.readOnly).toBe(true);
    expect(usernameInput.readOnly).toBe(true);
    expect(tokenInput.readOnly).toBe(true);

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should select the remote tab and lock local fields for a remote pipeline', async () => {
    mockProps.pipeline!.repo_uri = 'https://host/org/my-app.git';
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    // Remote tab is active by default for a remote pipeline.
    const repoUriInput = document.querySelector('input[name="repo_uri"]') as HTMLInputElement;
    expect(repoUriInput.readOnly).toBe(false);

    // Switching to the local tab shows read-only local fields.
    switchToTab('local');
    const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
    const statusSelect = document.querySelector('select[name="pipeline_status"]') as HTMLSelectElement;
    const docRootInput = document.querySelector('input[name="doc_root"]') as HTMLInputElement;
    expect(nameInput.readOnly).toBe(true);
    expect(statusSelect.disabled).toBe(true);
    expect(docRootInput.readOnly).toBe(true);

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should pass repo_username and repo_token on save for a remote pipeline', async () => {
    mockProps.pipeline!.repo_uri = 'https://host/org/my-app.git';
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const usernameInput = document.querySelector('input[name="repo_username"]') as HTMLInputElement;
    const tokenInput = document.querySelector('input[name="repo_token"]') as HTMLInputElement;
    usernameInput.value = 'gituser';
    tokenInput.value = 'gittoken';

    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();

    await showPromise;

    expect(mockProps.context.pipelineClient.update).toHaveBeenCalledWith(
      'pipeline-1',
      1,
      expect.objectContaining({
        repo_username: 'gituser',
        repo_token: 'gittoken'
      })
    );
  });

  it('should not send repo_token when the token input is empty', async () => {
    mockProps.pipeline!.repo_uri = 'https://host/org/my-app.git';
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const usernameInput = document.querySelector('input[name="repo_username"]') as HTMLInputElement;
    usernameInput.value = 'gituser';
    // token input left empty

    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();

    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2]).toMatchObject({ repo_username: 'gituser' });
    expect(updateCall[2]).not.toHaveProperty('repo_token');
  });

  it('should never pre-fill the token input even when a token is stored', async () => {
    mockProps.pipeline!.repo_uri = 'https://host/org/my-app.git';
    mockProps.pipeline!.has_repo_token = true;
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const tokenInput = document.querySelector('input[name="repo_token"]') as HTMLInputElement;
    expect(tokenInput.value).toBe('');

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should show a token stored indicator when has_repo_token is true', async () => {
    mockProps.pipeline!.repo_uri = 'https://host/org/my-app.git';
    mockProps.pipeline!.has_repo_token = true;
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const indicator = document.querySelector('input[name="repo_token"]')?.parentElement?.querySelector('span');
    expect(indicator?.textContent).toContain('Token stored');

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should pre-fill the test commands textarea from stored argv lists', async () => {
    mockProps.pipeline!.test_commands = [
      ['sh', '-c', 'make test'],
      ['pytest', '-q'],
    ];
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('test');
    const textarea = document.querySelector('textarea[name="test_commands"]') as HTMLTextAreaElement;
    expect(textarea.value).toBe('make test\npytest -q');

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should send test_commands parsed from the textarea on save', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('test');
    const textarea = document.querySelector('textarea[name="test_commands"]') as HTMLTextAreaElement;
    textarea.value = 'make test\n\ncd backend && uv run pytest';

    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].test_commands).toEqual([
      ['sh', '-c', 'make test'],
      ['sh', '-c', 'cd backend && uv run pytest'],
    ]);
  });

  it('should send an empty test_commands array when the textarea is blank', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('test');
    // textarea left empty
    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].test_commands).toEqual([]);
  });

  it('should pre-fill the lint commands textarea from stored argv lists', async () => {
    mockProps.pipeline!.lint_commands = [
      ['sh', '-c', 'make lint'],
      ['ruff', 'check'],
    ];
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('lint');
    const textarea = document.querySelector('textarea[name="lint_commands"]') as HTMLTextAreaElement;
    expect(textarea.value).toBe('make lint\nruff check');

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should send lint_commands parsed from the textarea on save', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('lint');
    const textarea = document.querySelector('textarea[name="lint_commands"]') as HTMLTextAreaElement;
    textarea.value = 'make lint\n\ncd frontend && npm run lint';

    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].lint_commands).toEqual([
      ['sh', '-c', 'make lint'],
      ['sh', '-c', 'cd frontend && npm run lint'],
    ]);
  });

  it('should send an empty lint_commands array when the lint textarea is blank', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('lint');
    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].lint_commands).toEqual([]);
  });

  it('should preserve test_commands when saving from the lint tab', async () => {
    mockProps.pipeline!.test_commands = [['sh', '-c', 'make test']];
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    // From the lint tab the test textarea is not rendered; the stored value
    // must still be parsed from the pipeline and sent on save.
    switchToCmdTab('lint');
    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].test_commands).toEqual([['sh', '-c', 'make test']]);
  });

  it('should render a serve commands tab', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const serveTab = document.querySelector('[data-cmd-tab="serve"]') as HTMLButtonElement;
    expect(serveTab).not.toBeNull();
    expect(serveTab.textContent).toContain('Serve');

    switchToCmdTab('serve');
    const textarea = document.querySelector('textarea[name="serve_commands"]') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should pre-fill the serve commands textarea from stored argv lists', async () => {
    mockProps.pipeline!.serve_commands = [
      ['sh', '-c', 'make serve'],
      ['uvicorn', 'main:app', '--reload'],
    ];
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('serve');
    const textarea = document.querySelector('textarea[name="serve_commands"]') as HTMLTextAreaElement;
    expect(textarea.value).toBe('make serve\nuvicorn main:app --reload');

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should send serve_commands parsed from the textarea on save', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('serve');
    const textarea = document.querySelector('textarea[name="serve_commands"]') as HTMLTextAreaElement;
    textarea.value = 'make serve\n\ncd backend && uv run uvicorn api.main:app --reload';

    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].serve_commands).toEqual([
      ['sh', '-c', 'make serve'],
      ['sh', '-c', 'cd backend && uv run uvicorn api.main:app --reload'],
    ]);
  });

  it('should send an empty serve_commands array when the serve textarea is blank', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('serve');
    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].serve_commands).toEqual([]);
  });

  it('should preserve serve_commands when saving from the test tab', async () => {
    mockProps.pipeline!.serve_commands = [['sh', '-c', 'make serve']];
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('test');
    // The serve textarea is not rendered from the test tab; the stored value
    // must still be parsed from the pipeline and sent on save.
    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].serve_commands).toEqual([['sh', '-c', 'make serve']]);
  });

  it('should render a build commands tab', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const buildTab = document.querySelector('[data-cmd-tab="build"]') as HTMLButtonElement;
    expect(buildTab).not.toBeNull();
    expect(buildTab.textContent).toContain('Build');

    switchToCmdTab('build');
    const textarea = document.querySelector('textarea[name="build_commands"]') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should pre-fill the build commands textarea from stored argv lists', async () => {
    mockProps.pipeline!.build_commands = [
      ['sh', '-c', 'make build'],
      ['npm', 'run', 'build'],
    ];
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('build');
    const textarea = document.querySelector('textarea[name="build_commands"]') as HTMLTextAreaElement;
    expect(textarea.value).toBe('make build\nnpm run build');

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should send build_commands parsed from the textarea on save', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('build');
    const textarea = document.querySelector('textarea[name="build_commands"]') as HTMLTextAreaElement;
    textarea.value = 'make build\n\ncd frontend && npm run build';

    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].build_commands).toEqual([
      ['sh', '-c', 'make build'],
      ['sh', '-c', 'cd frontend && npm run build'],
    ]);
  });

  it('should send an empty build_commands array when the build textarea is blank', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('build');
    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].build_commands).toEqual([]);
  });

  it('should prefill and save the build_artifact declaration', async () => {
    mockProps.pipeline!.build_artifact = {
      path: 'app/build/outputs/apk/debug/app-debug.apk',
      label: 'Debug APK',
      media_type: 'application/vnd.android.package-archive',
    } as any;
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('build');
    const pathInput = document.querySelector('input[name="build_artifact_path"]') as HTMLInputElement;
    const labelInput = document.querySelector('input[name="build_artifact_label"]') as HTMLInputElement;
    const mediaTypeInput = document.querySelector('input[name="build_artifact_media_type"]') as HTMLInputElement;
    expect(pathInput.value).toBe('app/build/outputs/apk/debug/app-debug.apk');
    expect(labelInput.value).toBe('Debug APK');
    expect(mediaTypeInput.value).toBe('application/vnd.android.package-archive');

    pathInput.value = 'dist/app.zip';
    labelInput.value = 'Release bundle';
    mediaTypeInput.value = 'application/zip';

    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].build_artifact).toEqual({
      path: 'dist/app.zip',
      label: 'Release bundle',
      media_type: 'application/zip',
    });
  });

  it('should clear build_artifact when the artifact path is blank', async () => {
    mockProps.pipeline!.build_artifact = { path: 'dist/app.zip' } as any;
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('build');
    const pathInput = document.querySelector('input[name="build_artifact_path"]') as HTMLInputElement;
    pathInput.value = '';

    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].build_artifact).toBeNull();
  });

  it('should preserve build_artifact when saving from another command tab', async () => {
    mockProps.pipeline!.build_artifact = {
      path: 'dist/app.zip',
      label: 'Bundle',
    } as any;
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('test');
    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].build_artifact).toEqual({
      path: 'dist/app.zip',
      label: 'Bundle',
    });
  });

  it('should preserve build_commands when saving from the test tab', async () => {
    mockProps.pipeline!.build_commands = [['sh', '-c', 'make build']];
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('test');
    // The build textarea is not rendered from the test tab; the stored value
    // must still be parsed from the pipeline and sent on save.
    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await showPromise;

    const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
    expect(updateCall[2].build_commands).toEqual([['sh', '-c', 'make build']]);
  });

  it('should keep repository input when switching command tabs', async () => {
    mockProps.pipeline!.repo_uri = 'https://host/org/my-app.git';
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const repoUriInput = document.querySelector('input[name="repo_uri"]') as HTMLInputElement;
    repoUriInput.value = 'https://host/org/changed.git';

    // Selecting a command tab must only re-render the command area, so the
    // repository form (and the text just typed) stays untouched.
    switchToCmdTab('lint');

    const repoUriAfter = document.querySelector('input[name="repo_uri"]') as HTMLInputElement;
    expect(repoUriAfter.value).toBe('https://host/org/changed.git');

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should keep command input when switching repository tabs', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('test');
    const textarea = document.querySelector('textarea[name="test_commands"]') as HTMLTextAreaElement;
    textarea.value = 'make test';

    // Selecting a repository tab must only re-render the repository area.
    switchToTab('remote');

    const textareaAfter = document.querySelector('textarea[name="test_commands"]') as HTMLTextAreaElement;
    expect(textareaAfter.value).toBe('make test');

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should keep typed command text when switching between command tabs', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    switchToCmdTab('test');
    const textarea = document.querySelector('textarea[name="test_commands"]') as HTMLTextAreaElement;
    textarea.value = 'make test';

    switchToCmdTab('lint');
    switchToCmdTab('test');

    const textareaAfter = document.querySelector('textarea[name="test_commands"]') as HTMLTextAreaElement;
    expect(textareaAfter.value).toBe('make test');

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should keep the pipeline name when switching repository tabs in create mode', async () => {
    const props = mkCreateProps();
    const dialog = new PipelineEditDialog(props);
    const showPromise = dialog.show();

    const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
    nameInput.value = 'My New Pipeline';

    switchToTab('remote');

    const nameAfter = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
    expect(nameAfter.value).toBe('My New Pipeline');

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should call update and close on save', async () => {
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
    const statusSelect = document.querySelector('select[name="pipeline_status"]') as HTMLSelectElement;
    nameInput.value = 'Updated Name';
    statusSelect.value = 'paused';

    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();

    await showPromise;

    expect(mockProps.context.pipelineClient.update).toHaveBeenCalledWith(
      'pipeline-1',
      1,
      expect.objectContaining({
        name: 'Updated Name',
        status: 'paused'
      })
    );
  });

  it('should surface update validation errors inline (not alert)', async () => {
    (mockProps.context.pipelineClient.update as any).mockRejectedValue(new Error('Remote pipeline must not set workspace_path'));
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();

    // Wait for the async handleSave to fail
    await vi.waitFor(() => {
      const errorEl = document.querySelector('#pipeline-edit-error') as HTMLElement;
      expect(errorEl?.classList.contains('hidden')).toBe(false);
      expect(errorEl?.textContent).toContain('Remote pipeline must not set workspace_path');
    });

    expect(window.alert).not.toHaveBeenCalled();
    expect(saveBtn.disabled).toBe(false);
    expect(saveBtn.textContent).toBe('Save Changes');

    // Cleanup
    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  describe('create mode', () => {
    it('should render editable local and remote tabs', async () => {
      const props = mkCreateProps();
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();

      // Remote tab is active by default; fields are editable.
      const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      const repoUriInput = document.querySelector('input[name="repo_uri"]') as HTMLInputElement;
      const usernameInput = document.querySelector('input[name="repo_username"]') as HTMLInputElement;
      const tokenInput = document.querySelector('input[name="repo_token"]') as HTMLInputElement;
      expect(nameInput.readOnly).toBe(false);
      expect(repoUriInput.readOnly).toBe(false);
      expect(usernameInput.readOnly).toBe(false);
      expect(tokenInput.readOnly).toBe(false);
      // No status select or hidden pipeline ID in create mode.
      expect(document.querySelector('select[name="pipeline_status"]')).toBeNull();
      expect(document.body.textContent).not.toContain('ID:');

      // Switching to the local tab keeps local fields editable.
      switchToTab('local');
      const workspaceInput = document.querySelector('input[name="workspace_path"]') as HTMLInputElement;
      expect((document.querySelector('input[name="pipeline_name"]') as HTMLInputElement).readOnly).toBe(false);
      expect(workspaceInput.readOnly).toBe(false);

      document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
      await showPromise;
    });

    it('should order the remote tab before the local tab', async () => {
      const props = mkCreateProps();
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();

      const repoTabs = Array.from(document.querySelectorAll('[data-tab]')).map(
        (el) => (el as HTMLElement).dataset.tab
      );
      expect(repoTabs).toEqual(['remote', 'local']);

      document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
      await showPromise;
    });

    it('should call create with local payload (no repo fields) when saving the local tab', async () => {
      const props = mkCreateProps();
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();

      // Remote is the default tab; switch to local before entering local data.
      switchToTab('local');

      const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      const workspaceInput = document.querySelector('input[name="workspace_path"]') as HTMLInputElement;
      nameInput.value = 'New Local';
      workspaceInput.value = '/tmp/ws';

      const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
      saveBtn.click();
      await showPromise;

      const createCall = (props.context.pipelineClient.create as any).mock.calls[0];
      expect(createCall[0]).toMatchObject({
        name: 'New Local',
        doc_root: 'design',
        workspace_path: '/tmp/ws',
      });
      expect(createCall[0]).not.toHaveProperty('repo_uri');
      expect(createCall[0]).not.toHaveProperty('repo_username');
      expect(createCall[0]).not.toHaveProperty('repo_token');
    });

    it('should call create with remote payload (no workspace_path) when saving the remote tab', async () => {
      const props = mkCreateProps();
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();

      switchToTab('remote');

      const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      const repoUriInput = document.querySelector('input[name="repo_uri"]') as HTMLInputElement;
      const usernameInput = document.querySelector('input[name="repo_username"]') as HTMLInputElement;
      const tokenInput = document.querySelector('input[name="repo_token"]') as HTMLInputElement;
      nameInput.value = 'New Remote';
      repoUriInput.value = 'https://host/org/my-app.git';
      usernameInput.value = 'gituser';
      tokenInput.value = 'gittoken';

      const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
      saveBtn.click();
      await showPromise;

      const createCall = (props.context.pipelineClient.create as any).mock.calls[0];
      expect(createCall[0]).toMatchObject({
        name: 'New Remote',
        doc_root: 'design',
        repo_uri: 'https://host/org/my-app.git',
        repo_username: 'gituser',
        repo_token: 'gittoken',
      });
      expect(createCall[0]).not.toHaveProperty('workspace_path');
    });

    it('should send test_commands on create when provided', async () => {
      const props = mkCreateProps();
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();

      switchToCmdTab('test');
      const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      nameInput.value = 'New Pipe';
      const textarea = document.querySelector('textarea[name="test_commands"]') as HTMLTextAreaElement;
      textarea.value = 'make test';

      const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
      saveBtn.click();
      await showPromise;

      const createCall = (props.context.pipelineClient.create as any).mock.calls[0];
      expect(createCall[0].test_commands).toEqual([['sh', '-c', 'make test']]);
    });

    it('should send null test_commands on create when textarea is blank', async () => {
      const props = mkCreateProps();
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();

      const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      nameInput.value = 'New Pipe';

      const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
      saveBtn.click();
      await showPromise;

      const createCall = (props.context.pipelineClient.create as any).mock.calls[0];
      expect(createCall[0].test_commands).toBeNull();
    });

    it('should send serve_commands on create when provided', async () => {
      const props = mkCreateProps();
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();

      switchToCmdTab('serve');
      const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      nameInput.value = 'New Pipe';
      const textarea = document.querySelector('textarea[name="serve_commands"]') as HTMLTextAreaElement;
      textarea.value = 'uvicorn main:app --reload';

      const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
      saveBtn.click();
      await showPromise;

      const createCall = (props.context.pipelineClient.create as any).mock.calls[0];
      expect(createCall[0].serve_commands).toEqual([
        ['sh', '-c', 'uvicorn main:app --reload'],
      ]);
    });

    it('should send null serve_commands on create when the serve textarea is blank', async () => {
      const props = mkCreateProps();
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();

      switchToCmdTab('serve');
      const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      nameInput.value = 'New Pipe';

      const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
      saveBtn.click();
      await showPromise;

      const createCall = (props.context.pipelineClient.create as any).mock.calls[0];
      expect(createCall[0].serve_commands).toBeNull();
    });

    it('should send build_commands on create when provided', async () => {
      const props = mkCreateProps();
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();

      switchToCmdTab('build');
      const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      nameInput.value = 'New Pipe';
      const textarea = document.querySelector('textarea[name="build_commands"]') as HTMLTextAreaElement;
      textarea.value = 'cd frontend && npm run build';

      const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
      saveBtn.click();
      await showPromise;

      const createCall = (props.context.pipelineClient.create as any).mock.calls[0];
      expect(createCall[0].build_commands).toEqual([
        ['sh', '-c', 'cd frontend && npm run build'],
      ]);
    });

    it('should send null build_commands on create when the build textarea is blank', async () => {
      const props = mkCreateProps();
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();

      switchToCmdTab('build');
      const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      nameInput.value = 'New Pipe';

      const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
      saveBtn.click();
      await showPromise;

      const createCall = (props.context.pipelineClient.create as any).mock.calls[0];
      expect(createCall[0].build_commands).toBeNull();
    });

    it('should surface backend validation errors inline instead of alert', async () => {
      const props = mkCreateProps();
      (props.context.pipelineClient.create as any).mockRejectedValue(
        new Error('A local pipeline cannot have repo_username or repo_token')
      );
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();

      const nameInput = document.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      nameInput.value = 'New Pipe';

      const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
      saveBtn.click();

      await vi.waitFor(() => {
        const errorEl = document.querySelector('#pipeline-edit-error') as HTMLElement;
        expect(errorEl?.classList.contains('hidden')).toBe(false);
        expect(errorEl?.textContent).toContain('A local pipeline cannot have repo_username or repo_token');
      });

      expect(window.alert).not.toHaveBeenCalled();
      expect(saveBtn.disabled).toBe(false);
      expect(saveBtn.textContent).toBe('Create Pipeline');

      document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
      await showPromise;
    });
  });

  describe('dev server control', () => {
    const enableDevServer = (opts: { running?: boolean; port?: number } = {}) => {
      const client = mockProps.context.pipelineClient as any;
      client.getDevServerStatus = vi.fn().mockResolvedValue({
        running: opts.running ?? false,
        status: opts.running ? 'running' : 'not_started',
        pid: opts.running ? 42 : null,
        exit_code: null,
        run_id: opts.running ? 'run-1' : null,
        port: opts.port ?? 1224,
      });
      client.startDevServer = vi.fn().mockResolvedValue({
        status: 'started',
        running: true,
        pid: 42,
        port: opts.port ?? 1224,
      });
      client.stopDevServer = vi.fn().mockResolvedValue({
        status: 'stopped',
        running: false,
        pid: null,
        port: opts.port ?? 1224,
      });
      return client;
    };

    const clickCancel = () => {
      document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    };

    it('should render the dev server control only inside the Serve tab', async () => {
      mockProps.pipeline!.serve_commands = [['sh', '-c', 'make serve']];
      enableDevServer();
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();

      // The control only lives inside the Serve tab, not on the default tab.
      expect(document.querySelector('#pipeline-dev-toggle')).toBeNull();
      switchToCmdTab('serve');

      await vi.waitFor(() => {
        expect(document.querySelector('#pipeline-dev-toggle')).not.toBeNull();
      });

      clickCancel();
      await showPromise;
    });

    it('should render a start button when serve commands are stored', async () => {
      mockProps.pipeline!.serve_commands = [['sh', '-c', 'make serve']];
      enableDevServer();
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('serve');

      await vi.waitFor(() => {
        const btn = document.querySelector('#pipeline-dev-toggle') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn.textContent).toContain('Start Dev Server');
      });
      expect(document.querySelector('#dev-server-status')?.textContent).toContain('Stopped');

      clickCancel();
      await showPromise;
    });

    it('should not wipe typed repository input when the dev server status arrives', async () => {
      mockProps.pipeline!.serve_commands = [['sh', '-c', 'make serve']];
      const client = mockProps.context.pipelineClient as any;
      let resolveStatus: (value: any) => void = () => {};
      client.getDevServerStatus = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveStatus = resolve;
          })
      );

      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('serve');

      const workspaceInput = document.querySelector('input[name="workspace_path"]') as HTMLInputElement;
      workspaceInput.value = '/tmp/typed';

      // Resolve the pending status request; updating the dev-server control
      // must only re-render that control, not the whole form.
      resolveStatus({ running: false, status: 'not_started', port: 1224 });
      await vi.waitFor(() => {
        expect(document.querySelector('#pipeline-dev-toggle')).not.toBeNull();
      });
      expect((document.querySelector('input[name="workspace_path"]') as HTMLInputElement).value).toBe('/tmp/typed');

      clickCancel();
      await showPromise;
    });

    it('should not render the control when no serve commands are stored', async () => {
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('serve');

      expect(document.querySelector('#pipeline-dev-toggle')).toBeNull();

      clickCancel();
      await showPromise;
    });

    it('should not render the control in create mode', async () => {
      const props = mkCreateProps();
      props.pipeline = new Pipeline({
        _id: 'new-pipeline',
        serve_commands: [['sh', '-c', 'make serve']],
      });
      const dialog = new PipelineEditDialog(props);
      const showPromise = dialog.show();
      switchToCmdTab('serve');

      expect(document.querySelector('#pipeline-dev-toggle')).toBeNull();

      clickCancel();
      await showPromise;
    });

    it('should show a stop button when the dev server is already running', async () => {
      mockProps.pipeline!.serve_commands = [['sh', '-c', 'make serve']];
      const client = enableDevServer({ running: true });
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('serve');

      await vi.waitFor(() => {
        const btn = document.querySelector('#pipeline-dev-toggle') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn.textContent).toContain('Stop Dev Server');
      });
      expect(client.getDevServerStatus).toHaveBeenCalledWith('pipeline-1');
      expect(document.querySelector('#dev-server-status')?.textContent).toContain('Running on port 1224');

      clickCancel();
      await showPromise;
    });

    it('should start the dev server and switch to the stop button', async () => {
      mockProps.pipeline!.serve_commands = [['sh', '-c', 'make serve']];
      const client = enableDevServer();
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('serve');

      await vi.waitFor(() => {
        expect(document.querySelector('#pipeline-dev-toggle')).not.toBeNull();
      });
      (document.querySelector('#pipeline-dev-toggle') as HTMLButtonElement).click();

      await vi.waitFor(() => {
        expect(client.startDevServer).toHaveBeenCalledWith('pipeline-1');
        const btn = document.querySelector('#pipeline-dev-toggle') as HTMLButtonElement;
        expect(btn.textContent).toContain('Stop Dev Server');
      });
      expect(document.querySelector('#dev-server-status')?.textContent).toContain('Running on port 1224');

      clickCancel();
      await showPromise;
    });

    it('should stop a running dev server and switch to the start button', async () => {
      mockProps.pipeline!.serve_commands = [['sh', '-c', 'make serve']];
      const client = enableDevServer({ running: true });
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('serve');

      await vi.waitFor(() => {
        const btn = document.querySelector('#pipeline-dev-toggle') as HTMLButtonElement;
        expect(btn?.textContent).toContain('Stop Dev Server');
      });
      (document.querySelector('#pipeline-dev-toggle') as HTMLButtonElement).click();

      await vi.waitFor(() => {
        expect(client.stopDevServer).toHaveBeenCalledWith('pipeline-1');
        const btn = document.querySelector('#pipeline-dev-toggle') as HTMLButtonElement;
        expect(btn.textContent).toContain('Start Dev Server');
      });

      clickCancel();
      await showPromise;
    });

    it('should surface dev server start errors inline', async () => {
      mockProps.pipeline!.serve_commands = [['sh', '-c', 'make serve']];
      const client = enableDevServer();
      client.startDevServer.mockRejectedValue(new Error('No serve commands configured'));
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('serve');

      await vi.waitFor(() => {
        expect(document.querySelector('#pipeline-dev-toggle')).not.toBeNull();
      });
      (document.querySelector('#pipeline-dev-toggle') as HTMLButtonElement).click();

      await vi.waitFor(() => {
        expect(document.querySelector('#dev-server-status')?.textContent).toContain('No serve commands configured');
      });
      expect(window.alert).not.toHaveBeenCalled();
      expect((document.querySelector('#pipeline-dev-toggle') as HTMLButtonElement).textContent).toContain('Start Dev Server');

      clickCancel();
      await showPromise;
    });

    it('should fall back to the REST endpoint when the client exposes no dev methods', async () => {
      mockProps.pipeline!.serve_commands = [['sh', '-c', 'make serve']];
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ running: false, status: 'not_started', port: 1224 }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const dialog = new PipelineEditDialog(mockProps);
        const showPromise = dialog.show();
        switchToCmdTab('serve');

        await vi.waitFor(() => {
          expect(fetchMock).toHaveBeenCalled();
        });
        expect(fetchMock.mock.calls[0][0]).toBe('/api/pipelines/pipeline-1/dev/status');

        clickCancel();
        await showPromise;
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('models section', () => {
    const clickCancel = () => {
      document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    };

    it('should render a Models tab next to the command tabs', async () => {
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();

      const cmdTabs = Array.from(document.querySelectorAll('[data-cmd-tab]')).map(
        (el) => (el as HTMLElement).dataset.cmdTab
      );
      expect(cmdTabs).toEqual(['models', 'build', 'lint', 'test', 'serve']);

      const modelsTab = document.querySelector('[data-cmd-tab="models"]') as HTMLButtonElement;
      expect(modelsTab).not.toBeNull();
      expect(modelsTab.textContent).toContain('Models');
      // Models is selected by default, so its model selects are rendered.
      expect(modelsTab.className).toContain('text-app-accent-1');
      expect(document.querySelector('select[name="archbot_model"]')).not.toBeNull();

      // The model selects only live inside the Models tab.
      switchToCmdTab('test');
      expect(document.querySelector('select[name="archbot_model"]')).toBeNull();

      clickCancel();
      await showPromise;
    });

    it('should render a select for every use case with a global-default option', async () => {
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('models');

      for (const field of [
        'ollama_model',
        'one_prompt_model',
        'assistant_model',
        'archbot_model',
        'reviewbot_model',
        'docbot_model',
        'coderbot_model',
      ]) {
        const select = document.querySelector(`select[name="${field}"]`) as HTMLSelectElement;
        expect(select).not.toBeNull();
        expect(select.options[0].value).toBe('');
        expect(select.options[0].textContent).toContain('Use global default');
      }

      clickCancel();
      await showPromise;
    });

    it('should fetch and populate the model selects', async () => {
      (mockProps.context.pipelineClient as any).getModelOptions = vi.fn().mockResolvedValue({
        ollama: ['llama3', 'gpt-oss:20b'],
        coderbot: ['qwen3.6:27b'],
      });
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('models');

      await vi.waitFor(() => {
        const ollamaSelect = document.querySelector('select[name="archbot_model"]') as HTMLSelectElement;
        expect(Array.from(ollamaSelect.options).map((o) => o.value)).toContain('llama3');
      });
      expect((mockProps.context.pipelineClient as any).getModelOptions).toHaveBeenCalledWith('pipeline-1');

      const coderbotSelect = document.querySelector('select[name="coderbot_model"]') as HTMLSelectElement;
      expect(Array.from(coderbotSelect.options).map((o) => o.value)).toContain('qwen3.6:27b');
      // Ollama tags must not leak into the CoderBot list.
      expect(Array.from(coderbotSelect.options).map((o) => o.value)).not.toContain('llama3');

      clickCancel();
      await showPromise;
    });

    it('should sort the fetched model options alphabetically', async () => {
      (mockProps.context.pipelineClient as any).getModelOptions = vi.fn().mockResolvedValue({
        ollama: ['zeta:latest', 'alpha:latest', 'beta:7b'],
        coderbot: ['qwen3.6:27b', 'llama3'],
      });
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('models');

      await vi.waitFor(() => {
        const ollamaSelect = document.querySelector('select[name="archbot_model"]') as HTMLSelectElement;
        expect(Array.from(ollamaSelect.options).map((o) => o.value)).toContain('zeta:latest');
      });

      const ollamaValues = Array.from(
        (document.querySelector('select[name="archbot_model"]') as HTMLSelectElement).options
      ).map((o) => o.value);
      expect(ollamaValues.slice(1)).toEqual(['alpha:latest', 'beta:7b', 'zeta:latest']);

      const coderbotValues = Array.from(
        (document.querySelector('select[name="coderbot_model"]') as HTMLSelectElement).options
      ).map((o) => o.value);
      expect(coderbotValues.slice(1)).toEqual(['llama3', 'qwen3.6:27b']);

      clickCancel();
      await showPromise;
    });

    it('should send null for a model left on the global default', async () => {
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();

      const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
      saveBtn.click();
      await showPromise;

      const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
      expect(updateCall[2].archbot_model).toBeNull();
      expect(updateCall[2].coderbot_model).toBeNull();
    });

    it('should send a selected model override in the update payload', async () => {
      (mockProps.context.pipelineClient as any).getModelOptions = vi.fn().mockResolvedValue({
        ollama: ['llama3'],
        coderbot: ['qwen3.6:27b'],
      });
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('models');

      await vi.waitFor(() => {
        const select = document.querySelector('select[name="archbot_model"]') as HTMLSelectElement;
        expect(Array.from(select.options).map((o) => o.value)).toContain('llama3');
      });
      (document.querySelector('select[name="archbot_model"]') as HTMLSelectElement).value = 'llama3';
      (document.querySelector('select[name="coderbot_model"]') as HTMLSelectElement).value = 'qwen3.6:27b';

      const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
      saveBtn.click();
      await showPromise;

      const updateCall = (mockProps.context.pipelineClient.update as any).mock.calls[0];
      expect(updateCall[2].archbot_model).toBe('llama3');
      expect(updateCall[2].coderbot_model).toBe('qwen3.6:27b');
    });

    it('should keep a stored override that is missing from the catalog', async () => {
      mockProps.pipeline!.archbot_model = 'legacy-model:cloud';
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('models');

      const select = document.querySelector('select[name="archbot_model"]') as HTMLSelectElement;
      expect(select.value).toBe('legacy-model:cloud');
      expect(Array.from(select.options).map((o) => o.value)).toContain('legacy-model:cloud');

      clickCancel();
      await showPromise;
    });

    it('should render usable selects when the catalog is empty', async () => {
      const dialog = new PipelineEditDialog(mockProps);
      const showPromise = dialog.show();
      switchToCmdTab('models');

      const select = document.querySelector('select[name="archbot_model"]') as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThanOrEqual(1);
      expect(select.options[0].value).toBe('');

      clickCancel();
      await showPromise;
    });
  });
});
