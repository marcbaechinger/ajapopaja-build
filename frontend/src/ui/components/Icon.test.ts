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
import { Icon } from './Icon.ts';

describe('Icon', () => {
  it('should render an icon from the registry', () => {
    const html = Icon.render('copy');
    expect(html).toContain('<use href="/icons.svg#copy-icon" />');
    expect(html).toContain('class="w-4 h-4"');
  });

  it('should handle different sizes', () => {
    const html = Icon.render('trash', { size: 24 });
    expect(html).toContain('class="w-6 h-6"');
  });

  it('should handle custom classes', () => {
    const html = Icon.render('check', { className: 'text-green-500' });
    expect(html).toContain('class="w-4 h-4 text-green-500"');
  });

  it('should handle accessibility labels', () => {
    const html = Icon.render('clock', { label: 'Time' });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Time"');
    expect(html).not.toContain('aria-hidden="true"');
  });

  it('should handle data attributes', () => {
    const html = Icon.render('search', { dataAttrs: { 'data-action': 'search' } });
    expect(html).toContain('data-action="search"');
  });

  it('should allow runtime registration', () => {
    Icon.register('testIcon', 'test-symbol-id');
    const html = Icon.render('testIcon');
    expect(html).toContain('<use href="/icons.svg#test-symbol-id" />');
  });

  it('should warn and return empty string if icon not found', () => {
    const html = Icon.render('nonExistent');
    expect(html).toBe('');
  });
});
