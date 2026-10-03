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
  expandTemplate,
  filterCommands,
  findCommand,
  shouldOfferSlashMenu,
  slashQuery,
} from './slashCommands.ts';

describe('slashCommands', () => {
  describe('shouldOfferSlashMenu', () => {
    it.each(['/', '/cl', '/clear'])('accepts %s', (value) => {
      expect(shouldOfferSlashMenu(value)).toBe(true);
    });

    it.each(['', 'cl', '/clear x', '  /clear', '/c l', '/clear\n'])(
      'rejects %j',
      (value) => {
        expect(shouldOfferSlashMenu(value)).toBe(false);
      }
    );
  });

  describe('slashQuery', () => {
    it('returns the query typed after the leading slash', () => {
      expect(slashQuery('/')).toBe('');
      expect(slashQuery('/cl')).toBe('cl');
      expect(slashQuery('nope')).toBe('');
    });
  });

  describe('filterCommands', () => {
    it('returns all commands of a host for a bare slash, alphabetically', () => {
      const commands = filterCommands('', 'interactive').map((c) => c.command);
      expect(commands).toEqual([...commands].sort());
      expect(commands).toContain('/backlog');
      expect(commands).toContain('/clear');
    });

    it('excludes /close for the interactive host', () => {
      const commands = filterCommands('', 'interactive').map((c) => c.command);
      expect(commands).not.toContain('/close');
      expect(filterCommands('', 'assistant').map((c) => c.command)).toContain('/close');
    });

    it('orders prefix matches before substring matches', () => {
      const commands = filterCommands('c', 'interactive').map((c) => c.command);
      // '/clear' starts with the query; '/backlog' only contains it.
      expect(commands[0]).toBe('/clear');
      expect(commands.indexOf('/backlog')).toBeGreaterThan(commands.indexOf('/clear'));
    });

    it('exposes the interactive-only commands to the interactive host only', () => {
      const interactive = filterCommands('', 'interactive').map((c) => c.command);
      const assistant = filterCommands('', 'assistant').map((c) => c.command);

      expect(interactive).toContain('/backlog');
      expect(interactive).toContain('/pipelines');
      expect(assistant).not.toContain('/backlog');
      expect(assistant).not.toContain('/pipelines');
    });

    it('narrows the matches by the typed query', () => {
      expect(filterCommands('clear', 'assistant').map((c) => c.command)).toEqual(['/clear']);
      expect(filterCommands('does-not-exist', 'assistant')).toEqual([]);
    });
  });

  describe('expandTemplate', () => {
    it('substitutes PIPELINE_ID when an id is known', () => {
      expect(expandTemplate('pipeline PIPELINE_ID', 'abc123')).toBe('pipeline abc123');
    });

    it('leaves the template intact when no id is known', () => {
      expect(expandTemplate('pipeline PIPELINE_ID', null)).toBe('pipeline PIPELINE_ID');
    });
  });

  describe('findCommand', () => {
    it('finds a command by exact token within a host', () => {
      expect(findCommand('/clear', 'interactive')?.type).toBe('action');
      expect(findCommand('/close', 'interactive')).toBeUndefined();
      expect(findCommand('/close', 'assistant')?.type).toBe('action');
    });

    it('scopes the interactive-only commands to the interactive host', () => {
      expect(findCommand('/backlog', 'interactive')?.type).toBe('prompt');
      expect(findCommand('/backlog', 'assistant')).toBeUndefined();
      expect(findCommand('/pipelines', 'interactive')?.type).toBe('prompt');
      expect(findCommand('/pipelines', 'assistant')).toBeUndefined();
    });

    it('does not match a prefix', () => {
      expect(findCommand('/cl', 'assistant')).toBeUndefined();
    });
  });
});
