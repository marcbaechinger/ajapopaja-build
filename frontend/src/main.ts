import './style.css';
import { AppContext } from './core/AppContext';
import { DashboardView } from './ui/views/DashboardView';
import { View } from './core/Navigator';

// API Base URL - In production this could be relative or from env
const API_BASE = 'http://localhost:8000';

// Initialize the Application Context
// We use the '#content' div as the main view container
const app = new AppContext('content', API_BASE);

// Register Routes
app.navigator.register('/', () => new DashboardView(app));
app.navigator.register('/pipeline/:id', (params) => {
  // We will implement PipelineDetailView soon
  return new class extends View {
    render() {
      return `
        <div class="bg-app-surface p-8 rounded-xl shadow-xl border border-app-border">
          <h2 class="text-3xl font-bold text-app-accent-1 mb-4">Pipeline Detail</h2>
          <p class="text-app-text">Viewing details for pipeline ID: <span class="font-mono text-app-accent-2">${params.id}</span></p>
          <button class="mt-6 text-app-muted hover:text-app-text underline" onclick="window.location.hash = '#'">Back to Dashboard</button>
        </div>
      `;
    }
  };
});

// Start the application
app.start();
