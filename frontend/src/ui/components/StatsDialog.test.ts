import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatsDialog } from './StatsDialog.ts';
import { PipelineStatsView } from './PipelineStatsView.ts';

describe('StatsDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const mockTasks = [
    {
      _id: '1',
      title: 'Task 1',
      status: 'implemented',
      pipeline_id: 'p1',
      deleted: false,
      created_at: '2026-04-12T10:00:00Z',
      updated_at: '2026-04-12T10:30:00Z',
      history: [{ to_status: 'implemented', timestamp: '2026-04-12T10:30:00Z' }]
    }
  ];

  it('should render PipelineStatsView content', () => {
    const renderSpy = vi.spyOn(PipelineStatsView, 'render').mockReturnValue('<div id="stats">Stats Content</div>');
    
    const dialog = new StatsDialog(mockTasks as any);
    const dialogElement = dialog['dialog'];
    
    expect(renderSpy).toHaveBeenCalledWith(mockTasks);
    expect(dialogElement.querySelector('#stats')?.textContent).toBe('Stats Content');
    
    renderSpy.mockRestore();
  });

  it('should call animateBars on show', async () => {
    const animateSpy = vi.spyOn(PipelineStatsView, 'animateBars').mockImplementation(() => {});
    const dialog = new StatsDialog(mockTasks as any);
    const dialogElement = dialog['dialog'];
    
    dialogElement.showModal = vi.fn();
    dialogElement.close = vi.fn();
    
    const showPromise = dialog.show();
    
    expect(animateSpy).toHaveBeenCalledWith(dialogElement);
    
    dialog['close']();
    await showPromise;
    
    animateSpy.mockRestore();
  });
});
