import { describe, it, expect } from 'vitest';
import { TaskItem } from './TaskItem.ts';
import { TaskStatus } from '../../core/domain.ts';

describe('TaskItem', () => {
  const mockTask = {
    _id: '1',
    title: 'Test Task',
    description: 'This is a description',
    status: TaskStatus.CREATED,
    pipeline_id: 'p1',
    deleted: false,
    version: 1,
    order: 0,
    type: 'manual',
    created_at: '2026-04-12T10:00:00Z',
    history: []
  };

  it('should render expanded by default', () => {
    const html = TaskItem.render(mockTask as any);
    expect(html).toContain('Test Task');
    expect(html).toContain('This is a description');
    expect(html).toContain('task-body flex flex-col gap-3 ');
    expect(html).not.toContain('task-body flex flex-col gap-3 hidden');
    expect(html).toContain('rotate-90');
  });

  it('should hide body when collapsed', () => {
    const html = TaskItem.render(mockTask as any, true, false, true);
    expect(html).toContain('Test Task');
    expect(html).toContain('task-body flex flex-col gap-3 hidden');
    expect(html).not.toContain('rotate-90');
  });
});
