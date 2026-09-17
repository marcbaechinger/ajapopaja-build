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
import { PullRequestSection } from './PullRequestSection.ts';
import { PullRequest, PullRequestStatus } from '../../core/domain.ts';

describe('PullRequestSection', () => {
  const makePr = (overrides: any = {}): PullRequest => new PullRequest({
    _id: 'pr1',
    pipeline_id: 'p1',
    task_id: 't1',
    summary: 'summary',
    subject: 'task subject',
    branch_name: 'feature/x',
    patch: 'diff',
    status: PullRequestStatus.OPEN,
    created_at: '2026-04-12T10:00:00Z',
    ...overrides
  });

  it('includes only OPEN items as awaiting review', () => {
    const prs = [
      makePr({ _id: 'a', status: PullRequestStatus.SUBMITTED, remote_pr_url: 'https://host/o/r/pulls/1' }),
      makePr({ _id: 'b', status: PullRequestStatus.OPEN, apply_mode: 'merge' }),
      makePr({ _id: 'c', status: PullRequestStatus.ACCEPTED }),
      makePr({ _id: 'd', status: PullRequestStatus.REJECTED })
    ];
    const html = PullRequestSection.render(prs);
    expect(html).toContain('task subject');
    expect(html).toContain('Review');
    expect(html).toContain('Merge');
    // Submitted, accepted and rejected are not shown.
    expect(html).not.toContain('REJECTED');
  });

  it('labels the accept action according to how the PR will be applied', () => {
    // Local workspace -> merge
    const mergeHtml = PullRequestSection.render([makePr({ apply_mode: 'merge' })]);
    expect(mergeHtml).toContain('Merge');
    // Committed + pushed to the remote -> push
    const pushHtml = PullRequestSection.render([makePr({ apply_mode: 'push' })]);
    expect(pushHtml).toContain('Push');
    expect(pushHtml).not.toContain('Merge');
    // Committed + sent as a pull request -> submit
    const submitHtml = PullRequestSection.render([makePr({ apply_mode: 'submit' })]);
    expect(submitHtml).toContain('Submit');
    expect(submitHtml).not.toContain('Merge');
  });

  it('renders an Accept button with the expected action and data attributes for OPEN PRs', () => {
    const html = PullRequestSection.render([makePr()]);
    expect(html).toContain('data-action-click="accept_pr"');
    expect(html).toContain('data-pr-id="pr1"');
    expect(html).toContain('data-task-id="t1"');
    // Accept button is placed before Review
    const acceptIndex = html.indexOf('data-action-click="accept_pr"');
    const reviewIndex = html.indexOf('open_pr_dialog');
    expect(acceptIndex).toBeGreaterThan(-1);
    expect(reviewIndex).toBeGreaterThan(acceptIndex);
  });

  it('renders an Iterate button with the expected action and data attributes for OPEN PRs', () => {
    const html = PullRequestSection.render([makePr()]);
    expect(html).toContain('data-action-click="iterate_pr"');
    expect(html).toContain('data-pr-id="pr1"');
    expect(html).toContain('data-task-id="t1"');
    expect(html).toContain('Iterate');
    // Iterate button is placed before Review
    const iterateIndex = html.indexOf('data-action-click="iterate_pr"');
    const reviewIndex = html.indexOf('open_pr_dialog');
    expect(iterateIndex).toBeGreaterThan(-1);
    expect(reviewIndex).toBeGreaterThan(iterateIndex);
  });

  it('renders no Accept button when there are no OPEN PRs', () => {
    const html = PullRequestSection.render([makePr({ status: PullRequestStatus.SUBMITTED, remote_pr_url: 'https://host/o/r/pull/1' })]);
    expect(html).toBe('');
  });

  it('omits SUBMITTED PRs from the list', () => {
    const prs = [
      makePr({ _id: 'a', status: PullRequestStatus.OPEN, subject: 'open-one' }),
      makePr({ _id: 'b', status: PullRequestStatus.SUBMITTED, subject: 'submitted-one' })
    ];
    const html = PullRequestSection.render(prs);
    expect(html).toContain('open-one');
    expect(html).not.toContain('submitted-one');
    // No Submitted badge is rendered.
    expect(html).not.toContain('Submitted');
  });

  it('returns empty when there are no awaiting-review PRs', () => {
    const prs = [
      makePr({ _id: 'c', status: PullRequestStatus.ACCEPTED })
    ];
    expect(PullRequestSection.render(prs)).toBe('');
  });

  it('renders a toggle for the PR summary that is initially hidden', () => {
    const html = PullRequestSection.render([makePr({ summary: 'A detailed summary of the changes.' })]);
    // A toggle control exists.
    expect(html).toContain('data-action-click="toggle_pr_summary"');
    // The summary content is initially hidden.
    expect(html).toContain('pr-summary hidden');
    expect(html).not.toBe('');
  });

  it('renders the summary as sanitized Markdown inside the hidden container', () => {
    const html = PullRequestSection.render([makePr({ summary: 'Changes **bolded** & more' })]);
    // Markdown is parsed to HTML and the raw markdown escapes are gone.
    expect(html).toContain('<strong>bolded</strong>');
    // The '&' is escaped in the resulting HTML.
    expect(html).toContain('&amp;');
    expect(html).not.toContain('**bolded**');
  });

  it('sanitizes dangerous HTML in the summary', () => {
    const html = PullRequestSection.render([makePr({ summary: '# Heading\n\n**Safe** <script>alert("xss")</script>' })]);
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>Safe</strong>');
    expect(html).not.toContain('<script>');
  });

  it('renders no summary toggle when the PR has no summary', () => {
    const html = PullRequestSection.render([makePr({ summary: '' })]);
    expect(html).not.toContain('toggle_pr_summary');
  });
});
