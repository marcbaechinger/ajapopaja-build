import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryDialog } from './HistoryDialog.ts';
import { TaskStatus } from '../../core/domain.ts';

describe('HistoryDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const mockTasks = [
    {
      _id: '1',
      title: 'Task 1',
      status: TaskStatus.IMPLEMENTED,
      commit_hash: 'abcdef123456',
      updated_at: '2026-04-12T10:00:00Z',
      pipeline_id: 'pipeline-1',
      deleted: false,
      version: 1,
      order: 0,
      type: 'manual',
      created_at: '2026-04-12T10:00:00Z',
      history: []
    },
    {
      _id: '2',
      title: 'Task 2',
      status: TaskStatus.CREATED,
      pipeline_id: 'pipeline-1',
      deleted: false,
      version: 1,
      order: 1,
      type: 'manual',
      created_at: '2026-04-12T11:00:00Z',
      history: []
    }
  ];

  it('should render implemented tasks only', () => {
    const dialog = new HistoryDialog(mockTasks as any);
    const dialogElement = dialog['dialog'];
    
    expect(dialogElement.innerHTML).toContain('Task 1');
    expect(dialogElement.innerHTML).not.toContain('Task 2');
    expect(dialogElement.innerHTML).toContain('abcdef1');
  });

  it('should render empty state when no implemented tasks', () => {
    const dialog = new HistoryDialog([mockTasks[1]] as any);
    const dialogElement = dialog['dialog'];
    
    expect(dialogElement.innerHTML).toContain('No history available.');
  });
});
