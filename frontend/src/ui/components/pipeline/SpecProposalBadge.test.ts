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
import { SpecProposalBadge } from './SpecProposalBadge';
import { Task, TaskStatus } from '../../../core/domain';

describe('SpecProposalBadge', () => {
  const task1 = new Task({ id: 't1', title: 'Task One', status: TaskStatus.CREATED });
  const task2 = new Task({ id: 't2', title: 'Task Two', status: TaskStatus.CREATED });
  const allTasks = [task1, task2];

  const proposal = (taskId: string) => ({
    task_id: taskId,
    pipeline_id: 'p1',
    spec_md: '# spec',
  });

  it('renders nothing when there are no proposals', () => {
    expect(SpecProposalBadge.render([], allTasks)).toBe('');
    expect(SpecProposalBadge.render(undefined, allTasks)).toBe('');
  });

  it('renders a single review badge with the open action', () => {
    const html = SpecProposalBadge.render([proposal('t1')], allTasks);
    expect(html).toContain('Spec ready: Task One');
    expect(html).toContain('data-action-click="open_spec_proposal"');
    expect(html).toContain('data-task-id="t1"');
  });

  it('renders a dropdown for multiple proposals', () => {
    const html = SpecProposalBadge.render(
      [proposal('t1'), proposal('t2')],
      allTasks
    );
    expect(html).toContain('2 Specs Ready');
    expect(html).toContain('group/specdropdown');
    expect(html).toContain('data-task-id="t1"');
    expect(html).toContain('data-task-id="t2"');
    expect(html).toContain('Task Two');
  });

  it('handles proposals whose task is unknown', () => {
    const html = SpecProposalBadge.render([proposal('t9')], allTasks);
    expect(html).toContain('Spec ready: Task t9');
    expect(html).toContain('data-task-id="t9"');
  });
});
