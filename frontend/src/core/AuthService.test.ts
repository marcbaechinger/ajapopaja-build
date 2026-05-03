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
import { AuthService } from './AuthService.ts';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
    service = new AuthService();
  });

  it('should initialize with empty state if no storage data', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getUser()).toBe(null);
    expect(service.getAccessToken()).toBe(null);
  });

  it('should initialize from storage data', () => {
    const user = { username: 'testuser' };
    localStorage.setItem('auth:user', JSON.stringify(user));
    localStorage.setItem('auth:token', JSON.stringify('token123'));
    
    const newService = new AuthService();
    expect(newService.isAuthenticated()).toBe(true);
    expect(newService.getUser()).toEqual(user);
    expect(newService.getAccessToken()).toBe('token123');
  });

  it('should save to storage when auth is set', () => {
    const user = { username: 'testuser' } as any;
    service.setAuth(user, 'token123');
    
    expect(localStorage.getItem('auth:user')).toBe(JSON.stringify(user));
    expect(localStorage.getItem('auth:token')).toBe(JSON.stringify('token123'));
    expect(service.isAuthenticated()).toBe(true);
  });

  it('should clear state and storage on clear()', () => {
    service.setAuth({ username: 'user' } as any, 'token');
    service.clear();
    
    expect(localStorage.getItem('auth:user')).toBe(null);
    expect(localStorage.getItem('auth:token')).toBe(null);
    expect(service.isAuthenticated()).toBe(false);
  });

  it('should notify listeners on state change', () => {
    const listener = vi.fn();
    service.onAuthStateChanged(listener);
    
    // Initial notification
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ isAuthenticated: false }));
    
    service.setAuth({ username: 'user' } as any, 'token');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ isAuthenticated: true }));
  });

  it('should perform login and set auth on success', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ username: 'admin', access_token: 'token' }),
    });

    const result = await service.login('admin', 'password');

    expect(result).toBe(true);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.getUser()?.username).toBe('admin');
    expect(service.getAccessToken()).toBe('token');
    expect(fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      body: expect.any(FormData)
    }));
  });

  it('should return false on login failure', async () => {
    (fetch as any).mockResolvedValue({ ok: false });

    const result = await service.login('admin', 'wrong');

    expect(result).toBe(false);
    expect(service.isAuthenticated()).toBe(false);
  });

  it('should perform registration', async () => {
    (fetch as any).mockResolvedValue({ ok: true });

    const result = await service.register('newuser', 'pass', 'email@test.com', 'Full Name');

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'newuser',
        password: 'pass',
        email: 'email@test.com',
        full_name: 'Full Name'
      })
    }));
  });

  it('should clear state on logout', async () => {
    service.setAuth({ username: 'user' } as any, 'token');
    (fetch as any).mockResolvedValue({ ok: true });

    await service.logout();

    expect(service.isAuthenticated()).toBe(false);
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });

  it('should refresh token successfully', async () => {
    const user = { username: 'user' } as any;
    service.setAuth(user, 'old_token');
    
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'new_token' }),
    });

    const newToken = await service.refreshToken();

    expect(newToken).toBe('new_token');
    expect(service.getAccessToken()).toBe('new_token');
  });

  it('should clear auth if token refresh fails', async () => {
    service.setAuth({ username: 'user' } as any, 'token');
    (fetch as any).mockResolvedValue({ ok: false });

    const newToken = await service.refreshToken();

    expect(newToken).toBe(null);
    expect(service.isAuthenticated()).toBe(false);
  });
});
