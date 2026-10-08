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
import { OrderControl } from './OrderControl.ts';
import { Task, TaskStatus } from '../../../core/domain.ts';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Task',
    status: TaskStatus.CREATED,
    type: 'manual',
    order: 100,
    version: 3,
    want_design_doc: false,
    deleted: false,
    ...overrides,
  } as Task;
}

describe('OrderControl', () => {
  it('should render the numeric order value in an editable number field', () => {
    const html = OrderControl.render(makeTask({ order: -7 }));
    expect(html).toContain('type="number"');
    expect(html).toContain('value="-7"');
    expect(html).toContain('data-action-change="update_task_order"');
  });

  it('should bind the task id and version on the input', () => {
    const html = OrderControl.render(makeTask({ id: 't9', version: 5, order: 10 }));
    expect(html).toContain('data-task-id="t9"');
    expect(html).toContain('data-version="5"');
    expect(html).toContain('value="10"');
  });

  it('should render move up / move down nudge buttons carrying the current order', () => {
    const html = OrderControl.render(makeTask({ order: 20, version: 2 }));
    expect(html).toContain('data-action-click="move_task_up"');
    expect(html).toContain('data-action-click="move_task_down"');
    expect(html).toContain('data-order="20"');
    expect(html).toContain('data-version="2"');
  });

  it('should default missing order and version values', () => {
    const html = OrderControl.render(makeTask({ order: undefined as any, version: undefined as any }));
    expect(html).toContain('value="0"');
    expect(html).toContain('data-version="1"');
  });
});
