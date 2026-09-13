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
import { HistoryItemView } from './HistoryItemView.ts';
import { TaskStatus } from '../../core/domain.ts';

describe('HistoryItemView', () => {
  const baseTask = {
    id: 't1',
    title: 'Implemented Task',
    status: TaskStatus.IMPLEMENTED,
    pipeline_id: 'p1',
    deleted: false,
    version: 1,
    order: 0,
    type: 'manual',
    commit_hash: 'abcdef123456',
    completion_info: '## Done',
    created_at: '2026-04-12T10:00:00Z',
    updated_at: '2026-04-12T11:00:00Z',
    history: [
      { from_status: TaskStatus.CREATED, to_status: TaskStatus.INPROGRESS, timestamp: '2026-04-12T10:00:00Z', by: 'user' },
      { from_status: TaskStatus.INPROGRESS, to_status: TaskStatus.IMPLEMENTED, timestamp: '2026-04-12T10:30:00Z', by: 'system' },
    ]
  };

  it('should classify IMPLEMENTED and SUBMITTED as history statuses', () => {
    expect(HistoryItemView.isHistoryStatus(TaskStatus.IMPLEMENTED)).toBe(true);
    expect(HistoryItemView.isHistoryStatus(TaskStatus.SUBMITTED)).toBe(true);
    expect(HistoryItemView.isHistoryStatus(TaskStatus.CREATED)).toBe(false);
    expect(HistoryItemView.isHistoryStatus(TaskStatus.DISCARDED)).toBe(false);
  });

  it('should render title, task id, and copy button', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).toContain('Implemented Task');
    expect(html).toContain('>t1<');
    expect(html).toContain('data-action-click="copy_task_id"');
  });

  it('should render DocBot, QuickFix and Review buttons', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).toContain('data-action-click="trigger_docbot"');
    expect(html).toContain('data-action-click="open_quickfix"');
    expect(html).toContain('title="Open Quickfix in Neovim"');
    expect(html).toContain('data-action-click="trigger_reviewbot"');
  });

  it('should render Review badge instead of trigger when review_md is present', () => {
    const html = HistoryItemView.render({ ...baseTask, review_md: '# Review' } as any);
    expect(html).toContain('data-action-click="open_review_dialog"');
    expect(html).not.toContain('data-action-click="trigger_reviewbot"');
  });

  it('should render commit hash with open_diff_view action', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).toContain('abcdef1');
    expect(html).toContain('data-action-click="open_diff_view"');
    expect(html).toContain('data-commit-hash="abcdef123456"');
  });

  it('should render implementation time and delete/fail actions', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).toContain('Impl:');
    expect(html).toContain('data-action-click="delete_task"');
    expect(html).toContain('data-action-click="fail_task"');
    expect(html).toContain('Mark as Failed');
  });

  it('should render the implementation summary', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).toContain('Implementation Summary');
    expect(html).toContain('Done');
  });

  it('should keep the implementation summary collapsed by default', () => {
    const html = HistoryItemView.render(baseTask as any);
    const summary = html.match(/<details class="group\/summary[\s\S]*?<\/details>/);
    expect(summary).not.toBeNull();
    expect(summary![0]).toContain('Implementation Summary');
    // no 'open' attribute -> collapsed by default
    expect(summary![0]).not.toMatch(/<details[^>]*open/);
  });

  it('should render delete and fail actions in the bottom-right action bar', () => {
    const html = HistoryItemView.render(baseTask as any);
    const actionBar = html.match(/<div class="flex justify-end[\s\S]*?<\/div>/);
    expect(actionBar).not.toBeNull();
    expect(actionBar![0]).toContain('data-action-click="delete_task"');
    expect(actionBar![0]).toContain('data-action-click="fail_task"');
    expect(actionBar![0]).toContain('Mark as Failed');
  });

  it('should keep the status history collapsed by default', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).toContain('Status History');
    expect(html).toContain('<details');
    // not 'open' -> collapsed
    expect(html).not.toMatch(/<details[^>]*open/);
  });

  it('should make the header clickable to select the task', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).toContain('data-action-click="select_task"');
    expect(html).toContain('data-view-id="t1"');
  });
});
