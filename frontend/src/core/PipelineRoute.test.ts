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
  });

  describe('parse', () => {
    it('falls back to the task editor for missing or unknown input', () => {
      for (const rest of ['', undefined, null, 'garbage', 'tab', 'tab/garbage']) {
        expect(PipelineRoute.parse(rest as any)).toEqual({
          tab: 'task-editor',
          fbPath: null,
        });
      }
    });

    it('parses each tab slug', () => {
      expect(PipelineRoute.parse('tab/task')).toEqual({
        tab: 'task-editor',
        fbPath: null,
      });
      expect(PipelineRoute.parse('tab/agent')).toEqual({
        tab: 'coding-agent',
        fbPath: null,
      });
      expect(PipelineRoute.parse('tab/fb')).toEqual({
        tab: 'file-browser',
        fbPath: null,
      });
    });

    it('decodes the trailing file-browser path per segment', () => {
      expect(PipelineRoute.parse('tab/fb/a/b')).toEqual({
        tab: 'file-browser',
        fbPath: 'a/b',
      });
      expect(PipelineRoute.parse('tab/fb/a/index.html')).toEqual({
        tab: 'file-browser',
        fbPath: 'a/index.html',
      });
      expect(PipelineRoute.parse('tab/fb/a%20b/c%23d')).toEqual({
        tab: 'file-browser',
        fbPath: 'a b/c#d',
      });
      expect(PipelineRoute.parse('tab/fb/%E2%9C%93')).toEqual({
        tab: 'file-browser',
        fbPath: '✓',
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
      });
      expect(PipelineRoute.parse('tab/fb/%zz')).toEqual({
        tab: 'file-browser',
        fbPath: '%zz',
      });
    });

    it('round-trips every build form', () => {
      const cases: Array<[Parameters<typeof PipelineRoute.build>[1], string | null]> = [
        ['task-editor', null],
        ['coding-agent', null],
        ['file-browser', null],
        ['file-browser', ''],
        ['file-browser', 'a/b'],
        ['file-browser', 'a b/c#d'],
      ];
      for (const [tab, fbPath] of cases) {
        const parsed = PipelineRoute.parse(restOf(PipelineRoute.build('p1', tab, fbPath)));
        expect(parsed.tab).toBe(tab);
        if (tab === 'file-browser' && fbPath !== null) {
          expect(parsed.fbPath).toBe(fbPath);
        } else {
          expect(parsed.fbPath).toBeNull();
        }
      }
    });
  });
});
