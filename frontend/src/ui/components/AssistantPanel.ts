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

import { AppContext } from '../../core/AppContext.ts';
import type { AssistantResponse } from '../../core/AssistantService.ts';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export class AssistantPanel {
  private context: AppContext;
  private container: HTMLElement;
  private isOpen: boolean = false;
  private currentAssistantMessage: HTMLElement | null = null;
  private messageContainer: HTMLElement | null = null;

  constructor(context: AppContext) {
    this.context = context;
    this.container = this.createContainer();
    document.body.appendChild(this.container);
    this.setupEventListeners();
  }

  private createContainer(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'assistant-panel';
    el.className = 'fixed bottom-24 right-8 w-96 bg-app-surface border border-app-border rounded-2xl shadow-2xl transition-all duration-300 transform translate-x-[120%] z-50 flex flex-col overflow-hidden max-h-[70vh]';
    
    el.innerHTML = `
      <div class="bg-app-bg p-4 border-b border-app-border flex justify-between items-center shrink-0">
        <div class="flex items-center gap-2">
          <div class="p-1.5 bg-app-accent-2/10 rounded-lg">
             <svg class="w-5 h-5 text-app-accent-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
          </div>
          <span class="font-black text-app-accent-2 uppercase tracking-widest text-sm">Assistant</span>
        </div>
        <div class="flex gap-2">
          <button id="assistant-clear" class="p-1.5 hover:bg-app-bg text-app-muted hover:text-app-text rounded-lg transition-colors cursor-pointer" title="Clear History">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
          <button id="assistant-close" class="p-1.5 hover:bg-app-bg text-app-muted hover:text-app-text rounded-lg transition-colors cursor-pointer">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      </div>
      
      <div id="assistant-messages" class="flex-grow overflow-y-auto p-4 space-y-4 custom-scrollbar bg-app-surface/50">
         <div class="flex flex-col gap-1">
           <div class="bg-app-bg p-3 rounded-2xl rounded-tl-none border border-app-border text-sm text-app-text max-w-[90%]">
             Hello! I'm your AI assistant. How can I help you with your tasks or pipelines today?
           </div>
         </div>
      </div>

      <div class="p-4 bg-app-bg border-t border-app-border shrink-0">
        <form id="assistant-form" class="relative">
          <textarea id="assistant-input" 
                    class="w-full bg-app-surface border border-app-border rounded-xl pl-4 pr-12 py-3 text-sm text-app-text outline-none focus:ring-2 focus:ring-app-accent-2 transition-all resize-none max-h-32"
                    placeholder="Ask me anything..."
                    rows="1"></textarea>
          <button type="submit" class="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-app-accent-2 text-white rounded-lg hover:brightness-110 transition-all shadow-lg cursor-pointer">
             <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
          </button>
        </form>
      </div>
    `;

    return el;
  }

  private setupEventListeners() {
    window.addEventListener('toggle-assistant', () => this.toggle());
    
    this.container.querySelector('#assistant-close')?.addEventListener('click', () => this.close());
    this.container.querySelector('#assistant-clear')?.addEventListener('click', () => {
      this.context.assistantService.clearHistory();
    });

    const form = this.container.querySelector('#assistant-form') as HTMLFormElement;
    const input = this.container.querySelector('#assistant-input') as HTMLTextAreaElement;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      
      this.addMessage('user', text);
      this.context.assistantService.sendMessage(text);
      input.value = '';
      input.rows = 1;
    });

    input.addEventListener('input', () => {
      input.rows = Math.min(5, (input.value.match(/\n/g) || []).length + 1);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit'));
      }
    });

    this.context.assistantService.onResponse((response) => this.handleResponse(response));
    this.messageContainer = this.container.querySelector('#assistant-messages');
  }

  private toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  private open() {
    this.isOpen = true;
    this.container.classList.remove('translate-x-[120%]');
    this.container.classList.add('translate-x-0');
    this.container.querySelector('textarea')?.focus();
  }

  private close() {
    this.isOpen = false;
    this.container.classList.remove('translate-x-0');
    this.container.classList.add('translate-x-[120%]');
  }

  private handleResponse(response: AssistantResponse) {
    if (response.type === 'chunk') {
      if (!this.currentAssistantMessage) {
        this.currentAssistantMessage = this.addMessage('assistant', '');
      }
      const bubble = this.currentAssistantMessage.querySelector('.bubble-content') as HTMLElement;
      bubble.dataset.rawContent = (bubble.dataset.rawContent || '') + response.content;
      bubble.innerHTML = DOMPurify.sanitize(marked.parse(bubble.dataset.rawContent) as string);
      this.scrollToBottom();
    } else if (response.type === 'tool_request') {
      this.currentAssistantMessage = null;
      this.addToolRequest(response);
    } else if (response.type === 'error') {
      this.currentAssistantMessage = null;
      this.addMessage('error', response.message || 'An error occurred.');
    } else if (response.type === 'cleared') {
      this.currentAssistantMessage = null;
      if (this.messageContainer) {
        this.messageContainer.innerHTML = `
          <div class="flex flex-col gap-1">
             <div class="bg-app-bg p-3 rounded-2xl rounded-tl-none border border-app-border text-sm text-app-text max-w-[90%]">
               History cleared. How can I help you?
             </div>
          </div>
        `;
      }
    }
    
    // If not a chunk, reset current message
    if (response.type !== 'chunk') {
      this.currentAssistantMessage = null;
    }
  }

  private addMessage(role: 'user' | 'assistant' | 'error', text: string): HTMLElement {
    const msgEl = document.createElement('div');
    msgEl.className = 'flex flex-col gap-1';
    
    const isUser = role === 'user';
    const isError = role === 'error';
    
    msgEl.innerHTML = `
      <div class="${isUser ? 'ml-auto bg-app-accent-2 text-white rounded-tr-none' : (isError ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-app-bg border-app-border text-app-text rounded-tl-none')} 
                  p-3 rounded-2xl border text-sm max-w-[90%] bubble-content prose prose-invert prose-xs prose-p:my-0 shadow-sm">
        ${isUser ? text : (text ? DOMPurify.sanitize(marked.parse(text) as string) : '<span class="animate-pulse">...</span>')}
      </div>
    `;

    if (!isUser) {
      const bubble = msgEl.querySelector('.bubble-content') as HTMLElement;
      bubble.dataset.rawContent = text;
    }

    this.messageContainer?.appendChild(msgEl);
    this.scrollToBottom();
    this.currentAssistantMessage = isUser ? null : msgEl;
    return msgEl;
  }

  private addToolRequest(request: AssistantResponse) {
    const el = document.createElement('div');
    el.className = 'bg-app-bg border border-app-accent-2/30 rounded-xl p-4 space-y-3 shadow-lg';
    
    const args = JSON.stringify(request.arguments, null, 2);
    
    el.innerHTML = `
      <div class="flex items-center gap-2 text-app-accent-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
        <span class="text-[10px] font-black uppercase tracking-widest">Tool Request</span>
      </div>
      <div class="text-xs font-bold text-app-text">${request.tool}</div>
      <pre class="text-[10px] bg-app-surface p-2 rounded border border-app-border overflow-x-auto text-app-muted">${args}</pre>
      <div class="flex gap-2">
        <button class="confirm-tool flex-grow bg-app-accent-2 text-white py-1.5 rounded-lg text-xs font-bold hover:brightness-110 transition-all cursor-pointer">
          Confirm & Execute
        </button>
      </div>
    `;

    el.querySelector('.confirm-tool')?.addEventListener('click', () => {
      this.context.assistantService.confirmTool(request.id!);
      el.innerHTML = `<div class="text-[10px] text-app-muted italic">Tool executed.</div>`;
    });

    this.messageContainer?.appendChild(el);
    this.scrollToBottom();
  }

  private scrollToBottom() {
    if (this.messageContainer) {
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
  }
}
