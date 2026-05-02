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
import { LoginView } from './LoginView.ts';

describe('LoginView', () => {
  let mockContext: any;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);

    mockContext = {
      actionRegistry: {
        register: vi.fn(),
      },
      authService: {
        login: vi.fn(),
      }
    };

    // Mock window.location.hash
    vi.stubGlobal('location', { hash: '' });
  });

  it('should register login action on construction', () => {
    new LoginView(mockContext);
    expect(mockContext.actionRegistry.register).toHaveBeenCalledWith('perform_login', expect.any(Function));
  });

  it('should render the login form', () => {
    const view = new LoginView(mockContext);
    container.innerHTML = view.render();

    expect(container.querySelector('#username')).toBeTruthy();
    expect(container.querySelector('#password')).toBeTruthy();
    expect(container.querySelector('form[data-action-submit="perform_login"]')).toBeTruthy();
  });

  it('should perform login successfully and redirect', async () => {
    mockContext.authService.login.mockResolvedValue(true);
    const view = new LoginView(mockContext);
    view.mount(container);
    container.innerHTML = view.render();

    const loginAction = mockContext.actionRegistry.register.mock.calls.find((call: any) => call[0] === 'perform_login')[1];
    
    const form = container.querySelector('form') as HTMLFormElement;
    (container.querySelector('#username') as HTMLInputElement).value = 'admin';
    (container.querySelector('#password') as HTMLInputElement).value = 'secret';

    await loginAction(new Event('submit'), form);

    expect(mockContext.authService.login).toHaveBeenCalledWith('admin', 'secret');
    expect(window.location.hash).toBe('#');
  });

  it('should show error message on failed login', async () => {
    mockContext.authService.login.mockResolvedValue(false);
    const view = new LoginView(mockContext);
    view.mount(container);
    container.innerHTML = view.render();

    const loginAction = mockContext.actionRegistry.register.mock.calls.find((call: any) => call[0] === 'perform_login')[1];
    
    const form = container.querySelector('form') as HTMLFormElement;
    (container.querySelector('#username') as HTMLInputElement).value = 'admin';
    (container.querySelector('#password') as HTMLInputElement).value = 'wrong';

    await loginAction(new Event('submit'), form);

    expect(mockContext.authService.login).toHaveBeenCalledWith('admin', 'wrong');
    const errorEl = container.querySelector('#login-error') as HTMLElement;
    expect(errorEl.textContent).toBe('Invalid username or password');
    expect(errorEl.classList.contains('hidden')).toBe(false);
  });

  it('should hide error message before performing login', async () => {
    mockContext.authService.login.mockResolvedValue(true);
    const view = new LoginView(mockContext);
    view.mount(container);
    container.innerHTML = view.render();

    const errorEl = container.querySelector('#login-error') as HTMLElement;
    errorEl.classList.remove('hidden');

    const loginAction = mockContext.actionRegistry.register.mock.calls.find((call: any) => call[0] === 'perform_login')[1];
    const form = container.querySelector('form') as HTMLFormElement;

    await loginAction(new Event('submit'), form);

    expect(errorEl.classList.contains('hidden')).toBe(true);
  });
});
