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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssistantPanel } from './AssistantPanel.ts';

describe('AssistantPanel', () => {
  let mockContext: any;

  beforeEach(() => {
    document.body.innerHTML = '';
    mockContext = {
      assistantService: {
        onResponse: vi.fn(() => vi.fn()),
        requestHistory: vi.fn(),
        sendMessage: vi.fn(),
        clearHistory: vi.fn(),
      }
    };
    new AssistantPanel(mockContext);
  });

  it('should add copy button to assistant messages', () => {
    const onResponseCallback = mockContext.assistantService.onResponse.mock.calls[0][0];

    // Simulate a message chunk
    onResponseCallback({ type: 'chunk', content: 'Hello' });

    const copyBtn = document.querySelector('.copy-btn');
    expect(copyBtn).toBeTruthy();
    expect(copyBtn?.getAttribute('title')).toBe('Copy Markdown');
  });

  it('should not add copy button to user messages', () => {
    // Re-use the panel created in beforeEach if possible, 
    // but AssistantPanel doesn't expose addMessage easily.
    // Let's just use the DOM.
    const input = document.querySelector('#assistant-input') as HTMLTextAreaElement;
    const form = document.querySelector('#assistant-form') as HTMLFormElement;

    input.value = 'My message';
    form.dispatchEvent(new Event('submit'));

    const messages = document.querySelectorAll('.flex.flex-col.gap-1');
    const userMessage = messages[messages.length - 1];
    expect(userMessage.querySelector('.copy-btn')).toBeFalsy();
  });

  it('should copy text to clipboard when copy button is clicked', async () => {
    const onResponseCallback = mockContext.assistantService.onResponse.mock.calls[0][0];
    onResponseCallback({ type: 'chunk', content: 'Hello world' });

    const copyBtn = document.querySelector('.copy-btn') as HTMLButtonElement;

    // Mock clipboard API
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    await copyBtn.click();

    expect(writeTextMock).toHaveBeenCalledWith('Hello world');

    // Check visual feedback (green icon). The shared clipboard helper is async,
    // so wait for the button update rather than assuming it happens in the same
    // microtask as the click.
    await vi.waitFor(() => {
      expect(copyBtn.innerHTML).toContain('text-green-500');
    });
  });

  describe('slash commands', () => {
    function submitInput(value: string) {
      const input = document.querySelector('#assistant-input') as HTMLTextAreaElement;
      const form = document.querySelector('#assistant-form') as HTMLFormElement;
      input.value = value;
      form.dispatchEvent(new Event('submit'));
      return input;
    }

    it.each([
      ['/gl', 'Show me the commit hashes and message of the last 5 commits in pipeline PIPELINE_ID'],
      ['/i', 'Show 5 most recent issues of pipeline PIPELINE_ID'],
      ['/gd', 'Drop the top commit (that has not been pushed to the remote) of pipeline PIPELINE_ID'],
      ['/review', 'Make a review of the last implemented task of pipeline PIPELINE_ID'],
      ['/pulls', 'Show me the recent pull request of pipeline PIPELINE_ID'],
      ['/summary', 'Summarize what we discussed and suggest new tasks to address what we learned (for pipeline PIPELINE_ID)'],
      ['/test', 'Run the tests for pipeline PIPELINE_ID'],
    ])('pastes template for %s', (command, expected) => {
      const input = submitInput(command);

      expect(input.value).toBe(expected);
      // The command must not be sent to the assistant service.
      expect(mockContext.assistantService.sendMessage).not.toHaveBeenCalled();
      // Cursor should be placed at the end of the pasted template.
      expect(input.selectionStart).toBe(expected.length);
      expect(input.selectionEnd).toBe(expected.length);
    });

    it('clears history for /clear without sending a message', () => {
      const input = submitInput('/clear');

      expect(mockContext.assistantService.clearHistory).toHaveBeenCalled();
      expect(mockContext.assistantService.sendMessage).not.toHaveBeenCalled();
      expect(input.value).toBe('');
    });

    it('closes the panel for /close without sending a message', () => {
      window.location.hash = '#/pipeline/abc123';
      // Open the panel then submit /close
      window.dispatchEvent(new Event('toggle-assistant'));

      submitInput('/close');

      expect(mockContext.assistantService.sendMessage).not.toHaveBeenCalled();
      expect(document.querySelector('#assistant-panel')?.className).not.toContain('pointer-events-auto');
    });

    it.each(['/', '//'])(
      'inserts the slash command index for %s without sending a message',
      (command) => {
        const input = submitInput(command);

        expect(document.body.textContent).toContain('Slash Commands');
        expect(document.body.textContent).toContain('/pulls');
        expect(document.body.textContent).toContain('/test');
        // Interactive-only commands are not offered to the assistant.
        expect(document.body.textContent).not.toContain('/backlog');
        expect(document.body.textContent).not.toContain('/pipelines');
        expect(document.body.textContent).not.toContain('/pr');
        expect(mockContext.assistantService.sendMessage).not.toHaveBeenCalled();
        expect(input.value).toBe('');
      }
    );

    it('substitutes the current pipeline id into the template', () => {
      window.location.hash = '#/pipeline/abc123';
      const input = submitInput('/gl');

      expect(input.value).toBe(
        'Show me the commit hashes and message of the last 5 commits in pipeline abc123'
      );
    });

    it('sends a normal message that is not a slash command', () => {
      window.location.hash = '#/pipeline/abc123';
      const input = submitInput('Hello assistant');

      expect(input.value).toBe('');
      expect(mockContext.assistantService.sendMessage).toHaveBeenCalledWith(
        'Hello assistant',
        'abc123'
      );
    });
  });
});
