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
import { ReviewNotificationBadge } from './ReviewNotificationBadge';
import { Task, TaskStatus } from '../../core/domain';

describe('ReviewNotificationBadge', () => {
  const task1 = new Task({ id: 't1', title: 'Task One', status: TaskStatus.IMPLEMENTED });
  const task2 = new Task({ id: 't2', title: 'Task Two', status: TaskStatus.IMPLEMENTED });
  const task3 = new Task({ id: 't3', title: 'Task Three', status: TaskStatus.IMPLEMENTED });
  const allTasks = [task1, task2, task3];

  it('renders nothing when pendingReviews is empty', () => {
    const html = ReviewNotificationBadge.render([], allTasks);
    expect(html).toBe('');
  });

  it('renders single review badge when there is one pending review', () => {
    const html = ReviewNotificationBadge.render(['t1'], allTasks);
    expect(html).toContain('Review: Task One');
    expect(html).toContain('data-action-click="open_review_dialog"');
    expect(html).toContain('data-task-id="t1"');
    expect(html).not.toContain('group/reviewdropdown');
  });

  it('renders multiple review dropdown when there are multiple pending reviews', () => {
    const html = ReviewNotificationBadge.render(['t1', 't2', 't3'], allTasks);
    
    // Should show count
    expect(html).toContain('3 Reviews Ready');
    
    // Should have dropdown container
    expect(html).toContain('group/reviewdropdown');
    
    // Oldest action should be t1
    expect(html).toContain('data-task-id="t1"');
    expect(html).toContain('Open Oldest');
    
    // Other actions should be in dropdown
    expect(html).toContain('data-task-id="t2"');
    expect(html).toContain('Task Two');
    expect(html).toContain('data-task-id="t3"');
    expect(html).toContain('Task Three');
  });

  it('handles missing tasks gracefully', () => {
    const html = ReviewNotificationBadge.render(['t4'], allTasks);
    expect(html).toContain('Review: Task');
    expect(html).toContain('data-task-id="t4"');
  });
});
