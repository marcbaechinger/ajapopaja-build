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
import { PullRequestSection } from './PullRequestSection.ts';
import { PullRequest, PullRequestStatus } from '../../core/domain.ts';

// Mock the Icon module
vi.mock('./Icon.ts', () => ({
  Icon: {
    render: vi.fn((icon: string, options?: { size?: number; className?: string; label?: string; dataAttrs?: Record<string, string> }) => {
      const sizeClass = options?.size === 14 ? 'w-[14px] h-[14px]' :
                       options?.size === 18 ? 'w-[18px] h-[18px]' :
                       'w-4 h-4';
      return `<svg class="${sizeClass}" xmlns="http://www.w3.org/2000/svg"><use href="/icons.svg#${icon}-icon" /></svg>`;
    })
  }
}));

describe('PullRequestSection', () => {
  const createPr = (overrides?: Partial<PullRequest>) => {
    const pr = new PullRequest({
      _id: 'pr1',
      pipeline_id: 'pip1',
      task_id: 'task1',
      summary: 'Test PR',
      branch_name: 'feature/test-branch',
      patch: 'test-patch',
      status: PullRequestStatus.OPEN,
      created_at: '2024-01-15T10:00:00Z'
    });
    Object.assign(pr, overrides);
    return pr;
  };

  it('should return empty string when no pull requests are provided', () => {
    const html = PullRequestSection.render([]);
    expect(html).toBe('');
  });

  it('should return empty string when no open pull requests are provided', () => {
    const prs = [
      createPr({ status: PullRequestStatus.ACCEPTED }),
      createPr({ status: PullRequestStatus.REJECTED }),
      createPr({ status: PullRequestStatus.ACCEPTED })
    ];
    const html = PullRequestSection.render(prs);
    expect(html).toBe('');
  });

  it('should render the section when open pull requests are provided', () => {
    const prs = [createPr()];
    const html = PullRequestSection.render(prs);
    
    expect(html).toContain('class="mb-10 bg-app-accent-2/5');
    expect(html).toContain('Pull Requests');
    expect(html).toContain('Awaiting Review');
    expect(html).toContain('1'); // count badge
  });

  it('should filter only open pull requests', () => {
    const prs = [
      createPr({ status: PullRequestStatus.OPEN, summary: 'Open PR 1' }),
      createPr({ status: PullRequestStatus.ACCEPTED, summary: 'Accepted PR' }),
      createPr({ status: PullRequestStatus.OPEN, summary: 'Open PR 2' }),
      createPr({ status: PullRequestStatus.REJECTED, summary: 'Rejected PR' })
    ];
    const html = PullRequestSection.render(prs);
    
    expect(html).toContain('Open PR 1');
    expect(html).toContain('Open PR 2');
    expect(html).not.toContain('Accepted PR');
    expect(html).not.toContain('Rejected PR');
    expect(html).toContain('2'); // count badge should be 2
  });

  it('should sort pull requests by created_at in ascending order', () => {
    const prs = [
      createPr({ summary: 'Latest PR', created_at: '2024-01-20T10:00:00Z' }),
      createPr({ summary: 'Oldest PR', created_at: '2024-01-10T10:00:00Z' }),
      createPr({ summary: 'Middle PR', created_at: '2024-01-15T10:00:00Z' })
    ];
    const html = PullRequestSection.render(prs);
    
    // Check that items appear in chronological order (oldest first)
    const oldestIndex = html.indexOf('Oldest PR');
    const middleIndex = html.indexOf('Middle PR');
    const latestIndex = html.indexOf('Latest PR');
    
    expect(oldestIndex).toBeLessThan(middleIndex);
    expect(middleIndex).toBeLessThan(latestIndex);
  });

  it('should handle null/undefined created_at dates', () => {
    const prs = [
      createPr({ summary: 'PR with date', created_at: '2024-01-15T10:00:00Z' }),
      createPr({ summary: 'PR without date', created_at: undefined }),
      createPr({ summary: 'PR with null date', created_at: null })
    ];
    // Should not throw an error
    const html = PullRequestSection.render(prs);
    expect(html).toContain('PR with date');
    expect(html).toContain('PR without date');
    expect(html).toContain('PR with null date');
  });

  it('should render correct data attributes for the review button', () => {
    const pr = createPr({ 
      id: 'pr-123', 
      task_id: 'task-456',
      summary: 'Test PR',
      branch_name: 'feature/branch'
    });
    const html = PullRequestSection.render([pr]);
    
    expect(html).toContain('data-action-click="open_pr_dialog"');
    expect(html).toContain('data-task-id="task-456"');
    expect(html).toContain('data-pr-id="pr-123"');
  });

  it('should render the pull request summary and branch name', () => {
    const pr = createPr({ 
      summary: 'Fix bug in authentication',
      branch_name: 'fix/auth-bug'
    });
    const html = PullRequestSection.render([pr]);
    
    expect(html).toContain('Fix bug in authentication');
    expect(html).toContain('branch: fix/auth-bug');
  });

  it('should use truncation class for summary to handle long titles', () => {
    const pr = createPr({ summary: 'Very long title that should be truncated if it exceeds the container width' });
    const html = PullRequestSection.render([pr]);
    
    expect(html).toContain('class="font-bold text-app-text mb-1 truncate"');
  });

  it('should render with correct badge showing count of open PRs', () => {
    const prs = [
      createPr({ summary: 'PR 1' }),
      createPr({ summary: 'PR 2' }),
      createPr({ summary: 'PR 3' }),
      createPr({ summary: 'PR 4' })
    ];
    const html = PullRequestSection.render(prs);
    
    expect(html).toContain('>4<'); // count badge with value 4
  });

  it('should include review button with correct styling', () => {
    const pr = createPr();
    const html = PullRequestSection.render([pr]);
    
    expect(html).toContain('class="px-4 py-2 bg-app-accent-2 text-white');
    expect(html).toContain('Review');
    expect(html).toContain('hover:bg-app-accent-2/80');
    expect(html).toContain('cursor-pointer');
  });

  it('should render multiple pull requests in separate card containers', () => {
    const prs = [
      createPr({ summary: 'PR 1', branch_name: 'feature/1' }),
      createPr({ summary: 'PR 2', branch_name: 'feature/2' })
    ];
    const html = PullRequestSection.render(prs);
    
    // Should have two separate PR container divs
    const containerPattern = /class="bg-app-surface border border-app-border rounded-2xl p-4 shadow-sm group hover:border-app-accent-2\/40 transition-all duration-300"/g;
    const matches = html.match(containerPattern);
    expect(matches).toHaveLength(2);
  });

  it('should render the header icon', () => {
    const html = PullRequestSection.render([createPr()]);
    
    expect(html).toContain('git-pull-request');
    expect(html).toContain('p-2 bg-app-accent-2/20 rounded-xl text-app-accent-2');
  });

  it('should have proper styling for the section container', () => {
    const html = PullRequestSection.render([createPr()]);
    
    expect(html).toContain('rounded-3xl p-6');
    expect(html).toContain('bg-app-accent-2/5');
    expect(html).toContain('border-app-accent-2/20');
  });
});
