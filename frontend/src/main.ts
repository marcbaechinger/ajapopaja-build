import './style.css';
import { AppContext } from './core/AppContext';
import { DashboardView } from './ui/views/DashboardView';
import { PipelineDetailView } from './ui/views/PipelineDetailView';

// API Base URL - Hardcoded to localhost:8000 for development
const API_BASE = 'http://localhost:8000/api';

// Initialize the Application Context
// We use the '#content' div as the main view container
const app = new AppContext('content', API_BASE);

// Register Routes
app.navigator.register('/', () => new DashboardView(app));
app.navigator.register('/pipeline/:id', (params) => new PipelineDetailView(app, params));

// Start the application
app.start();
