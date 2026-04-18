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
    
    // Check visual feedback (green icon)
    expect(copyBtn.innerHTML).toContain('text-green-500');
  });
});
