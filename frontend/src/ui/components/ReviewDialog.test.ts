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
import { ReviewDialog, type ReviewDialogProps } from './ReviewDialog.ts';
import { Task } from '../../core/domain.ts';

describe('ReviewDialog', () => {
  let mockProps: ReviewDialogProps;

  beforeEach(() => {
    document.body.innerHTML = '';
    
    // Mock showModal and close
    HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) {
      this.open = false;
    });

    mockProps = {
      task: new Task({
        id: 'task-1',
        title: 'Test Task',
        status: 'implemented',
        review_md: '# Review\n\nLooks good.'
      }),
      pipelineId: 'pipeline-1',
      context: {
        reviewBotClient: {
          deleteReview: vi.fn().mockResolvedValue(undefined)
        }
      } as any,
      onDelete: vi.fn()
    };

    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  it('should render Markdown content', async () => {
    const dialog = new ReviewDialog(mockProps);
    const showPromise = dialog.show();

    await vi.waitFor(() => {
      expect(document.body.innerHTML).toContain('<h1>Review</h1>');
      expect(document.body.innerHTML).toContain('Looks good.');
    });

    // Cleanup
    document.querySelector('#review-close-btn')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should sanitize Markdown content', async () => {
    mockProps.task.review_md = '# Review\n\n<script>alert("XSS")</script> **Safe Content**';
    const dialog = new ReviewDialog(mockProps);
    const showPromise = dialog.show();

    await vi.waitFor(() => {
      expect(document.body.innerHTML).toContain('<h1>Review</h1>');
      // DOMPurify removes <script> and might leave **Safe Content** as text if marked didn't parse it inside sanitization context or vice versa
      expect(document.body.innerHTML).toContain('Safe Content');
      expect(document.body.innerHTML).not.toContain('<script>');
    });

    // Cleanup
    document.querySelector('#review-close-btn')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should copy prompts to clipboard', async () => {
    const dialog = new ReviewDialog(mockProps);
    const showPromise = dialog.show();

    // 1. Create Tasks
    const createTasksBtn = await vi.waitFor(() => {
      const btn = document.querySelector('[data-action-copy="create_tasks"]') as HTMLButtonElement;
      if (!btn) throw new Error('btn not found');
      return btn;
    });
    createTasksBtn.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Please analyze the technical review for Task task-1 in Pipeline pipeline-1')
    );
    await vi.waitFor(() => {
      expect(createTasksBtn.innerHTML).toContain('Copied!');
    });

    // 2. Explain
    const explainBtn = document.querySelector('[data-action-copy="explain_review"]') as HTMLButtonElement;
    explainBtn.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Can you explain the technical review for Task task-1 in Pipeline pipeline-1')
    );

    // 3. Design Check
    const designBtn = document.querySelector('[data-action-copy="design_check"]') as HTMLButtonElement;
    designBtn.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('established design patterns')
    );

    // Cleanup
    document.querySelector('#review-close-btn')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });

  it('should handle delete action', async () => {
    // Note: Since ConfirmationDialog is used now, we can mock it here if we want, or just mock the confirm prompt if it was a window.confirm.
    // Wait, the new code uses ConfirmationDialog which isn't mocked globally but we can just mock it or assume the test environment needs a mock.
    // Let's actually look at ConfirmationDialog.ts to see what it does. It probably renders a UI.
    // For now, let's just make sure it passes. Wait, if it renders a UI, we have to click "confirm".
    const dialog = new ReviewDialog(mockProps);
    const showPromise = dialog.show();

    const deleteBtn = await vi.waitFor(() => {
        const btn = document.querySelector('#review-delete-btn') as HTMLButtonElement;
        if (!btn) throw new Error('btn not found');
        return btn;
    });
    deleteBtn.click();

    // Find confirmation dialog confirm button and click it
    const confirmBtn = await vi.waitFor(() => {
        const btn = document.querySelector('#dialog-confirm') as HTMLButtonElement; 
        if (!btn) throw new Error('confirm btn not found');
        return btn;
    });
    confirmBtn.click();

    await showPromise;

    expect(mockProps.context.reviewBotClient.deleteReview).toHaveBeenCalledWith(
      'pipeline-1',
      'task-1'
    );
    expect(mockProps.onDelete).toHaveBeenCalled();
  });

  it('should handle delete failure', async () => {
    (mockProps.context.reviewBotClient.deleteReview as any).mockRejectedValue(new Error('Delete failed'));
    const dialog = new ReviewDialog(mockProps);
    const showPromise = dialog.show();

    const deleteBtn = await vi.waitFor(() => {
        const btn = document.querySelector('#review-delete-btn') as HTMLButtonElement;
        if (!btn) throw new Error('btn not found');
        return btn;
    });
    deleteBtn.click();

    // Find confirmation dialog confirm button and click it
    const confirmBtn = await vi.waitFor(() => {
        const btn = document.querySelector('#dialog-confirm') as HTMLButtonElement; 
        if (!btn) throw new Error('confirm btn not found');
        return btn;
    });
    confirmBtn.click();

    await vi.waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith('Failed to delete review. Please check the console.');
    });

    expect(deleteBtn.disabled).toBe(false);
    expect(mockProps.onDelete).not.toHaveBeenCalled();

    // Cleanup
    document.querySelector('#review-close-btn')?.dispatchEvent(new MouseEvent('click'));
    await showPromise;
  });
});
