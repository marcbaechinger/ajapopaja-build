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
import { StatsDialog } from './StatsDialog.ts';
import { PipelineStatsView } from './PipelineStatsView.ts';

describe('StatsDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const mockTasks = [
    {
      id: '1',
      title: 'Task 1',
      status: 'implemented',
      pipeline_id: 'p1',
      deleted: false,
      created_at: '2026-04-12T10:00:00Z',
      updated_at: '2026-04-12T10:30:00Z',
      history: [{ to_status: 'implemented', timestamp: '2026-04-12T10:30:00Z' }]
    }
  ];

  const mockPipelineClient = {
    getDailyStats: vi.fn().mockResolvedValue([])
  } as any;

  it('should render PipelineStatsView content', () => {
    const renderSpy = vi.spyOn(PipelineStatsView, 'render').mockReturnValue('<div id="stats">Stats Content</div>');
    
    const dialog = new StatsDialog(mockTasks as any, 'p1', mockPipelineClient);
    const dialogElement = dialog['dialog'];
    
    expect(renderSpy).toHaveBeenCalledWith(mockTasks, []);
    expect(dialogElement.querySelector('#stats')?.textContent).toBe('Stats Content');
    
    renderSpy.mockRestore();
  });

  it('should call animateBars on show', async () => {
    const animateSpy = vi.spyOn(PipelineStatsView, 'animateBars').mockImplementation(() => {});
    const dialog = new StatsDialog(mockTasks as any, 'p1', mockPipelineClient);
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
