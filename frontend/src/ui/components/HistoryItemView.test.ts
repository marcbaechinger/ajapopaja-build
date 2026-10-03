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

  it('should render the title', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).toContain('Implemented Task');
  });

  it('should render commit hash with open_diff_view action', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).toContain('abcdef1');
    expect(html).toContain('data-action-click="open_diff_view"');
    expect(html).toContain('data-commit-hash="abcdef123456"');
    expect(html).toContain('title="View Commit Diff"');
  });

  it('should render implementation duration', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).toContain('Impl:');
  });

  it('should render the status badge', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html.trim()).toMatch(/implemented\s*<\/span>/);
  });

  it('should make the item clickable to select the task', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).toContain('data-action-click="select_task"');
    expect(html).toContain('data-view-id="t1"');
  });

  it('should not render an editable order control (moved to queued tasks)', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).not.toContain('data-action-change="update_task_order"');
    expect(html).not.toContain('data-action-click="move_task_up"');
    expect(html).not.toContain('data-action-click="move_task_down"');
  });

  it('should not render removed actions or sections', () => {
    const html = HistoryItemView.render(baseTask as any);
    expect(html).not.toContain('data-action-click="copy_task_id"');
    expect(html).not.toContain('data-action-click="trigger_docbot"');
    expect(html).not.toContain('data-action-click="open_quickfix"');
    expect(html).not.toContain('data-action-click="trigger_reviewbot"');
    expect(html).not.toContain('data-action-click="open_review_dialog"');
    expect(html).not.toContain('data-action-click="delete_task"');
    expect(html).not.toContain('data-action-click="fail_task"');
    expect(html).not.toContain('Implementation Summary');
    expect(html).not.toContain('Status History');
    expect(html).not.toContain('<details');
  });

  it('should render implementation duration for a SUBMITTED task without an IMPLEMENTED transition', () => {
    const submittedTask = {
      ...baseTask,
      status: TaskStatus.SUBMITTED,
      history: [
        { from_status: TaskStatus.CREATED, to_status: TaskStatus.INPROGRESS, timestamp: '2026-04-12T10:00:00Z', by: 'user' },
        { from_status: TaskStatus.INPROGRESS, to_status: TaskStatus.PULL_REQUEST_AVAILABLE, timestamp: '2026-04-12T10:05:30Z', by: 'system' },
        { from_status: TaskStatus.PULL_REQUEST_AVAILABLE, to_status: TaskStatus.SUBMITTED, timestamp: '2026-04-12T10:10:00Z', by: 'system' },
      ],
    };
    const html = HistoryItemView.render(submittedTask as any);
    expect(html).toContain('Impl:');
    expect(html).toContain('5m 30s');
  });

  it('should omit the commit hash when not present', () => {
    const html = HistoryItemView.render({ ...baseTask, commit_hash: null } as any);
    expect(html).not.toContain('data-action-click="open_diff_view"');
  });

  it('should omit duration when not computable', () => {
    const html = HistoryItemView.render({ ...baseTask, history: [] } as any);
    expect(html).not.toContain('Impl:');
  });
});
