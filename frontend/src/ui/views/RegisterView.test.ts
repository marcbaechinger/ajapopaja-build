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
import { RegisterView } from './RegisterView.ts';

describe('RegisterView', () => {
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
        register: vi.fn(),
        login: vi.fn(),
      }
    };

    // Mock window.location.hash
    vi.stubGlobal('location', { hash: '' });
  });

  it('should register register action on construction', () => {
    new RegisterView(mockContext);
    expect(mockContext.actionRegistry.register).toHaveBeenCalledWith('perform_register', expect.any(Function));
  });

  it('should render the registration form', () => {
    const view = new RegisterView(mockContext);
    container.innerHTML = view.render();

    expect(container.querySelector('#username')).toBeTruthy();
    expect(container.querySelector('#password')).toBeTruthy();
    expect(container.querySelector('#confirm-password')).toBeTruthy();
    expect(container.querySelector('#email')).toBeTruthy();
    expect(container.querySelector('#full-name')).toBeTruthy();
    expect(container.querySelector('form[data-action-submit="perform_register"]')).toBeTruthy();
  });

  it('should show error if passwords do not match', async () => {
    const view = new RegisterView(mockContext);
    view.mount(container);
    container.innerHTML = view.render();

    const registerAction = mockContext.actionRegistry.register.mock.calls.find((call: any) => call[0] === 'perform_register')[1];
    
    const form = container.querySelector('form') as HTMLFormElement;
    (container.querySelector('#password') as HTMLInputElement).value = 'password123';
    (container.querySelector('#confirm-password') as HTMLInputElement).value = 'password456';

    await registerAction(new Event('submit'), form);

    expect(mockContext.authService.register).not.toHaveBeenCalled();
    const errorEl = container.querySelector('#register-error') as HTMLElement;
    expect(errorEl.textContent).toBe('Passwords do not match');
    expect(errorEl.classList.contains('hidden')).toBe(false);
  });

  it('should perform registration and auto-login successfully', async () => {
    mockContext.authService.register.mockResolvedValue(true);
    mockContext.authService.login.mockResolvedValue(true);
    const view = new RegisterView(mockContext);
    view.mount(container);
    container.innerHTML = view.render();

    const registerAction = mockContext.actionRegistry.register.mock.calls.find((call: any) => call[0] === 'perform_register')[1];
    
    const form = container.querySelector('form') as HTMLFormElement;
    (container.querySelector('#username') as HTMLInputElement).value = 'newuser';
    (container.querySelector('#password') as HTMLInputElement).value = 'secret';
    (container.querySelector('#confirm-password') as HTMLInputElement).value = 'secret';
    (container.querySelector('#email') as HTMLInputElement).value = 'test@example.com';
    (container.querySelector('#full-name') as HTMLInputElement).value = 'Test User';

    await registerAction(new Event('submit'), form);

    expect(mockContext.authService.register).toHaveBeenCalledWith('newuser', 'secret', 'test@example.com', 'Test User');
    expect(mockContext.authService.login).toHaveBeenCalledWith('newuser', 'secret');
    expect(window.location.hash).toBe('#');
  });

  it('should redirect to login if auto-login fails after registration', async () => {
    mockContext.authService.register.mockResolvedValue(true);
    mockContext.authService.login.mockResolvedValue(false);
    const view = new RegisterView(mockContext);
    view.mount(container);
    container.innerHTML = view.render();

    const registerAction = mockContext.actionRegistry.register.mock.calls.find((call: any) => call[0] === 'perform_register')[1];
    
    const form = container.querySelector('form') as HTMLFormElement;
    (container.querySelector('#username') as HTMLInputElement).value = 'newuser';
    (container.querySelector('#password') as HTMLInputElement).value = 'secret';
    (container.querySelector('#confirm-password') as HTMLInputElement).value = 'secret';

    await registerAction(new Event('submit'), form);

    expect(window.location.hash).toBe('#/login');
  });

  it('should show error if registration fails', async () => {
    mockContext.authService.register.mockResolvedValue(false);
    const view = new RegisterView(mockContext);
    view.mount(container);
    container.innerHTML = view.render();

    const registerAction = mockContext.actionRegistry.register.mock.calls.find((call: any) => call[0] === 'perform_register')[1];
    
    const form = container.querySelector('form') as HTMLFormElement;
    (container.querySelector('#username') as HTMLInputElement).value = 'existinguser';
    (container.querySelector('#password') as HTMLInputElement).value = 'secret';
    (container.querySelector('#confirm-password') as HTMLInputElement).value = 'secret';

    await registerAction(new Event('submit'), form);

    expect(mockContext.authService.register).toHaveBeenCalled();
    const errorEl = container.querySelector('#register-error') as HTMLElement;
    expect(errorEl.textContent).toContain('Registration failed');
    expect(errorEl.classList.contains('hidden')).toBe(false);
  });
});
