import { AuthService } from '../AuthService.ts';

export class BaseClient {
  protected authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService;
  }

  protected async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers || {});
    const token = this.authService.getAccessToken();
    
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      // Try refresh
      const newToken = await this.authService.refreshToken();
      if (newToken) {
        headers.set('Authorization', `Bearer ${newToken}`);
        response = await fetch(url, { ...options, headers });
      } else {
        // Redirect to login handled by App/Navigator
      }
    }

    if (!response.ok && response.status !== 401) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || `HTTP error! status: ${response.status}`);
    }

    return response;
  }
}
