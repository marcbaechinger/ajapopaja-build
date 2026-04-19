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

type PanelPosition = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br' | 'center' | 'full';
type PanelSize = 'normal' | 'expanded';

interface PanelSettings {
  position: PanelPosition;
  size: PanelSize;
}

export class AssistantPanel {
  private context: AppContext;
  private container: HTMLElement;
  private isOpen: boolean = false;
  private hasLoadedHistory: boolean = false;
  private currentAssistantMessage: HTMLElement | null = null;
  private messageContainer: HTMLElement | null = null;
  private settings: PanelSettings = {
    position: 'center',
    size: 'normal'
  };

  constructor(context: AppContext) {
    this.context = context;
    this.loadSettings();
    this.container = this.createContainer();
    document.body.appendChild(this.container);
    this.setupEventListeners();
    this.applySettings();
  }

  private loadSettings() {
    const saved = localStorage.getItem('assistant-panel-settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.settings = { ...this.settings, ...parsed };
      } catch (e) {}
    }
  }

  private saveSettings() {
    localStorage.setItem('assistant-panel-settings', JSON.stringify(this.settings));
    this.applySettings();
  }

  private applySettings() {
    // Base classes
    this.container.className = 'fixed bg-app-surface border border-app-border rounded-2xl shadow-2xl transition-all duration-300 z-50 flex flex-col overflow-hidden';
    
    if (this.isOpen) {
      this.container.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
    } else {
      this.container.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    }

    if (this.settings.position === 'full') {
      this.container.classList.add('bottom-0', 'left-0', 'right-0', 'w-full', 'rounded-b-none');
      if (this.settings.size === 'expanded') {
        this.container.classList.add('h-[85vh]');
      } else {
        this.container.classList.add('h-[50vh]');
      }
    } else {
      if (this.settings.size === 'expanded') {
        this.container.classList.add('w-[800px]', 'max-w-[95vw]', 'h-[85vh]');
      } else {
        this.container.classList.add('w-96', 'max-h-[70vh]');
      }

      switch (this.settings.position) {
        case 'tl': this.container.classList.add('top-4', 'left-4'); break;
        case 'tr': this.container.classList.add('top-4', 'right-4'); break;
        case 'bl': this.container.classList.add('bottom-4', 'left-4'); break;
        case 'br': this.container.classList.add('bottom-4', 'right-4'); break;
        case 'tc': this.container.classList.add('top-4', 'left-1/2', '-translate-x-1/2'); break;
        case 'bc': this.container.classList.add('bottom-4', 'left-1/2', '-translate-x-1/2'); break;
        case 'center': this.container.classList.add('top-1/2', 'left-1/2', '-translate-x-1/2', '-translate-y-1/2'); break;
      }
    }

    // Update active states on position buttons
    this.container.querySelectorAll('.pos-btn').forEach(btn => {
      const b = btn as HTMLElement;
      if (b.dataset.pos === this.settings.position) {
        b.classList.add('bg-app-accent-2');
      } else {
        b.classList.remove('bg-app-accent-2');
      }
    });

    // Update active states on size buttons
    this.container.querySelectorAll('.size-btn').forEach(btn => {
      const b = btn as HTMLElement;
      if (b.dataset.size === this.settings.size) {
        b.classList.add('border-app-accent-2', 'text-app-accent-2');
        b.classList.remove('border-app-border', 'text-app-text');
      } else {
        b.classList.remove('border-app-accent-2', 'text-app-accent-2');
        b.classList.add('border-app-border', 'text-app-text');
      }
    });
    
    // Auto-scroll when expanding height
    if (this.isOpen) {
        setTimeout(() => this.scrollToBottom(), 300);
    }
  }

  private createContainer(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'assistant-panel';
    // classes are managed by applySettings()
    
    el.innerHTML = `
      <div class="bg-app-bg p-4 border-b border-app-border flex justify-between items-center shrink-0">
        <div class="flex items-center gap-2">
          <div class="p-1.5 bg-app-accent-2/10 rounded-lg">
             <svg class="w-5 h-5 text-app-accent-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
          </div>
          <span class="font-black text-app-accent-2 uppercase tracking-widest text-sm">Assistant</span>
        </div>
        <div class="flex gap-2">
          <button id="assistant-settings-toggle" class="p-1.5 hover:bg-app-bg text-app-muted hover:text-app-text rounded-lg transition-colors cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" title="Panel Settings">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
          </button>
          <button id="assistant-clear" class="p-1.5 hover:bg-app-bg text-app-muted hover:text-app-text rounded-lg transition-colors cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" title="Clear History">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
          <button id="assistant-close" class="p-1.5 hover:bg-app-bg text-app-muted hover:text-app-text rounded-lg transition-colors cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      </div>
      
      <div id="assistant-settings-drawer" class="hidden bg-app-bg border-b border-app-border p-4 flex flex-col gap-4 shrink-0 shadow-inner">
        <div class="flex justify-between items-center">
          <span class="text-[10px] font-bold text-app-muted uppercase tracking-widest">Position</span>
          <div class="grid grid-cols-3 gap-1" role="group" aria-label="Select Panel Position">
            <button class="pos-btn w-6 h-4 border border-app-border rounded-sm hover:border-app-accent-2 transition-colors cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" data-pos="tl" title="Top Left" aria-label="Position Top Left"></button>
            <button class="pos-btn w-6 h-4 border border-app-border rounded-sm hover:border-app-accent-2 transition-colors cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" data-pos="tc" title="Top Center" aria-label="Position Top Center"></button>
            <button class="pos-btn w-6 h-4 border border-app-border rounded-sm hover:border-app-accent-2 transition-colors cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" data-pos="tr" title="Top Right" aria-label="Position Top Right"></button>
            <button class="pos-btn w-full h-4 border border-app-border rounded-sm hover:border-app-accent-2 transition-colors col-span-3 cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" data-pos="center" title="Center" aria-label="Position Center"></button>
            <button class="pos-btn w-6 h-4 border border-app-border rounded-sm hover:border-app-accent-2 transition-colors cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" data-pos="bl" title="Bottom Left" aria-label="Position Bottom Left"></button>
            <button class="pos-btn w-6 h-4 border border-app-border rounded-sm hover:border-app-accent-2 transition-colors cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" data-pos="bc" title="Bottom Center" aria-label="Position Bottom Center"></button>
            <button class="pos-btn w-6 h-4 border border-app-border rounded-sm hover:border-app-accent-2 transition-colors cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" data-pos="br" title="Bottom Right" aria-label="Position Bottom Right"></button>
            <button class="pos-btn w-full h-4 border border-app-border rounded-sm hover:border-app-accent-2 transition-colors col-span-3 mt-1 cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" data-pos="full" title="Full Width" aria-label="Position Full Width"></button>
          </div>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-[10px] font-bold text-app-muted uppercase tracking-widest">Size</span>
          <div class="flex gap-2" role="group" aria-label="Select Panel Size">
             <button class="size-btn px-3 py-1 text-[10px] uppercase font-bold tracking-widest border border-app-border rounded hover:border-app-accent-2 transition-colors cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" data-size="normal" aria-label="Normal Size">Normal</button>
             <button class="size-btn px-3 py-1 text-[10px] uppercase font-bold tracking-widest border border-app-border rounded hover:border-app-accent-2 transition-colors cursor-pointer focus:ring-2 outline-none focus:ring-app-accent-2" data-size="expanded" aria-label="Expanded Size">Expanded</button>
          </div>
        </div>
      </div>
      
      <div id="assistant-messages" class="flex-grow overflow-y-auto p-4 space-y-4 custom-scrollbar bg-app-surface/50">
         <div class="flex flex-col gap-1">
           <div class="bg-app-bg p-3 rounded-2xl rounded-tl-none border border-app-border text-sm text-app-text max-w-[90%] shadow-sm">
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
          <button type="submit" class="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-app-accent-2 text-white rounded-lg hover:brightness-110 transition-all shadow-lg cursor-pointer focus:ring-2 focus:ring-offset-2 focus:ring-app-accent-2 outline-none" aria-label="Send Message">
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

    const settingsDrawer = this.container.querySelector('#assistant-settings-drawer');
    this.container.querySelector('#assistant-settings-toggle')?.addEventListener('click', () => {
      settingsDrawer?.classList.toggle('hidden');
    });

    this.container.querySelectorAll('.pos-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const pos = target.dataset.pos as PanelPosition;
        if (pos) {
          this.settings.position = pos;
          this.saveSettings();
        }
      });
    });

    this.container.querySelectorAll('.size-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const size = target.dataset.size as PanelSize;
        if (size) {
          this.settings.size = size;
          this.saveSettings();
        }
      });
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
    this.applySettings();
    this.container.querySelector('textarea')?.focus();
    this.scrollToBottom();

    if (!this.hasLoadedHistory) {
        this.context.assistantService.requestHistory();
    }
  }

  private close() {
    this.isOpen = false;
    this.applySettings();
  }

  private handleResponse(response: AssistantResponse) {
    if (response.type === 'chunk' || response.type === 'thinking') {
      if (!this.currentAssistantMessage) {
        this.currentAssistantMessage = this.addMessage('assistant', '');
      }
      
      if (response.type === 'thinking') {
        const details = this.currentAssistantMessage.querySelector('.thinking-container') as HTMLDetailsElement;
        const thinkingContent = this.currentAssistantMessage.querySelector('.thinking-content') as HTMLElement;
        if (details) {
            details.classList.remove('hidden');
            if (!details.hasAttribute('data-user-closed')) {
              details.open = true;
            }
            thinkingContent.dataset.rawContent = (thinkingContent.dataset.rawContent || '') + (response.content || '');
            thinkingContent.textContent = thinkingContent.dataset.rawContent;
            thinkingContent.scrollTop = thinkingContent.scrollHeight;
        }
      } else if (response.type === 'chunk') {
        const bubble = this.currentAssistantMessage.querySelector('.bubble-content') as HTMLElement;
        // Check if there's only the pulse span inside
        const pulseSpan = bubble.querySelector('.animate-pulse');
        if (pulseSpan) {
            pulseSpan.remove();
        }
        
        bubble.dataset.rawContent = (bubble.dataset.rawContent || '') + (response.content || '');
        bubble.innerHTML = DOMPurify.sanitize(marked.parse(bubble.dataset.rawContent) as string);

        const details = this.currentAssistantMessage.querySelector('.thinking-container') as HTMLDetailsElement;
        if (details && !details.classList.contains('hidden') && !details.hasAttribute('data-user-interacted')) {
           details.open = false;
        }
      }
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
             <div class="bg-app-bg p-3 rounded-2xl rounded-tl-none border border-app-border text-sm text-app-text max-w-[90%] shadow-sm">
               History cleared. How can I help you?
             </div>
          </div>
        `;
      }
    } else if (response.type === 'assistant_history') {
        this.handleHistory(response.messages || []);
    }
    
    // If not a chunk or thinking, reset current message
    if (response.type !== 'chunk' && response.type !== 'thinking') {
      this.currentAssistantMessage = null;
    }
  }

  private async copyToClipboard(text: string, btn: HTMLButtonElement) {
    try {
      await navigator.clipboard.writeText(text);
      const originalIcon = btn.innerHTML;
      btn.innerHTML = `
        <svg class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
      `;
      btn.classList.add('text-green-500');
      
      setTimeout(() => {
        btn.innerHTML = originalIcon;
        btn.classList.remove('text-green-500');
      }, 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  }

  private addMessage(role: 'user' | 'assistant' | 'error', text: string, thought?: string): HTMLElement {
    const msgEl = document.createElement('div');
    msgEl.className = 'flex flex-col gap-1 group relative';
    
    const isUser = role === 'user';
    const isError = role === 'error';
    const isAssistant = role === 'assistant';
    
    const thinkingHtml = isAssistant ? `
      <details class="thinking-container mb-2 group/thinking ${thought ? '' : 'hidden'}" ${thought ? '' : 'open'}>
        <summary class="text-[10px] uppercase font-bold tracking-widest text-app-muted cursor-pointer hover:text-app-text select-none flex items-center gap-1">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
          Thinking
        </summary>
        <div class="thinking-content mt-1 p-2 bg-app-surface/50 border-l-2 border-app-accent-2/50 text-[11px] text-app-muted italic font-mono whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">${thought || ''}</div>
      </details>
    ` : '';
    
    msgEl.innerHTML = `
      <div class="relative max-w-[90%] ${isUser ? 'ml-auto' : ''}">
        <div class="${isUser ? 'bg-app-accent-2 text-white rounded-tr-none' : (isError ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-app-bg border-app-border text-app-text rounded-tl-none')} 
                    p-3 rounded-2xl border text-sm prose-theme prose-xs prose-p:my-0 shadow-sm">
          ${thinkingHtml}
          <div class="bubble-content">${isUser ? text : (text ? DOMPurify.sanitize(marked.parse(text) as string) : '<span class="animate-pulse">...</span>')}</div>
        </div>
        ${isAssistant ? `
          <button class="copy-btn absolute -right-2 -top-2 p-1.5 bg-app-surface/90 hover:bg-app-surface border border-app-border rounded-lg text-app-muted hover:text-app-accent-2 transition-all opacity-0 group-hover:opacity-100 cursor-pointer focus:ring-2 focus:ring-app-accent-2 outline-none z-10 shadow-md" title="Copy Markdown">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
          </button>
        ` : ''}
      </div>
    `;

    if (!isUser) {
      const bubble = msgEl.querySelector('.bubble-content') as HTMLElement;
      bubble.dataset.rawContent = text;
      
      const details = msgEl.querySelector('.thinking-container') as HTMLDetailsElement;
      if (details) {
          details.addEventListener('toggle', (e) => {
              if (e.isTrusted) { // Only record manual toggles
                 details.setAttribute('data-user-interacted', 'true');
                 if (!details.open) {
                     details.setAttribute('data-user-closed', 'true');
                 } else {
                     details.removeAttribute('data-user-closed');
                 }
              }
          });
      }
      
      if (isAssistant) {
        msgEl.querySelector('.copy-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.copyToClipboard(bubble.dataset.rawContent || '', msgEl.querySelector('.copy-btn') as HTMLButtonElement);
        });
      }
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
      <details class="tool-payload" open>
        <summary class="text-[10px] font-bold text-app-muted cursor-pointer hover:text-app-text select-none outline-none focus:ring-2 focus:ring-app-accent-2 rounded w-max">Payload</summary>
        <pre class="text-[10px] bg-app-surface p-2 mt-2 rounded border border-app-border overflow-x-auto text-app-muted">${args}</pre>
      </details>
      <div class="tool-actions flex gap-2">
        <button class="confirm-tool flex-grow bg-app-accent-2 text-white py-1.5 rounded-lg text-xs font-bold hover:brightness-110 transition-all cursor-pointer focus:ring-2 focus:ring-offset-2 focus:ring-app-accent-2 outline-none">
          Confirm & Execute
        </button>
      </div>
      <div class="tool-status hidden text-[10px] text-app-muted italic">Tool executed.</div>
    `;

    el.querySelector('.confirm-tool')?.addEventListener('click', () => {
      this.context.assistantService.confirmTool(request.id!);
      
      const details = el.querySelector('details.tool-payload') as HTMLDetailsElement;
      if (details) details.open = false;
      
      const actions = el.querySelector('.tool-actions');
      if (actions) actions.classList.add('hidden');
      
      const status = el.querySelector('.tool-status');
      if (status) status.classList.remove('hidden');
    });

    this.messageContainer?.appendChild(el);
    this.scrollToBottom();
  }

  private scrollToBottom() {
    if (this.messageContainer) {
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
  }

  private handleHistory(messages: any[]) {
    if (this.messageContainer) {
      this.messageContainer.innerHTML = '';
    }
    this.hasLoadedHistory = true;

    messages.forEach(msg => {
      if (msg.role === 'user') {
        this.addMessage('user', msg.content);
      } else if (msg.role === 'assistant') {
        const msgEl = this.addMessage('assistant', msg.content, msg.thought);
        if (msg.tool_calls && msg.tool_calls.length > 0) {
            const footer = document.createElement('div');
            footer.className = 'mt-2 flex flex-wrap gap-1';
            msg.tool_calls.forEach((tc: any) => {
                footer.innerHTML += `<span class="text-[9px] bg-app-surface border border-app-border px-1.5 py-0.5 rounded text-app-muted italic">Used tool: ${tc.function?.name || 'unknown'}</span>`;
            });
            msgEl.querySelector('.bubble-content')?.appendChild(footer);
        }
      } else if (msg.role === 'tool') {
        const el = document.createElement('div');
        el.className = 'flex justify-center my-1';
        el.innerHTML = `<span class="text-[10px] text-app-muted italic border-b border-app-border border-dashed pb-0.5">Tool result received</span>`;
        this.messageContainer?.appendChild(el);
      }
    });

    if (messages.length === 0) {
        this.messageContainer!.innerHTML = `
          <div class="flex flex-col gap-1">
             <div class="bg-app-bg p-3 rounded-2xl rounded-tl-none border border-app-border text-sm text-app-text max-w-[90%] shadow-sm">
               Hello! I'm your AI assistant. How can I help you with your tasks or pipelines today?
             </div>
          </div>
        `;
    }

    this.scrollToBottom();
  }
}
