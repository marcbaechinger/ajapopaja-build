import './style.css';
import { AppContext } from './core/AppContext';
import { DashboardView } from './ui/views/DashboardView';
import { PipelineDetailView } from './ui/views/PipelineDetailView';
import { LoginView } from './ui/views/LoginView';

// API Base URL - Hardcoded to localhost:8000 for development
const API_BASE = 'http://localhost:8000/api';

// Initialize the Application Context
// We use the '#content' div as the main view container
const app = new AppContext('content', API_BASE);

// Middleware for authentication
const requireAuth = (factory: (params: Record<string, string>) => any) => {
  return (params: Record<string, string>) => {
    if (!app.authService.isAuthenticated()) {
      window.location.hash = '#/login';
      return new LoginView(app);
    }
    return factory(params);
  };
};

// Register Routes
app.navigator.register('/', requireAuth(() => new DashboardView(app)));
app.navigator.register('/pipeline/:id', requireAuth((params) => new PipelineDetailView(app, params)));
app.navigator.register('/login', () => new LoginView(app));

// Start the application
app.start();
