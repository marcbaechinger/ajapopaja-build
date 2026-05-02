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
import { DesignDocDiffDialog } from './DesignDocDiffDialog.ts';
import { TaskStatus } from '../../core/domain.ts';

describe('DesignDocDiffDialog', () => {
  let mockContext: any;
  let mockTask: any;
  let mockHistory: any[];

  beforeEach(() => {
    document.body.innerHTML = '';
    
    mockTask = {
      id: 'task-1',
      version: 2,
      design_doc: '# Current Doc\nThis is the current version.',
      status: TaskStatus.CREATED
    };

    mockHistory = [
      {
        version: 1,
        design_doc: '# Historical Doc\nThis is version 1.',
        timestamp: '2026-05-01T12:00:00Z'
      },
      {
        version: 0,
        design_doc: '# Initial Doc\nThis is version 0.',
        timestamp: '2026-05-01T10:00:00Z'
      }
    ];

    mockContext = {
      taskClient: {
        getHistory: vi.fn().mockResolvedValue(mockHistory),
        updateDetails: vi.fn().mockResolvedValue({})
      }
    };

    // Mock global APIs
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    vi.stubGlobal('alert', vi.fn());

    // Mock HTMLDialogElement methods not implemented in JSDOM
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it('should load history on initialization', async () => {
    const dialog = new DesignDocDiffDialog(mockContext, mockTask);
    
    // Wait for loadHistory to complete
    await new Promise(resolve => setTimeout(resolve, 0));
    
    expect(mockContext.taskClient.getHistory).toHaveBeenCalledWith('task-1');
    const dialogElement = dialog['dialog'];
    expect(dialogElement.innerHTML).toContain('Historical v1');
    expect(dialogElement.innerHTML).toContain('Current v2');
  });

  it('should switch between historical versions', async () => {
    const dialog = new DesignDocDiffDialog(mockContext, mockTask);
    await new Promise(resolve => setTimeout(resolve, 0));
    
    const dialogElement = dialog['dialog'];
    const selector = dialogElement.querySelector('#version-selector') as HTMLSelectElement;
    
    // Switch to version 0 (index 1)
    selector.value = '1';
    selector.dispatchEvent(new Event('change'));
    
    expect(dialogElement.innerHTML).toContain('Historical v0');
    expect(dialogElement.innerHTML).toContain('This is version 0.');
  });

  it('should switch between side-by-side and unified diff modes', async () => {
    const dialog = new DesignDocDiffDialog(mockContext, mockTask);
    await new Promise(resolve => setTimeout(resolve, 0));
    
    const dialogElement = dialog['dialog'];
    
    // Default is side-by-side
    expect(dialogElement.innerHTML).toContain('Side-by-Side');
    
    // Switch to unified
    const unifiedRadio = dialogElement.querySelector('input[value="unified"]') as HTMLInputElement;
    unifiedRadio.checked = true;
    unifiedRadio.dispatchEvent(new Event('change'));
    
    expect(dialogElement.innerHTML).toContain('Unified Diff: v1 → v2');
    // Check if unified diff is rendered (it uses <ins> and <del> tags typically from diffLines)
    // Actually our renderUnifiedDiff uses <span>, <ins>, <del>
    expect(dialogElement.querySelector('ins')).toBeTruthy();
    expect(dialogElement.querySelector('del')).toBeTruthy();
  });

  it('should restore a version when restore button is clicked', async () => {
    const dialog = new DesignDocDiffDialog(mockContext, mockTask);
    await new Promise(resolve => setTimeout(resolve, 0));
    
    const closeSpy = vi.spyOn(dialog as any, 'close');
    const dialogElement = dialog['dialog'];
    const restoreBtn = dialogElement.querySelector('#restore-version-btn') as HTMLButtonElement;
    
    await restoreBtn.click();
    
    expect(window.confirm).toHaveBeenCalled();
    expect(mockContext.taskClient.updateDetails).toHaveBeenCalledWith('task-1', 2, {
      design_doc: mockHistory[0].design_doc
    });
    expect(closeSpy).toHaveBeenCalled();
  });

  it('should show error message if history loading fails', async () => {
    mockContext.taskClient.getHistory.mockRejectedValue(new Error('API Error'));
    
    const dialog = new DesignDocDiffDialog(mockContext, mockTask);
    await new Promise(resolve => setTimeout(resolve, 0));
    
    const dialogElement = dialog['dialog'];
    expect(dialogElement.innerHTML).toContain('Failed to load history.');
  });

  it('should show empty state message if no history found', async () => {
    mockContext.taskClient.getHistory.mockResolvedValue([]);
    
    const dialog = new DesignDocDiffDialog(mockContext, mockTask);
    await new Promise(resolve => setTimeout(resolve, 0));
    
    const dialogElement = dialog['dialog'];
    expect(dialogElement.innerHTML).toContain('No historical versions found.');
  });

  it('should close the dialog when close button is clicked', async () => {
    const dialog = new DesignDocDiffDialog(mockContext, mockTask);
    const closeSpy = vi.spyOn(dialog as any, 'close');
    
    const showPromise = dialog.show();
    
    const closeBtn = document.querySelector('#dialog-close-action') as HTMLButtonElement;
    closeBtn.click();
    
    await showPromise;
    expect(closeSpy).toHaveBeenCalled();
  });
});
