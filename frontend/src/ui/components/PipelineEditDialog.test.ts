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
import { Pipeline } from '../../core/domain.ts';

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
          update: vi.fn().mockResolvedValue({})
        }
      } as any
    };

    vi.stubGlobal('alert', vi.fn());
  });

  const switchToTab = (tab: 'local' | 'remote') => {
    const btn = document.querySelector(`[data-tab="${tab}"]`) as HTMLButtonElement;
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
    mockProps.pipeline.repo_uri = 'https://host/org/my-app.git';
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
    mockProps.pipeline.repo_uri = 'https://host/org/my-app.git';
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
    mockProps.pipeline.repo_uri = 'https://host/org/my-app.git';
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
    mockProps.pipeline.repo_uri = 'https://host/org/my-app.git';
    mockProps.pipeline.has_repo_token = true;
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const tokenInput = document.querySelector('input[name="repo_token"]') as HTMLInputElement;
    expect(tokenInput.value).toBe('');

    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should show a token stored indicator when has_repo_token is true', async () => {
    mockProps.pipeline.repo_uri = 'https://host/org/my-app.git';
    mockProps.pipeline.has_repo_token = true;
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const indicator = document.querySelector('input[name="repo_token"]')?.parentElement?.querySelector('span');
    expect(indicator?.textContent).toContain('Token stored');

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

  it('should handle update failure gracefully', async () => {
    (mockProps.context.pipelineClient.update as any).mockRejectedValue(new Error('Update failed'));
    const dialog = new PipelineEditDialog(mockProps);
    const showPromise = dialog.show();

    const saveBtn = document.querySelector('#pipeline-edit-save') as HTMLButtonElement;
    saveBtn.click();

    // Wait for the async handleSave to fail
    await vi.waitFor(() => {
       expect(window.alert).toHaveBeenCalledWith('Failed to update pipeline. Please check the console.');
    });

    expect(saveBtn.disabled).toBe(false);
    expect(saveBtn.textContent).toBe('Save Changes');

    // Cleanup
    document.querySelector('#pipeline-edit-cancel')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });
});
