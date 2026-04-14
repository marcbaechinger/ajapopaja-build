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

import './style.css';
import { AppContext } from './core/AppContext';
import { DashboardView } from './ui/views/DashboardView';
import { PipelineDetailView } from './ui/views/PipelineDetailView';
import { LoginView } from './ui/views/LoginView';

// API Base URL - Configurable via Vite environment variables with a fallback
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

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
