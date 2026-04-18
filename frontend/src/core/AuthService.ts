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

import type { User } from './domain.ts';

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
}

export class AuthService {
  private state: AuthState = {
    user: null,
    accessToken: null,
    isAuthenticated: false,
  };

  private listeners: ((state: AuthState) => void)[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    const savedUser = localStorage.getItem('auth_user');
    const savedToken = localStorage.getItem('auth_token');
    
    if (savedUser && savedToken) {
      try {
        this.state = {
          user: JSON.parse(savedUser),
          accessToken: savedToken,
          isAuthenticated: true,
        };
      } catch (e) {
        this.clear();
      }
    }
  }

  private saveToStorage() {
    if (this.state.user && this.state.accessToken) {
      localStorage.setItem('auth_user', JSON.stringify(this.state.user));
      localStorage.setItem('auth_token', this.state.accessToken);
    } else {
      this.clear();
    }
  }

  public clear() {
    localStorage.removeItem('auth_user');
    localStorage.removeItem('auth_token');
    this.state = {
      user: null,
      accessToken: null,
      isAuthenticated: false,
    };
    this.notify();
  }

  public setAuth(user: User, token: string) {
    this.state = {
      user,
      accessToken: token,
      isAuthenticated: true,
    };
    this.saveToStorage();
    this.notify();
  }

  public getAccessToken(): string | null {
    return this.state.accessToken;
  }

  public getUser(): User | null {
    return this.state.user;
  }

  public isAuthenticated(): boolean {
    return this.state.isAuthenticated;
  }

  public onAuthStateChanged(listener: (state: AuthState) => void): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l(this.state));
  }

  public async login(username: string, password: string): Promise<boolean> {
    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      // We don't have all user details from login, just username. 
      // fetch /me for full info or just use what we have.
      const user: User = {
        username: data.username,
        // id and others will be populated by /me if needed
      } as any;

      this.setAuth(user, data.access_token);
      return true;
    } catch (e) {
      console.error('Login failed', e);
      return false;
    }
  }

  public async register(username: string, password: string, email?: string, fullName?: string): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email, full_name: fullName }),
      });

      return response.ok;
    } catch (e) {
      console.error('Registration failed', e);
      return false;
    }
  }

  public async logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      this.clear();
    }
  }

  public async refreshToken(): Promise<string | null> {
    try {
      const response = await fetch('/api/auth/refresh', { method: 'POST' });
      if (response.ok) {
        const data = await response.json();
        const user = this.getUser();
        if (user) {
          this.setAuth(user, data.access_token);
          return data.access_token;
        }
      }
    } catch (e) {
      console.error('Token refresh failed', e);
    }
    this.clear();
    return null;
  }
}
