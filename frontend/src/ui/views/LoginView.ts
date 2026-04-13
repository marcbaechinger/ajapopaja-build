import { View } from '../../core/Navigator.ts';
import { AppContext } from '../../core/AppContext.ts';

export class LoginView extends View {
  private container: HTMLElement | null = null;
  private context: AppContext;

  constructor(context: AppContext) {
    super();
    this.context = context;
    this.registerActions();
  }

  private registerActions() {
    this.context.actionRegistry.register('perform_login', async (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const username = (form.querySelector('#username') as HTMLInputElement).value;
      const password = (form.querySelector('#password') as HTMLInputElement).value;
      const errorEl = this.container?.querySelector('#login-error') as HTMLElement;

      if (errorEl) errorEl.classList.add('hidden');

      const success = await this.context.authService.login(username, password);
      if (success) {
        window.location.hash = '#';
      } else {
        if (errorEl) {
          errorEl.textContent = 'Invalid username or password';
          errorEl.classList.remove('hidden');
        }
      }
    });
  }

  render() {
    return `
      <div class="min-h-[80vh] flex items-center justify-center px-4">
        <div class="max-w-md w-full bg-app-surface p-8 rounded-2xl shadow-2xl border border-app-border">
          <div class="text-center mb-8">
            <h2 class="text-3xl font-black text-app-accent-1 mb-2">Welcome Back</h2>
            <p class="text-app-muted">Sign in to Ajapopaja Build</p>
          </div>

          <div id="login-error" class="hidden mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg text-center"></div>

          <form data-action-submit="perform_login" class="space-y-6">
            <div>
              <label class="block text-xs font-bold uppercase tracking-widest text-app-muted mb-2">Username</label>
              <input type="text" id="username" required
                     class="w-full px-4 py-3 rounded-xl bg-app-bg border border-app-border text-app-text focus:ring-2 focus:ring-app-accent-1 outline-none transition-all"
                     placeholder="your_username">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase tracking-widest text-app-muted mb-2">Password</label>
              <input type="password" id="password" required
                     class="w-full px-4 py-3 rounded-xl bg-app-bg border border-app-border text-app-text focus:ring-2 focus:ring-app-accent-1 outline-none transition-all"
                     placeholder="••••••••">
            </div>
            <button type="submit" 
                    class="w-full py-4 bg-app-accent-1 text-white font-black uppercase tracking-widest rounded-xl hover:brightness-110 transition-all shadow-lg shadow-app-accent-1/20 active:scale-[0.98]">
              Sign In
            </button>
          </form>
          
          <div class="mt-8 pt-6 border-t border-app-border text-center">
            <p class="text-xs text-app-muted italic">
              Default credentials: <span class="font-mono text-app-accent-2">admin / admin</span>
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
