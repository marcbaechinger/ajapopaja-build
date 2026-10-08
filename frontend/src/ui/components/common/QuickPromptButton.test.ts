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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  renderQuickPromptButton,
  isOneShotPromptButton,
  handleQuickPromptButtonClick,
  collectQuickPromptContext,
  resolveQuickPromptTarget,
  type PromptConfig,
} from './QuickPromptButton.ts';
import { Icon } from './Icon.ts';
import { inFlightPrompts, resetOnePromptState } from '../../../core/oneprompt.ts';

class FakeWS {
  sent: Array<{ type: string; payload: any }> = [];
  send(type: string, payload: any): void {
    this.sent.push({ type, payload });
  }
}

describe('QuickPromptButton', () => {
  const mockConfig: PromptConfig = {
    id: 'test-action',
    label: 'Test Label',
    title: 'Test Title',
    iconSvg: Icon.render('check', { size: 16 }),
    getPrompt: (taskId, pipelineId) => `Prompt for ${taskId} in ${pipelineId}`
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    resetOnePromptState();
  });

  afterEach(() => {
    resetOnePromptState();
  });

  it('should render a button with correct attributes and content', () => {
    const html = renderQuickPromptButton(mockConfig);
    
    expect(html).toContain('data-action-copy="test-action"');
    expect(html).toContain('title="Test Title"');
    expect(html).toContain('Test Label');
    expect(html).toContain(Icon.render('check', { size: 16 }));
  });

  it('should generate correct prompt via getPrompt', () => {
    const prompt = mockConfig.getPrompt?.('T1', 'P1');
    expect(prompt).toBe('Prompt for T1 in P1');
  });

  it('defaults to copy mode and reports the mode correctly', () => {
    expect(isOneShotPromptButton(mockConfig)).toBe(false);
    expect(renderQuickPromptButton(mockConfig)).toContain('data-action-copy="test-action"');
  });

  it('renders a one-shot dispatch button with prompt/task/pipeline ids', () => {
    const config: PromptConfig = {
      id: 'task_elaborate_spec',
      label: 'Elaborate',
      title: 'Expand the task specification',
      iconSvg: Icon.render('documentation', { size: 12 }),
      mode: 'oneshot',
      taskId: 't1',
      pipelineId: 'p1',
    };

    expect(isOneShotPromptButton(config)).toBe(true);
    const html = renderQuickPromptButton(config);
    expect(html).toContain('data-action-click="quick_prompt"');
    expect(html).toContain('data-prompt-id="task_elaborate_spec"');
    expect(html).toContain('data-task-id="t1"');
    expect(html).toContain('data-pipeline-id="p1"');
    expect(html).not.toContain('data-action-copy');
  });

  it('accepts the "quick_prompt" mode alias', () => {
    const config: PromptConfig = {
      id: 'task_elaborate_spec',
      label: 'Elaborate',
      title: 'Expand',
      iconSvg: '',
      mode: 'quick_prompt',
    };
    expect(isOneShotPromptButton(config)).toBe(true);
    expect(renderQuickPromptButton(config)).toContain('data-action-click="quick_prompt"');
  });

  it('collects context from the button and its owning elements', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-task-id', 'task-from-parent');
    wrapper.setAttribute('data-pipeline-id', 'pipeline-from-parent');
    const button = document.createElement('button');
    wrapper.appendChild(button);

    expect(collectQuickPromptContext(button)).toEqual({
      taskId: 'task-from-parent',
      pipelineId: 'pipeline-from-parent',
    });

    button.setAttribute('data-task-id', 'task-from-button');
    expect(collectQuickPromptContext(button).taskId).toBe('task-from-button');
  });

  it('resolves a data-oneprompt-target container', () => {
    const target = document.createElement('div');
    target.setAttribute('data-oneprompt-target', '');
    const button = document.createElement('button');
    target.appendChild(button);

    expect(resolveQuickPromptTarget(button)).toBe(target);
    expect(resolveQuickPromptTarget(document.createElement('button'))).toBeNull();
  });

  describe('handleQuickPromptButtonClick', () => {
    it('dispatches a correctly shaped quick_prompt message', () => {
      const ws = new FakeWS();
      const button = document.createElement('button');
      button.setAttribute('data-prompt-id', 'task_elaborate_spec');
      button.setAttribute('data-task-id', 't1');
      button.setAttribute('data-pipeline-id', 'p1');

      const request = handleQuickPromptButtonClick(ws as any, button);

      expect(request).not.toBeNull();
      expect(ws.sent).toHaveLength(1);
      expect(ws.sent[0].type).toBe('quick_prompt');
      expect(ws.sent[0].payload.promptId).toBe('task_elaborate_spec');
      expect(ws.sent[0].payload.context).toEqual({ taskId: 't1', pipelineId: 'p1' });
      expect(inFlightPrompts.get(request!.runId)?.promptId).toBe('task_elaborate_spec');
    });

    it('uses the enclosing data-oneprompt-target as the render target', () => {
      const ws = new FakeWS();
      const target = document.createElement('div');
      target.setAttribute('data-oneprompt-target', '');
      target.setAttribute('data-task-id', 't1');
      target.setAttribute('data-pipeline-id', 'p1');
      const button = document.createElement('button');
      button.setAttribute('data-prompt-id', 'task_elaborate_spec');
      target.appendChild(button);

      const request = handleQuickPromptButtonClick(ws as any, button);
      expect(inFlightPrompts.get(request!.runId)?.target).toBe(target);
    });

    it('accepts an explicit action id and returns null without a prompt id', () => {
      const ws = new FakeWS();
      const button = document.createElement('button');
      const request = handleQuickPromptButtonClick(ws as any, button, 'task_elaborate_spec');
      expect(ws.sent[0].payload.promptId).toBe('task_elaborate_spec');
      expect(request).not.toBeNull();

      expect(handleQuickPromptButtonClick(ws as any, document.createElement('button'))).toBeNull();
    });
  });
});
