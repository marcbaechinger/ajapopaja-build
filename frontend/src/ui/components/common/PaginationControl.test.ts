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
import { PaginationControl } from './PaginationControl.ts';

describe('PaginationControl', () => {
  it('should render nothing if total pages is 1 or less', () => {
    const html = PaginationControl.render({
      currentPage: 0,
      pageSize: 5,
      totalCount: 5,
      prevAction: 'prev',
      nextAction: 'next'
    });
    expect(html).toBe('');
  });

  it('should render pagination if total pages > 1', () => {
    const html = PaginationControl.render({
      currentPage: 0,
      pageSize: 5,
      totalCount: 10,
      prevAction: 'prev',
      nextAction: 'next'
    });
    expect(html).toContain('Previous');
    expect(html).toContain('Next');
    expect(html).toContain('Page 1 of 2');
    expect(html).toContain('data-action-click="prev"');
    expect(html).toContain('data-action-click="next"');
  });

  it('should disable Previous button on first page', () => {
    const html = PaginationControl.render({
      currentPage: 0,
      pageSize: 5,
      totalCount: 10,
      prevAction: 'prev',
      nextAction: 'next'
    });
    
    // Check that Previous button has disabled attribute
    const prevMatch = html.match(/<button[^>]*data-action-click="prev"[^>]*>/);
    expect(prevMatch?.[0]).toMatch(/\sdisabled[\s>]/);
    
    const nextMatch = html.match(/<button[^>]*data-action-click="next"[^>]*>/);
    expect(nextMatch?.[0]).not.toMatch(/\sdisabled[\s>]/);
  });

  it('should disable Next button on last page', () => {
    const html = PaginationControl.render({
      currentPage: 1,
      pageSize: 5,
      totalCount: 10,
      prevAction: 'prev',
      nextAction: 'next'
    });
    const prevMatch = html.match(/<button[^>]*data-action-click="prev"[^>]*>/);
    expect(prevMatch?.[0]).not.toMatch(/\sdisabled[\s>]/);
    
    const nextMatch = html.match(/<button[^>]*data-action-click="next"[^>]*>/);
    expect(nextMatch?.[0]).toMatch(/\sdisabled[\s>]/);
  });
});
