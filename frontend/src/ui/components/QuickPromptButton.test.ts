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
import { renderQuickPromptButton, type PromptConfig } from './QuickPromptButton.ts';
import { Icon } from './Icon.ts';

describe('QuickPromptButton', () => {
  const mockConfig: PromptConfig = {
    id: 'test-action',
    label: 'Test Label',
    title: 'Test Title',
    iconSvg: Icon.render('check', { size: 16 }),
    getPrompt: (taskId, pipelineId) => `Prompt for ${taskId} in ${pipelineId}`
  };

  it('should render a button with correct attributes and content', () => {
    const html = renderQuickPromptButton(mockConfig);
    
    expect(html).toContain('data-action-copy="test-action"');
    expect(html).toContain('title="Test Title"');
    expect(html).toContain('Test Label');
    expect(html).toContain(Icon.render('check', { size: 16 }));
  });

  it('should generate correct prompt via getPrompt', () => {
    const prompt = mockConfig.getPrompt('T1', 'P1');
    expect(prompt).toBe('Prompt for T1 in P1');
  });
});
