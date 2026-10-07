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
import { PipelineDetailLayout } from './PipelineDetailLayout.ts';

/** Renders a template string into a detached container for DOM assertions. */
function renderInto(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('PipelineDetailLayout', () => {
  describe('renderShell', () => {
    it('renders every shell mount point and injects the header HTML verbatim', () => {
      const headerHtml = '<div class="mock-header">Header</div>';
      const html = PipelineDetailLayout.renderShell({ headerHtml, sidebarCollapsed: false });

      expect(html).toContain('id="pipeline-header-container"');
      expect(html).toContain('id="backlog-sidebar"');
      expect(html).toContain('id="backlog-view"');
      expect(html).toContain('id="execution-engine-view"');
      expect(html).toContain('id="docbot-dialog-container"');
      expect(html).toContain(headerHtml);
    });

    it('shows the backlog sidebar by default and hides it when collapsed', () => {
      const expanded = renderInto(
        PipelineDetailLayout.renderShell({ sidebarCollapsed: false })
      );
      expect(
        expanded.querySelector('#backlog-sidebar')!.classList.contains('hidden')
      ).toBe(false);

      const collapsed = renderInto(
        PipelineDetailLayout.renderShell({ sidebarCollapsed: true })
      );
      const sidebar = collapsed.querySelector('#backlog-sidebar');
      expect(sidebar).not.toBeNull();
      expect(sidebar!.classList.contains('hidden')).toBe(true);
      expect(sidebar!.className).toContain('hidden');
    });

    it('reflects the collapsed state on the toggle button', () => {
      const collapsed = renderInto(
        PipelineDetailLayout.renderShell({ sidebarCollapsed: true })
      );
      const button = collapsed.querySelector('#backlog-sidebar-toggle') as HTMLElement;
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.getAttribute('title')).toBe('Expand backlog sidebar');

      const expanded = renderInto(
        PipelineDetailLayout.renderShell({ sidebarCollapsed: false })
      );
      const expandedButton = expanded.querySelector('#backlog-sidebar-toggle') as HTMLElement;
      expect(expandedButton.getAttribute('aria-pressed')).toBe('false');
      expect(expandedButton.getAttribute('title')).toBe('Collapse backlog sidebar');
    });

    it('includes a prep column so the content mount points stay reachable', () => {
      const html = PipelineDetailLayout.renderShell({ sidebarCollapsed: false });
      expect(html).toContain('id="pipeline-session-list"');
      expect(html).toContain('id="pull-request-section"');
      expect(html).toContain('id="content-tablist"');
      expect(html).toContain('id="selected-task-view"');
      expect(html).toContain('id="interactive-coding-view-mount"');
      expect(html).toContain('id="file-browser-view-mount"');
      expect(html).toContain('id="history-view-mount"');
    });
  });

  describe('renderPrepColumn', () => {
    it('injects the pull-request section HTML and exposes the content mount points', () => {
      const prHtml = '<section class="mock-pr">My PR</section>';
      const html = PipelineDetailLayout.renderPrepColumn({ pullRequestSectionHtml: prHtml });

      expect(html).toContain('id="pipeline-session-list"');
      expect(html).toContain('id="pull-request-section"');
      expect(html).toContain(prHtml);

      const root = renderInto(html);
      expect(root.querySelector('#pull-request-section')!.innerHTML).toContain('My PR');
      expect(root.querySelector('#selected-task-view')).not.toBeNull();
      expect(root.querySelector('#interactive-coding-view-mount')).not.toBeNull();
      expect(root.querySelector('#file-browser-view-mount')).not.toBeNull();
      expect(root.querySelector('#history-view-mount')).not.toBeNull();
    });
  });

  describe('renderTabList', () => {
    it('renders the four tabs with the Task editor selected by default', () => {
      const html = PipelineDetailLayout.renderTabList();
      const root = renderInto(html);

      const tabIds = ['tab-task-editor', 'tab-coding-agent', 'tab-file-browser', 'tab-history'];
      for (const id of tabIds) {
        expect(root.querySelector(`#${id}`)).not.toBeNull();
      }

      const tabs = root.querySelectorAll('[role="tab"]');
      expect(tabs).toHaveLength(4);
      expect(root.querySelector('#content-tablist')!.getAttribute('role')).toBe('tablist');

      const expectedTabs: Array<[string, string]> = [
        ['tab-task-editor', 'task-editor'],
        ['tab-coding-agent', 'coding-agent'],
        ['tab-file-browser', 'file-browser'],
        ['tab-history', 'history'],
      ];
      for (const [id, contentTab] of expectedTabs) {
        const tab = root.querySelector(`#${id}`) as HTMLElement;
        expect(tab.getAttribute('data-content-tab')).toBe(contentTab);
        expect(tab.getAttribute('data-action-click')).toBe('select_content_tab');
      }

      const selected = Array.from(tabs).filter(
        (tab) => tab.getAttribute('aria-selected') === 'true'
      );
      expect(selected).toHaveLength(1);
      expect(selected[0].id).toBe('tab-task-editor');
    });
  });

  describe('sidebarToggleIcon', () => {
    it('uses a different chevron direction depending on the collapsed state', () => {
      const expanded = PipelineDetailLayout.sidebarToggleIcon(false);
      const collapsed = PipelineDetailLayout.sidebarToggleIcon(true);

      expect(expanded).not.toBe(collapsed);
      expect(expanded).toContain('points="15 18 9 12 15 6"');
      expect(collapsed).toContain('points="9 18 15 12 9 6"');
    });
  });

  describe('applySidebarState', () => {
    function mountShell(): HTMLElement {
      const root = renderInto(
        PipelineDetailLayout.renderShell({ sidebarCollapsed: false })
      );
      document.body.appendChild(root);
      return root;
    }

    it('toggles the hidden class and rewrites the toggle aria/title/icon', () => {
      const root = mountShell();
      const sidebar = root.querySelector('#backlog-sidebar') as HTMLElement;
      const button = root.querySelector('#backlog-sidebar-toggle') as HTMLElement;

      expect(sidebar.classList.contains('hidden')).toBe(false);
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.getAttribute('title')).toBe('Collapse backlog sidebar');
      expect(button.innerHTML).toContain('points="15 18 9 12 15 6"');

      PipelineDetailLayout.applySidebarState(root, true);
      expect(sidebar.classList.contains('hidden')).toBe(true);
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.getAttribute('title')).toBe('Expand backlog sidebar');
      expect(button.innerHTML).toContain('points="9 18 15 12 9 6"');

      PipelineDetailLayout.applySidebarState(root, false);
      expect(sidebar.classList.contains('hidden')).toBe(false);
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.getAttribute('title')).toBe('Collapse backlog sidebar');
      expect(button.innerHTML).toContain('points="15 18 9 12 15 6"');
    });

    it('is safe to call on a fragment without the toggle markup', () => {
      const root = document.createElement('div');
      expect(() => PipelineDetailLayout.applySidebarState(root, true)).not.toThrow();
    });
  });
});
