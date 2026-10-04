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
import { PipelineRoute } from './PipelineRoute.ts';

/** The `rest` the Navigator would capture for the given full hash. */
function restOf(hash: string): string {
  return hash.replace('#/pipeline/p1/', '').replace('#/pipeline/p1', '');
}

describe('PipelineRoute', () => {
  describe('build', () => {
    it('emits the shortest canonical form for every tab', () => {
      expect(PipelineRoute.build('p1', 'task-editor')).toBe('#/pipeline/p1/tab/task');
      expect(PipelineRoute.build('p1', 'coding-agent')).toBe('#/pipeline/p1/tab/agent');
      expect(PipelineRoute.build('p1', 'file-browser', null)).toBe('#/pipeline/p1/tab/fb');
    });

    it('distinguishes "no path" from the explicit repository root', () => {
      expect(PipelineRoute.build('p1', 'file-browser', null)).toBe('#/pipeline/p1/tab/fb');
      expect(PipelineRoute.build('p1', 'file-browser', '')).toBe('#/pipeline/p1/tab/fb/');
    });

    it('encodes every path segment', () => {
      expect(PipelineRoute.build('p1', 'file-browser', 'a/b')).toBe(
        '#/pipeline/p1/tab/fb/a/b'
      );
      expect(PipelineRoute.build('p1', 'file-browser', 'a b/c#d')).toBe(
        '#/pipeline/p1/tab/fb/a%20b/c%23d'
      );
    });

    it('appends the encoded task uid only for the task editor tab', () => {
      expect(PipelineRoute.build('p1', 'task-editor', null, '9876')).toBe(
        '#/pipeline/p1/tab/task/9876'
      );
      expect(PipelineRoute.build('p1', 'task-editor', null, 'a b')).toBe(
        '#/pipeline/p1/tab/task/a%20b'
      );
      // Ignored for other tabs.
      expect(PipelineRoute.build('p1', 'coding-agent', null, '9876')).toBe(
        '#/pipeline/p1/tab/agent'
      );
      expect(PipelineRoute.build('p1', 'file-browser', 'src', '9876')).toBe(
        '#/pipeline/p1/tab/fb/src'
      );
      // Empty / omitted uid emits the bare task-editor form.
      expect(PipelineRoute.build('p1', 'task-editor', null, '')).toBe(
        '#/pipeline/p1/tab/task'
      );
    });
  });

  describe('parse', () => {
    it('falls back to the task editor for missing or unknown input', () => {
      for (const rest of ['', undefined, null, 'garbage', 'tab', 'tab/garbage']) {
        expect(PipelineRoute.parse(rest as any)).toEqual({
          tab: 'task-editor',
          fbPath: null,
          taskId: null,
        });
      }
    });

    it('parses each tab slug', () => {
      expect(PipelineRoute.parse('tab/task')).toEqual({
        tab: 'task-editor',
        fbPath: null,
        taskId: null,
      });
      expect(PipelineRoute.parse('tab/agent')).toEqual({
        tab: 'coding-agent',
        fbPath: null,
        taskId: null,
      });
      expect(PipelineRoute.parse('tab/fb')).toEqual({
        tab: 'file-browser',
        fbPath: null,
        taskId: null,
      });
    });

    it('parses the trailing task uid for the task editor tab', () => {
      expect(PipelineRoute.parse('tab/task/9876')).toEqual({
        tab: 'task-editor',
        fbPath: null,
        taskId: '9876',
      });
      // A missing uid (incl. trailing slash) means "no explicit selection".
      expect(PipelineRoute.parse('tab/task/').taskId).toBeNull();
      // Decoded per segment; other tabs never populate a task uid.
      expect(PipelineRoute.parse('tab/task/a%20b').taskId).toBe('a b');
      expect(PipelineRoute.parse('tab/agent/9876').taskId).toBeNull();
      expect(PipelineRoute.parse('tab/fb/9876').taskId).toBeNull();
    });

    it('decodes the trailing file-browser path per segment', () => {
      expect(PipelineRoute.parse('tab/fb/a/b')).toEqual({
        tab: 'file-browser',
        fbPath: 'a/b',
        taskId: null,
      });
      expect(PipelineRoute.parse('tab/fb/a/index.html')).toEqual({
        tab: 'file-browser',
        fbPath: 'a/index.html',
        taskId: null,
      });
      expect(PipelineRoute.parse('tab/fb/a%20b/c%23d')).toEqual({
        tab: 'file-browser',
        fbPath: 'a b/c#d',
        taskId: null,
      });
      expect(PipelineRoute.parse('tab/fb/%E2%9C%93')).toEqual({
        tab: 'file-browser',
        fbPath: '✓',
        taskId: null,
      });
    });

    it('distinguishes the explicit root (trailing slash) from "no path"', () => {
      expect(PipelineRoute.parse('tab/fb').fbPath).toBeNull();
      expect(PipelineRoute.parse('tab/fb/').fbPath).toBe('');
    });

    it('never throws on a malformed escape and keeps the raw segment', () => {
      expect(PipelineRoute.parse('tab/fb/%')).toEqual({
        tab: 'file-browser',
        fbPath: '%',
        taskId: null,
      });
      expect(PipelineRoute.parse('tab/fb/%zz')).toEqual({
        tab: 'file-browser',
        fbPath: '%zz',
        taskId: null,
      });
    });

    it('round-trips every build form', () => {
      const cases: Array<
        [Parameters<typeof PipelineRoute.build>[1], string | null, (string | null)?]
      > = [
        ['task-editor', null],
        ['task-editor', null, '9876'],
        ['task-editor', null, 'a b'],
        ['coding-agent', null],
        ['file-browser', null],
        ['file-browser', ''],
        ['file-browser', 'a/b'],
        ['file-browser', 'a b/c#d'],
      ];
      for (const [tab, fbPath, taskId] of cases) {
        const parsed = PipelineRoute.parse(
          restOf(PipelineRoute.build('p1', tab, fbPath, taskId))
        );
        expect(parsed.tab).toBe(tab);
        if (tab === 'file-browser' && fbPath !== null) {
          expect(parsed.fbPath).toBe(fbPath);
        } else {
          expect(parsed.fbPath).toBeNull();
        }
        expect(parsed.taskId).toBe(tab === 'task-editor' && taskId ? taskId : null);
      }
    });
  });
});
