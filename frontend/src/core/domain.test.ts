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
import {
  Task,
  TaskStatus,
  Pipeline,
  PipelineStatus,
  CommitDiff,
  AppNotification,
  NotificationType,
  NotificationSeverity,
  isProcessedStatus,
  PullRequest,
  PullRequestKind,
  PullRequestStatus,
} from './domain';

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

  describe('isProcessedStatus', () => {
    it('should include the processed states', () => {
      for (const status of [
        TaskStatus.IMPLEMENTED,
        TaskStatus.PULL_REQUEST_AVAILABLE,
        TaskStatus.SUBMITTED,
        TaskStatus.DISCARDED,
        TaskStatus.FAILED,
      ]) {
        expect(isProcessedStatus(status)).toBe(true);
      }
    });

    it('should exclude states where the implementation interval is not finished', () => {
      for (const status of [
        TaskStatus.CREATED,
        TaskStatus.SCHEDULED,
        TaskStatus.PROPOSED,
        TaskStatus.INPROGRESS,
      ]) {
        expect(isProcessedStatus(status)).toBe(false);
      }
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

    it('should map the build_artifact declaration', () => {
      const pipeline = new Pipeline({
        name: 'Android',
        build_artifact: {
          path: 'app/build/outputs/apk/debug/app-debug.apk',
          label: 'Debug APK',
          description: 'Installable debug build',
          media_type: 'application/vnd.android.package-archive',
        },
      });

      expect(pipeline.build_artifact).toMatchObject({
        path: 'app/build/outputs/apk/debug/app-debug.apk',
        label: 'Debug APK',
        description: 'Installable debug build',
        media_type: 'application/vnd.android.package-archive',
      });
    });

    it('should preserve an empty build_artifact declaration as null', () => {
      const pipeline = new Pipeline({ name: 'No artifact', build_artifact: null });
      expect(pipeline.build_artifact).toBeNull();
    });
  });

  describe('AppNotification', () => {
    it('should normalize a full raw payload', () => {
      const notification = new AppNotification({
        id: 'n-1',
        type: 'actions',
        severity: 'warning',
        title: 'Pick one',
        message: 'Choose an action',
        dismissible: true,
        created_at: '2026-01-01T00:00:00+00:00',
        actions: [
          { name: 'noop', label: 'Do nothing', data: { x: 1 }, style: 'primary' },
        ],
      });

      expect(notification.id).toBe('n-1');
      expect(notification.type).toBe(NotificationType.ACTIONS);
      expect(notification.severity).toBe(NotificationSeverity.WARNING);
      expect(notification.title).toBe('Pick one');
      expect(notification.message).toBe('Choose an action');
      expect(notification.dismissible).toBe(true);
      expect(notification.created_at).toBe('2026-01-01T00:00:00+00:00');
      expect(notification.actions).toHaveLength(1);
      expect(notification.actions[0].name).toBe('noop');
      expect(notification.actions[0].label).toBe('Do nothing');
      expect(notification.actions[0].data).toEqual({ x: 1 });
      expect(notification.actions[0].style).toBe('primary');
    });

    it('should fall back to safe defaults for missing/invalid fields', () => {
      const notification = new AppNotification({ title: 'Only title' });

      expect(notification.id).toBe('');
      expect(notification.type).toBe(NotificationType.MESSAGE);
      expect(notification.severity).toBe(NotificationSeverity.NORMAL);
      expect(notification.title).toBe('Only title');
      expect(notification.message).toBe('');
      expect(notification.actions).toEqual([]);
      expect(notification.dismissible).toBe(true);
    });

    it('should ignore invalid type/severity values', () => {
      const notification = new AppNotification({
        type: 'nonsense',
        severity: 'nonsense',
      });

      expect(notification.type).toBe(NotificationType.MESSAGE);
      expect(notification.severity).toBe(NotificationSeverity.NORMAL);
    });

    it('should normalize action entries defensively', () => {
      const notification = new AppNotification({
        actions: [{ name: 'a' }, {}],
      });

      expect(notification.actions[0].name).toBe('a');
      expect(notification.actions[0].label).toBe('');
      expect(notification.actions[0].data).toEqual({});
      expect(notification.actions[0].style).toBe('default');
      expect(notification.actions[1].name).toBe('');
    });
  });

  describe('PullRequest patch', () => {
    it('maps a null patch to an empty string', () => {
      const pr = new PullRequest({ patch: null });
      expect(pr.patch).toBe('');
    });

    it('maps a missing patch to an empty string', () => {
      const pr = new PullRequest({});
      expect(pr.patch).toBe('');
    });

    it('keeps a present patch as a string', () => {
      const patch = 'diff --git a/a.txt b/a.txt\n';
      const pr = new PullRequest({ patch });
      expect(pr.patch).toBe(patch);
    });

    it('keeps a terminal status for a completed pull request', () => {
      const pr = new PullRequest({ status: PullRequestStatus.ACCEPTED, patch: null });
      expect(pr.status).toBe(PullRequestStatus.ACCEPTED);
      expect(pr.patch).toBe('');
    });
  });

  describe('PullRequest kind and commit hash', () => {
    it('defaults to implementation and no commit hash', () => {
      const pr = new PullRequest({});
      expect(pr.kind).toBe(PullRequestKind.IMPLEMENTATION);
      expect(pr.commit_hash).toBeUndefined();
    });

    it('preserves an explicit documentation kind and commit hash', () => {
      const pr = new PullRequest({
        kind: PullRequestKind.DOCUMENTATION,
        commit_hash: 'abc123',
      });
      expect(pr.kind).toBe(PullRequestKind.DOCUMENTATION);
      expect(pr.commit_hash).toBe('abc123');
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
