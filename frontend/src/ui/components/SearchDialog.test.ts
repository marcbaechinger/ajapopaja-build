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
import { SearchDialog } from './SearchDialog.ts';
import { Task, TaskStatus } from '../../core/domain.ts';
import { ConfirmationDialog } from './ConfirmationDialog.ts';

// Mock ConfirmationDialog
vi.mock('./ConfirmationDialog.ts', () => {
  return {
    ConfirmationDialog: vi.fn().mockImplementation(function() {
      return {
        show: vi.fn().mockResolvedValue(true)
      };
    })
  };
});

describe('SearchDialog', () => {
  let context: any;
  let dialog: SearchDialog;

  beforeEach(() => {
    document.body.innerHTML = '';
    context = {
      taskClient: {
        search: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
        updateStatus: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
        acceptDesign: vi.fn().mockResolvedValue({}),
        rejectDesign: vi.fn().mockResolvedValue({}),
      }
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should render correctly with default title', () => {
    dialog = new SearchDialog(context);
    const dialogElement = dialog['dialog'];
    expect(dialogElement.querySelector('h3')?.textContent).toContain('Global Task Search');
  });

  it('should render correctly with pipeline scope', () => {
    dialog = new SearchDialog(context, 'p1');
    const dialogElement = dialog['dialog'];
    expect(dialogElement.querySelector('h3')?.textContent).toContain('Search Pipeline Tasks');
    expect(dialogElement.textContent).toContain('Scoped to Pipeline: p1');
  });

  it('should perform search when typing (debounced)', async () => {
    vi.useFakeTimers();
    dialog = new SearchDialog(context);
    const input = dialog['dialog'].querySelector('#search-keywords') as HTMLInputElement;
    
    input.value = 'test keyword';
    input.dispatchEvent(new Event('input'));
    
    expect(context.taskClient.search).not.toHaveBeenCalled();
    
    vi.advanceTimersByTime(400);
    
    expect(context.taskClient.search).toHaveBeenCalledWith(expect.objectContaining({
      keywords: 'test keyword',
      page: 0
    }));
  });

  it('should perform search immediately on Enter', async () => {
    dialog = new SearchDialog(context);
    const input = dialog['dialog'].querySelector('#search-keywords') as HTMLInputElement;
    
    input.value = 'instant';
    // Trigger input event to update internal state
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    
    expect(context.taskClient.search).toHaveBeenCalledWith(expect.objectContaining({
      keywords: 'instant'
    }));
  });

  it('should update results when search completes', async () => {
    const mockTask = new Task({ _id: 't1', title: 'Task 1', status: TaskStatus.CREATED, version: 1, history: [] });
    context.taskClient.search.mockResolvedValue({ tasks: [mockTask], total_count: 1 });
    
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const resultsContainer = dialog['dialog'].querySelector('#search-results-container');
    expect(resultsContainer?.textContent).toContain('Task 1');
  });

  it('should handle status filter changes', async () => {
    dialog = new SearchDialog(context);
    const checkbox = dialog['dialog'].querySelector('input[value="created"]') as HTMLInputElement;
    
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    
    expect(context.taskClient.search).toHaveBeenCalledWith(expect.objectContaining({
      statuses: ['created']
    }));
  });

  it('should handle pagination', async () => {
    context.taskClient.search.mockResolvedValue({ tasks: [], total_count: 25 });
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const nextBtn = dialog['dialog'].querySelector('[data-action-click="next_search_page"]');
    nextBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    
    expect(context.taskClient.search).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 1
    }));
  });

  it('should handle task deletion', async () => {
    const mockTask = new Task({ _id: 't1', title: 'Task to delete', status: TaskStatus.CREATED, version: 1, history: [] });
    context.taskClient.search.mockResolvedValue({ tasks: [mockTask], total_count: 1 });
    
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const deleteBtn = dialog['dialog'].querySelector('[data-action-click="delete_task"]');
    deleteBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    
    // Wait for async handler
    await vi.waitFor(() => {
      expect(context.taskClient.delete).toHaveBeenCalledWith('t1');
    });
    
    expect(ConfirmationDialog).toHaveBeenCalled();

    // Wait for the second search call which is not awaited in the handler
    await vi.waitFor(() => {
      expect(context.taskClient.search).toHaveBeenCalledTimes(2);
    });
  });


  it('should handle status change via selector', async () => {
    const mockTask = new Task({ _id: 't1', title: 'Task', status: TaskStatus.CREATED, version: 1, history: [] });
    context.taskClient.search.mockResolvedValue({ tasks: [mockTask], total_count: 1 });
    
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const select = dialog['dialog'].querySelector('select[data-action-change="change_task_status"]') as HTMLSelectElement;
    select.value = 'scheduled';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    
    expect(context.taskClient.updateStatus).toHaveBeenCalledWith('t1', 'scheduled', 1);
  });

  it('should handle task actions like schedule', async () => {
    const mockTask = new Task({ _id: 't1', title: 'Task', status: TaskStatus.CREATED, version: 1, history: [] });
    context.taskClient.search.mockResolvedValue({ tasks: [mockTask], total_count: 1 });
    
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const scheduleBtn = dialog['dialog'].querySelector('[data-action-click="schedule_task"]');
    await scheduleBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    
    expect(context.taskClient.updateStatus).toHaveBeenCalledWith('t1', TaskStatus.SCHEDULED, 1);
  });

  it('should handle task actions like unschedule', async () => {
    const mockTask = new Task({ _id: 't1', title: 'Task', status: TaskStatus.SCHEDULED, version: 1, history: [] });
    context.taskClient.search.mockResolvedValue({ tasks: [mockTask], total_count: 1 });
    
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const unscheduleBtn = dialog['dialog'].querySelector('[data-action-click="unschedule_task"]');
    await unscheduleBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    
    expect(context.taskClient.updateStatus).toHaveBeenCalledWith('t1', TaskStatus.CREATED, 1);
  });

  it('should handle design doc acceptance', async () => {
    const mockTask = new Task({ _id: 't1', title: 'Task', status: TaskStatus.PROPOSED, version: 1, history: [] });
    context.taskClient.search.mockResolvedValue({ tasks: [mockTask], total_count: 1 });
    
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const acceptBtn = dialog['dialog'].querySelector('[data-action-click="accept_design"]');
    await acceptBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    
    expect(context.taskClient.acceptDesign).toHaveBeenCalledWith('t1', 1);
  });

  it('should handle design doc rejection', async () => {
    const mockTask = new Task({ _id: 't1', title: 'Task', status: TaskStatus.PROPOSED, version: 1, history: [] });
    context.taskClient.search.mockResolvedValue({ tasks: [mockTask], total_count: 1 });
    
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const rejectBtn = dialog['dialog'].querySelector('[data-action-click="reject_design"]');
    await rejectBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    
    expect(context.taskClient.rejectDesign).toHaveBeenCalledWith('t1', 1);
  });

  it('should toggle design doc expansion', async () => {
    const mockTask = new Task({ 
      _id: 't1', title: 'Task', status: TaskStatus.CREATED, version: 1, 
      design_doc: 'Design doc content', history: [] 
    });
    context.taskClient.search.mockResolvedValue({ tasks: [mockTask], total_count: 1 });
    
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const toggleBtn = dialog['dialog'].querySelector('[data-action-click="toggle_design_doc_expand"]');
    const display = dialog['dialog'].querySelector('.design-doc-display');
    
    expect(display?.classList.contains('expanded')).toBe(false);
    
    toggleBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    
    expect(display?.classList.contains('expanded')).toBe(true);
    expect(toggleBtn?.textContent).toBe('Show Less');
    
    toggleBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(display?.classList.contains('expanded')).toBe(false);
    expect(toggleBtn?.textContent).toBe('Show More');
  });

  it('should toggle spec expansion', async () => {
    const mockTask = new Task({ 
      _id: 't1', title: 'Task', status: TaskStatus.CREATED, version: 1, 
      spec: 'Spec content', history: [] 
    });
    context.taskClient.search.mockResolvedValue({ tasks: [mockTask], total_count: 1 });
    
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const toggleBtn = dialog['dialog'].querySelector('[data-action-click="toggle_spec_expand"]');
    const display = dialog['dialog'].querySelector('.spec-display');
    
    expect(display?.classList.contains('expanded')).toBe(false);
    
    toggleBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    
    expect(display?.classList.contains('expanded')).toBe(true);
    expect(toggleBtn?.textContent).toBe('Show Less');
    
    toggleBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(display?.classList.contains('expanded')).toBe(false);
    expect(toggleBtn?.textContent).toBe('Show More');
  });

  it('should handle task action: fail task', async () => {
    const mockTask = new Task({ _id: 't1', title: 'Task', status: TaskStatus.INPROGRESS, version: 1, history: [] });
    context.taskClient.search.mockResolvedValue({ tasks: [mockTask], total_count: 1 });
    
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const failBtn = dialog['dialog'].querySelector('[data-action-click="fail_task"]');
    await failBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    
    expect(context.taskClient.updateStatus).toHaveBeenCalledWith('t1', TaskStatus.FAILED, 1);
  });

  it('should handle task action: cancel progress', async () => {
    const mockTask = new Task({ _id: 't1', title: 'Task', status: TaskStatus.INPROGRESS, version: 1, history: [] });
    context.taskClient.search.mockResolvedValue({ tasks: [mockTask], total_count: 1 });
    
    dialog = new SearchDialog(context);
    await dialog['performSearch'](0);
    
    const cancelBtn = dialog['dialog'].querySelector('[data-action-click="cancel_progress"]');
    await cancelBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    
    expect(context.taskClient.updateStatus).toHaveBeenCalledWith('t1', TaskStatus.CREATED, 1);
  });
});
