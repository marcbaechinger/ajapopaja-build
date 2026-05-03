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
import { DataManager } from './DataManager';
import { Task } from './domain';

describe('DataManager Robustness & Complex Events', () => {
  let wsClient: any;
  let dataManager: DataManager;
  let handlers: Map<string, (msg: any) => void>;

  const emit = (type: string, payload: any) => {
    const handler = handlers.get(type);
    if (handler) handler({ type, payload });
  };

  beforeEach(() => {
    handlers = new Map();
    wsClient = {
      on: vi.fn((type: string, handler: any) => {
        handlers.set(type, handler);
      }),
      off: vi.fn()
    };
    dataManager = new DataManager(wsClient);
  });

  it('should notify multiple listeners and allow unsubscription', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    
    const unsub1 = dataManager.on('task:1', cb1);
    dataManager.on('task:1', cb2);

    dataManager.updateTask({ id: '1', pipeline_id: 'p1' });
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);

    unsub1();
    dataManager.updateTask({ id: '1', pipeline_id: 'p1' });
    expect(cb1).toHaveBeenCalledTimes(1); // Still 1
    expect(cb2).toHaveBeenCalledTimes(2); // Now 2
  });

  it('should isolate errors in listeners', () => {
    const cbError = vi.fn(() => { throw new Error('Listener failed'); });
    const cbSuccess = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    dataManager.on('test:query', cbError);
    dataManager.on('test:query', cbSuccess);

    // @ts-ignore - access private notify for test
    dataManager['notify']('test:query', { some: 'data' });

    expect(cbError).toHaveBeenCalled();
    expect(cbSuccess).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error in DataManager listener'), expect.any(Error));
    
    consoleSpy.mockRestore();
  });

  it('should handle complex bot lifecycle events', () => {
    const pipeStatusCb = vi.fn();
    const taskStatusCb = vi.fn();
    const wsEventCb = vi.fn();

    dataManager.on('pipeline:status:p1', pipeStatusCb);
    dataManager.on('task:status:t1', taskStatusCb);
    dataManager.on('ws:DOCBOT_STARTED:p1', wsEventCb);

    emit('DOCBOT_STARTED', { pipeline_id: 'p1', task_id: 't1' });

    expect(pipeStatusCb).toHaveBeenCalledWith({ type: 'DOCBOT_STARTED', payload: { pipeline_id: 'p1', task_id: 't1' } });
    expect(taskStatusCb).toHaveBeenCalledWith({ type: 'DOCBOT_STARTED', payload: { pipeline_id: 'p1', task_id: 't1' } });
    expect(wsEventCb).toHaveBeenCalledWith({ pipeline_id: 'p1', task_id: 't1' });
  });

  it('should handle ARCHBOT_COMPLETED with full task object', () => {
    const taskCb = vi.fn();
    dataManager.on('task:t1', taskCb);

    emit('ARCHBOT_COMPLETED', { id: 't1', pipeline_id: 'p1', design_doc: '# New Design' });

    const task = dataManager.getTask('t1');
    expect(task).toBeInstanceOf(Task);
    expect(task?.design_doc).toBe('# New Design');
    expect(taskCb).toHaveBeenCalled();
  });

  it('should handle TASK_DELETED and notify pipeline', () => {
    dataManager.updateTask({ id: 't1', pipeline_id: 'p1' });
    const taskCb = vi.fn();
    const pipeTasksCb = vi.fn();

    dataManager.on('task:t1', taskCb);
    dataManager.on('pipeline:tasks:p1', pipeTasksCb);

    emit('TASK_DELETED', { task_id: 't1', pipeline_id: 'p1' });

    expect(dataManager.getTask('t1')).toBeUndefined();
    expect(taskCb).toHaveBeenCalledWith(undefined);
    expect(pipeTasksCb).toHaveBeenCalledWith({ id: 't1', deleted: true });
  });

  it('should map _id to id in task and pipeline updates', () => {
    dataManager.updateTask({ _id: 't2', pipeline_id: 'p2', title: 'Task with _id' });
    dataManager.updatePipeline({ _id: 'p2', name: 'Pipe with _id' });

    const task = dataManager.getTask('t2');
    const pipeline = dataManager.getPipeline('p2');

    expect(task).toBeDefined();
    expect(task?.id).toBe('t2');
    expect(pipeline).toBeDefined();
    expect(pipeline?.id).toBe('p2');
  });

  it('should notify specific content queries when task is updated', () => {
    const designCb = vi.fn();
    const reviewCb = vi.fn();

    dataManager.on('task:design:t1', designCb);
    dataManager.on('task:review:t1', reviewCb);

    dataManager.updateTask({ 
      id: 't1', 
      pipeline_id: 'p1', 
      design_doc: '# Design Content',
      review_md: '# Review Content'
    });

    expect(designCb).toHaveBeenCalledWith('# Design Content');
    expect(reviewCb).toHaveBeenCalledWith('# Review Content');
  });
});
