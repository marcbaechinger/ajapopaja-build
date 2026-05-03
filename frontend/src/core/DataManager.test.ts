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
import { Task, Pipeline } from './domain';

describe('DataManager', () => {
  let wsClient: any;
  let dataManager: DataManager;
  let handlers: Map<string, (msg: any) => void>;

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

  it('should initialize and register websocket handlers', () => {
    expect(wsClient.on).toHaveBeenCalledWith('TASK_UPDATED', expect.any(Function));
    expect(wsClient.on('TASK_CREATED', expect.any(Function))).toBeUndefined();
    expect(handlers.has('TASK_UPDATED')).toBe(true);
  });

  it('should cache and notify on task update', () => {
    const callback = vi.fn();
    dataManager.on('task:123', callback);

    const taskData = { id: '123', title: 'Test Task', pipeline_id: 'p1' };
    dataManager.updateTask(taskData);

    expect(dataManager.getTask('123')).toBeInstanceOf(Task);
    expect(dataManager.getTask('123')?.title).toBe('Test Task');
    expect(callback).toHaveBeenCalled();
  });

  it('should notify pipeline:tasks query on task update', () => {
    const callback = vi.fn();
    dataManager.on('pipeline:tasks:p1', callback);

    dataManager.updateTask({ id: '123', pipeline_id: 'p1' });

    expect(callback).toHaveBeenCalled();
  });

  it('should handle WebSocket TASK_UPDATED', () => {
    const callback = vi.fn();
    dataManager.on('task:456', callback);

    const handler = handlers.get('TASK_UPDATED');
    expect(handler).toBeDefined();

    handler!({ type: 'TASK_UPDATED', payload: { id: '456', title: 'WS Task' } });

    expect(dataManager.getTask('456')?.title).toBe('WS Task');
    expect(callback).toHaveBeenCalled();
  });

  it('should handle task removal', () => {
    dataManager.updateTask({ id: '789', pipeline_id: 'p1' });
    const callback = vi.fn();
    dataManager.on('task:789', callback);

    dataManager.removeTask('789');

    expect(dataManager.getTask('789')).toBeUndefined();
    expect(callback).toHaveBeenCalled();
  });

  it('should handle pipeline updates', () => {
    const callback = vi.fn();
    dataManager.on('pipeline:p1', callback);

    dataManager.updatePipeline({ id: 'p1', name: 'Test Pipeline' });

    expect(dataManager.getPipeline('p1')?.name).toBe('Test Pipeline');
    expect(callback).toHaveBeenCalled();
  });
});
