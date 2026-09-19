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
import { Task, TaskStatus, Pipeline, PipelineStatus, CommitDiff } from './domain';

describe('Domain Models', () => {
  describe('Task', () => {
    it('should instantiate from valid JSON', () => {
      const json = {
        _id: 'task-1',
        title: 'Test Task',
        status: 'inprogress',
        version: 5,
        history: [
          { to_status: 'created', timestamp: '2026-01-01', by: 'user' }
        ]
      };
      const task = new Task(json);
      expect(task.id).toBe('task-1');
      expect(task.title).toBe('Test Task');
      expect(task.status).toBe(TaskStatus.INPROGRESS);
      expect(task.version).toBe(5);
      expect(task.history).toHaveLength(1);
      expect(task.history[0].to_status).toBe(TaskStatus.CREATED);
    });

    it('should handle missing fields with defaults', () => {
      const task = new Task({ title: 'Minimal' });
      expect(task.title).toBe('Minimal');
      expect(task.status).toBe(TaskStatus.CREATED);
      expect(task.version).toBe(1);
      expect(task.history).toEqual([]);
    });

    it('should validate status and fallback to default if invalid', () => {
      // @ts-ignore
      const task = new Task({ title: 'Invalid Status', status: 'junk' });
      // New behavior: it should stay at default CREATED because 'junk' is not valid
      expect(task.status).toBe(TaskStatus.CREATED); 
    });

    it('should validate history transitions', () => {
      const json = {
        history: [
          { to_status: 'inprogress', timestamp: '2026-01-01', by: 'mcp' },
          { to_status: 'junk', timestamp: '2026-01-02', by: 'system' }
        ]
      };
      const task = new Task(json);
      expect(task.history[0].to_status).toBe(TaskStatus.INPROGRESS);
      expect(task.history[1].to_status).toBe(TaskStatus.CREATED); // fallback for invalid
    });
  });

  describe('Pipeline', () => {
    it('should instantiate from valid JSON', () => {
      const json = {
        _id: 'pipe-1',
        name: 'Test Pipeline',
        status: 'active'
      };
      const pipeline = new Pipeline(json);
      expect(pipeline.id).toBe('pipe-1');
      expect(pipeline.name).toBe('Test Pipeline');
      expect(pipeline.status).toBe(PipelineStatus.ACTIVE);
    });

    it('should validate status and fallback to default if invalid', () => {
      // @ts-ignore
      const pipeline = new Pipeline({ name: 'Invalid Status', status: 'junk' });
      expect(pipeline.status).toBe(PipelineStatus.ACTIVE); 
    });
  });

  describe('CommitDiff', () => {
    it('should instantiate from valid JSON', () => {
      const diff = new CommitDiff({
        commit_hash: 'abc123',
        patch: 'diff --git a/a.txt b/a.txt\n',
        subject: 'Add a',
        author: 'Alice',
        created_at: '2026-01-01T00:00:00+00:00'
      });
      expect(diff.commit_hash).toBe('abc123');
      expect(diff.patch).toContain('a.txt');
      expect(diff.subject).toBe('Add a');
      expect(diff.author).toBe('Alice');
      expect(diff.created_at).toBe('2026-01-01T00:00:00+00:00');
    });

    it('should fall back to safe defaults for missing fields', () => {
      const diff = new CommitDiff({});
      expect(diff.commit_hash).toBe('');
      expect(diff.patch).toBe('');
      expect(diff.subject).toBeUndefined();
    });
  });
});
