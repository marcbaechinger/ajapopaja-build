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

import { View } from '../../core/Navigator.ts';
import { AppContext } from '../../core/AppContext.ts';

export class RegisterView extends View {
  private container: HTMLElement | null = null;
  private context: AppContext;

  constructor(context: AppContext) {
    super();
    this.context = context;
    this.registerActions();
  }

  private registerActions() {
    this.context.actionRegistry.register('perform_register', async (_e, el) => {
      const form = el as HTMLFormElement;
      const username = (form.querySelector('#username') as HTMLInputElement).value;
      const password = (form.querySelector('#password') as HTMLInputElement).value;
      const confirmPassword = (form.querySelector('#confirm-password') as HTMLInputElement).value;
      const email = (form.querySelector('#email') as HTMLInputElement).value;
      const fullName = (form.querySelector('#full-name') as HTMLInputElement).value;
      const errorEl = this.container?.querySelector('#register-error') as HTMLElement;

      if (errorEl) errorEl.classList.add('hidden');

      if (password !== confirmPassword) {
        if (errorEl) {
          errorEl.textContent = 'Passwords do not match';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      const success = await this.context.authService.register(username, password, email || undefined, fullName || undefined);
      if (success) {
        // Automatically login after registration
        const loginSuccess = await this.context.authService.login(username, password);
        if (loginSuccess) {
          window.location.hash = '#';
        } else {
          window.location.hash = '#/login';
        }
      } else {
        if (errorEl) {
          errorEl.textContent = 'Registration failed. Username might already be taken.';
          errorEl.classList.remove('hidden');
        }
      }
    });
  }

  render() {
    return `
      <div class="min-h-[80vh] flex items-center justify-center px-4 py-12">
        <div class="max-w-md w-full bg-app-surface p-8 rounded-2xl shadow-2xl border border-app-border">
          <div class="text-center mb-8">
            <h2 class="text-3xl font-black text-app-accent-2 mb-2">Create Account</h2>
            <p class="text-app-muted">Join Ajapopaja Build</p>
          </div>

          <div id="register-error" class="hidden mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg text-center"></div>

          <form data-action-submit="perform_register" class="space-y-4">
            <div>
              <label class="block text-xs font-bold uppercase tracking-widest text-app-muted mb-2">Username *</label>
              <input type="text" id="username" required
                     class="w-full px-4 py-2 rounded-xl bg-app-bg border border-app-border text-app-text focus:ring-2 focus:ring-app-accent-2 outline-none transition-all"
                     placeholder="your_username">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase tracking-widest text-app-muted mb-2">Full Name</label>
              <input type="text" id="full-name"
                     class="w-full px-4 py-2 rounded-xl bg-app-bg border border-app-border text-app-text focus:ring-2 focus:ring-app-accent-2 outline-none transition-all"
                     placeholder="John Doe">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase tracking-widest text-app-muted mb-2">Email</label>
              <input type="email" id="email"
                     class="w-full px-4 py-2 rounded-xl bg-app-bg border border-app-border text-app-text focus:ring-2 focus:ring-app-accent-2 outline-none transition-all"
                     placeholder="john@example.com">
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-bold uppercase tracking-widest text-app-muted mb-2">Password *</label>
                <input type="password" id="password" required
                       class="w-full px-4 py-2 rounded-xl bg-app-bg border border-app-border text-app-text focus:ring-2 focus:ring-app-accent-2 outline-none transition-all"
                       placeholder="••••••••">
              </div>
              <div>
                <label class="block text-xs font-bold uppercase tracking-widest text-app-muted mb-2">Confirm *</label>
                <input type="password" id="confirm-password" required
                       class="w-full px-4 py-2 rounded-xl bg-app-bg border border-app-border text-app-text focus:ring-2 focus:ring-app-accent-2 outline-none transition-all"
                       placeholder="••••••••">
              </div>
            </div>
            <button type="submit" 
                    class="w-full py-4 mt-4 bg-app-accent-2 text-white font-black uppercase tracking-widest rounded-xl hover:brightness-110 transition-all shadow-lg shadow-app-accent-2/20 active:scale-[0.98]">
              Register
            </button>
          </form>
          
          <div class="mt-8 pt-6 border-t border-app-border text-center">
            <p class="text-sm text-app-muted">
              Already have an account? <a href="#/login" class="text-app-accent-2 font-bold hover:underline">Sign In</a>
            </p>
          </div>
        </div>
      </div>
    `;
  }

  mount(container: HTMLElement) {
    this.container = container;
  }

  unmount() {
    // No-op
  }
}
