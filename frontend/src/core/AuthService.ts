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
import { LocalStorageManager } from './LocalStorageManager.ts';

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
}

/**
 * Treat a token that expires within this many seconds as already expired so a
 * request is refreshed *before* it goes out instead of relying on a 401.
 */
const ACCESS_TOKEN_EXPIRY_LEEWAY_SECONDS = 30;

export class AuthService {
  private state: AuthState = {
    user: null,
    accessToken: null,
    isAuthenticated: false,
  };

  private listeners: ((state: AuthState) => void)[] = [];
  private storage = LocalStorageManager.getInstance('auth');

  /**
   * Shared in-flight refresh so concurrent 401s (or several clients waking up
   * at once) trigger exactly one `POST /api/auth/refresh`. Only that request
   * may clear the session; a second caller never races it into a logout.
   */
  private refreshInFlight: Promise<string | null> | null = null;

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Decode the `exp` claim of a JWT without verifying it. Returns `null` when
   * the token is not a readable JWT.
   */
  private static decodeExpiry(token: string): number | null {
    try {
      const payloadPart = token.split('.')[1];
      if (!payloadPart) return null;
      const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(
        base64.length + ((4 - (base64.length % 4)) % 4),
        '='
      );
      const payload = JSON.parse(atob(padded));
      return typeof payload.exp === 'number' ? payload.exp : null;
    } catch {
      return null;
    }
  }

  private isTokenValid(token: string): boolean {
    const exp = AuthService.decodeExpiry(token);
    // A token without a readable `exp` is passed through; the server will
    // reject it with a 401 and the normal refresh path takes over.
    if (exp === null) return true;
    return exp - ACCESS_TOKEN_EXPIRY_LEEWAY_SECONDS > Date.now() / 1000;
  }

  private loadFromStorage() {
    const savedUser = this.storage.get<User>('user');
    const savedToken = this.storage.get<string>('token');

    if (!savedUser) {
      return;
    }

    if (savedToken && this.isTokenValid(savedToken)) {
      this.state = {
        user: savedUser,
        accessToken: savedToken,
        isAuthenticated: true,
      };
      return;
    }

    // The persisted user is still there but the access token is missing or
    // expired. The refresh cookie may still be valid, so recover the session
    // proactively instead of waiting for the first 401. Report the session as
    // authenticated while doing so to avoid a flash of the login view; a
    // definitive failure clears the state and notifies the listeners.
    this.state = {
      user: savedUser,
      accessToken: null,
      isAuthenticated: true,
    };
    void this.refreshToken();
  }

  private saveToStorage() {
    if (this.state.user && this.state.accessToken) {
      this.storage.put('user', this.state.user);
      this.storage.put('token', this.state.accessToken);
    } else {
      this.clear();
    }
  }

  public clear() {
    this.storage.remove('user');
    this.storage.remove('token');
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

  /**
   * Return a usable access token, refreshing when the cached one is missing or
   * about to expire. Used by callers that cannot recover from a 401 after the
   * fact (notably the WebSocket handshake).
   */
  public async ensureValidToken(): Promise<string | null> {
    const token = this.state.accessToken;
    if (token && this.isTokenValid(token)) {
      return token;
    }
    if (this.state.user) {
      return this.refreshToken();
    }
    return token;
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
        credentials: 'same-origin',
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
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } finally {
      this.clear();
    }
  }

  /**
   * Refresh the access token, sharing a single in-flight request between all
   * concurrent callers. Only a definitive refresh failure clears the session.
   */
  public refreshToken(): Promise<string | null> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.performRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async performRefresh(): Promise<string | null> {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (response.ok) {
        const data = await response.json();
        const username = data?.username ?? this.getUser()?.username;
        if (username && data?.access_token) {
          const user: User = {
            ...(this.getUser() ?? {}),
            username,
          } as User;
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
