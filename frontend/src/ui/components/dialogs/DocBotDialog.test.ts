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
import { DocBotDialog, type DocBotDialogProps } from './DocBotDialog.ts';

describe('DocBotDialog', () => {
  let container: HTMLElement;
  let mockProps: DocBotDialogProps;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);

    mockProps = {
      taskId: 'task-1',
      pipelineId: 'pipeline-1',
      diff: '--- file.txt\n+++ file.txt\n@@ -1 +1 @@\n-old\n+new',
      commitMsg: '[test] Initial commit',
      filename: 'file.txt',
      onClose: vi.fn(),
      onSuccess: vi.fn(),
      context: {
        docBotClient: {
          commitChanges: vi.fn().mockResolvedValue({}),
          revertChanges: vi.fn().mockResolvedValue({}),
          cancelReview: vi.fn().mockResolvedValue({})
        }
      } as any
    };

    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    vi.stubGlobal('alert', vi.fn());
  });

  it('should render the dialog with correct content', () => {
    new DocBotDialog(container, mockProps);

    expect(container.innerHTML).toContain('DocBot Review: file.txt');
    expect(container.innerHTML).toContain('old');
    expect(container.innerHTML).toContain('new');
    expect((container.querySelector('#commit-msg-input') as HTMLTextAreaElement).value).toBe('[test] Initial commit');
  });

  it('should call commitChanges and success callbacks on commit', async () => {
    new DocBotDialog(container, mockProps);

    const commitBtn = container.querySelector('#docbot-commit-btn') as HTMLButtonElement;
    const input = container.querySelector('#commit-msg-input') as HTMLTextAreaElement;
    input.value = 'Updated commit message';

    await commitBtn.click();

    expect(mockProps.context.docBotClient.commitChanges).toHaveBeenCalledWith(
      'pipeline-1',
      'task-1',
      'Updated commit message'
    );
    expect(mockProps.onSuccess).toHaveBeenCalled();
    expect(mockProps.onClose).toHaveBeenCalled();
  });

  it('should handle commit failure gracefully', async () => {
    (mockProps.context.docBotClient.commitChanges as any).mockRejectedValue(new Error('Commit failed'));
    new DocBotDialog(container, mockProps);

    const commitBtn = container.querySelector('#docbot-commit-btn') as HTMLButtonElement;
    await commitBtn.click();

    expect(window.alert).toHaveBeenCalledWith('Failed to commit changes. Please check the console.');
    expect(commitBtn.disabled).toBe(false);
    expect(commitBtn.textContent).toBe('Commit Changes');
  });

  it('should call revertChanges and success callbacks on revert', async () => {
    new DocBotDialog(container, mockProps);

    const revertBtn = container.querySelector('#docbot-revert-btn') as HTMLButtonElement;
    await revertBtn.click();

    expect(window.confirm).toHaveBeenCalled();
    expect(mockProps.context.docBotClient.revertChanges).toHaveBeenCalledWith(
      'pipeline-1',
      'task-1'
    );
    expect(mockProps.onSuccess).toHaveBeenCalled();
    expect(mockProps.onClose).toHaveBeenCalled();
  });

  it('should not call revertChanges if confirmation is denied', async () => {
    (window.confirm as any).mockReturnValue(false);
    new DocBotDialog(container, mockProps);

    const revertBtn = container.querySelector('#docbot-revert-btn') as HTMLButtonElement;
    await revertBtn.click();

    expect(mockProps.context.docBotClient.revertChanges).not.toHaveBeenCalled();
  });

  it('should call cancelReview and close on cancel', async () => {
    new DocBotDialog(container, mockProps);

    const cancelBtn = container.querySelector('#docbot-cancel-btn') as HTMLButtonElement;
    await cancelBtn.click();

    expect(mockProps.context.docBotClient.cancelReview).toHaveBeenCalledWith(
      'pipeline-1',
      'task-1'
    );
    expect(mockProps.onClose).toHaveBeenCalled();
  });

  it('should close the dialog even if cancelReview fails', async () => {
    (mockProps.context.docBotClient.cancelReview as any).mockRejectedValue(new Error('Cancel failed'));
    new DocBotDialog(container, mockProps);

    const cancelBtn = container.querySelector('#docbot-cancel-btn') as HTMLButtonElement;
    await cancelBtn.click();

    expect(mockProps.onClose).toHaveBeenCalled();
  });

  it('should call handleCancel when close icon is clicked', async () => {
    new DocBotDialog(container, mockProps);

    const closeIconBtn = container.querySelector('#docbot-close-btn') as HTMLButtonElement;
    await closeIconBtn.click();

    expect(mockProps.context.docBotClient.cancelReview).toHaveBeenCalled();
    expect(mockProps.onClose).toHaveBeenCalled();
  });
});
