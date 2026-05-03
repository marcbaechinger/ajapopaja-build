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
import { ButtonComponent } from './ButtonComponent';

describe('ButtonComponent', () => {
  it('renders icon-only mode by default', () => {
    const html = ButtonComponent.render({
      action: 'test_action',
      icon: '<svg id="test-icon"></svg>',
      title: 'Test Title'
    });
    expect(html).toContain('data-action-click="test_action"');
    expect(html).toContain('<svg id="test-icon"></svg>');
    expect(html).toContain('title="Test Title"');
    expect(html).not.toContain('span');
  });

  it('renders label-only mode', () => {
    const html = ButtonComponent.render({
      action: 'test_action',
      label: 'Test Label',
      mode: 'label-only'
    });
    expect(html).toContain('data-action-click="test_action"');
    expect(html).toContain('Test Label');
    expect(html).toContain('<span');
    expect(html).not.toContain('svg');
  });

  it('renders both icon and label', () => {
    const html = ButtonComponent.render({
      action: 'test_action',
      icon: '<svg id="test-icon"></svg>',
      label: 'Test Label',
      mode: 'both'
    });
    expect(html).toContain('<svg id="test-icon"></svg>');
    expect(html).toContain('Test Label');
    expect(html).toContain('<span');
  });

  it('handles extra attributes', () => {
    const html = ButtonComponent.render({
      action: 'test_action',
      extraAttrs: { 'data-custom': 'value', 'id': 'my-btn' }
    });
    expect(html).toContain('data-custom="value"');
    expect(html).toContain('id="my-btn"');
  });
});
