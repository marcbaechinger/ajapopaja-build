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

import { describe, it, expect, vi } from 'vitest';
import { PipelineSubRoute } from './PipelineSubRoute.ts';

/** Minimal injectable `Location` stand-in: a plain mutable `hash` property. */
function fakeLocation(hash = ''): Location {
  return { hash } as Location;
}

/** Minimal injectable `History` stand-in that records `replaceState` calls. */
function fakeHistory(): History & { replaceState: ReturnType<typeof vi.fn> } {
  return { replaceState: vi.fn() } as unknown as History & {
    replaceState: ReturnType<typeof vi.fn>;
  };
}

describe('PipelineSubRoute', () => {
  describe('parse', () => {
    it('delegates to the pure PipelineRoute parser', () => {
      const sub = new PipelineSubRoute('p1', fakeLocation(), fakeHistory());
      expect(sub.parse('tab/task/abc')).toEqual({
        tab: 'task-editor',
        taskId: 'abc',
        fbPath: null,
      });
    });
  });

  describe('build', () => {
    it('builds the explicit repository root form', () => {
      const sub = new PipelineSubRoute('p1', fakeLocation(), fakeHistory());
      expect(sub.build('file-browser', '', null)).toBe('#/pipeline/p1/tab/fb/');
    });
  });

  describe('write', () => {
    it('does nothing for mode "none"', () => {
      const loc = fakeLocation('');
      const hist = fakeHistory();
      const sub = new PipelineSubRoute('p1', loc, hist);

      sub.write('none', '#/pipeline/p1/tab/task');

      expect(loc.hash).toBe('');
      expect(hist.replaceState).not.toHaveBeenCalled();
    });

    it('is a no-op when pushing the current hash', () => {
      const loc = fakeLocation('#/pipeline/p1/tab/task');
      const hist = fakeHistory();
      const sub = new PipelineSubRoute('p1', loc, hist);

      sub.write('push', '#/pipeline/p1/tab/task');

      expect(loc.hash).toBe('#/pipeline/p1/tab/task');
      expect(hist.replaceState).not.toHaveBeenCalled();
    });

    it('push sets location.hash and never calls replaceState', () => {
      const loc = fakeLocation('');
      const hist = fakeHistory();
      const sub = new PipelineSubRoute('p1', loc, hist);

      sub.write('push', '#/pipeline/p1/tab/fb');

      expect(loc.hash).toBe('#/pipeline/p1/tab/fb');
      expect(hist.replaceState).not.toHaveBeenCalled();
    });

    it('replace calls replaceState and leaves location.hash untouched', () => {
      const loc = fakeLocation('#/pipeline/p1/tab/task');
      const hist = fakeHistory();
      const sub = new PipelineSubRoute('p1', loc, hist);

      sub.write('replace', '#/pipeline/p1/tab/fb');

      expect(hist.replaceState).toHaveBeenCalledWith(null, '', '#/pipeline/p1/tab/fb');
      expect(loc.hash).toBe('#/pipeline/p1/tab/task');
    });
  });

  describe('canonicalise', () => {
    it('is a no-op when the hash already matches', () => {
      const loc = fakeLocation('#/pipeline/p1/tab/task');
      const hist = fakeHistory();
      const sub = new PipelineSubRoute('p1', loc, hist);

      sub.canonicalise('#/pipeline/p1/tab/task');

      expect(hist.replaceState).not.toHaveBeenCalled();
    });

    it('replaces the hash when it differs', () => {
      const loc = fakeLocation('');
      const hist = fakeHistory();
      const sub = new PipelineSubRoute('p1', loc, hist);

      sub.canonicalise('#/pipeline/p1/tab/task');

      expect(hist.replaceState).toHaveBeenCalledWith(null, '', '#/pipeline/p1/tab/task');
    });

    it('swallows a throwing replaceState', () => {
      const loc = fakeLocation('');
      const hist = {
        replaceState: vi.fn(() => {
          throw new Error('hash-only URL');
        }),
      } as unknown as History;
      const sub = new PipelineSubRoute('p1', loc, hist);

      expect(() => sub.canonicalise('#/pipeline/p1/tab/task')).not.toThrow();
    });
  });
});
