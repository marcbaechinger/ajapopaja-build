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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AppContext constructs the whole application graph. The theme wiring is what
// this suite exercises, so every unrelated collaborator (network clients,
// panels, dialogs) is replaced with a lightweight stub.
vi.mock('./Navigator', () => ({
  Navigator: class {
    register = vi.fn();
    start = vi.fn();
  },
}));

vi.mock('./clients/PipelineClient', () => ({ PipelineClient: class {} }));
vi.mock('./clients/TaskClient', () => ({ TaskClient: class {} }));
vi.mock('./clients/SystemClient', () => ({ SystemClient: class {} }));
vi.mock('./clients/DocBotClient', () => ({ DocBotClient: class {} }));
vi.mock('./clients/ReviewBotClient', () => ({ ReviewBotClient: class {} }));
vi.mock('./clients/ArchBotClient', () => ({ ArchBotClient: class {} }));
vi.mock('./clients/SpecBotClient', () => ({ SpecBotClient: class {} }));
vi.mock('./clients/CoderBotClient', () => ({ CoderBotClient: class {} }));
vi.mock('./clients/PullRequestClient', () => ({ PullRequestClient: class {} }));
vi.mock('./clients/EditorClient', () => ({ EditorClient: class {} }));
vi.mock('./clients/FileBrowserClient', () => ({ FileBrowserClient: class {} }));

vi.mock('./WebSocketClient.ts', () => ({
  WebSocketClient: class {
    connect = vi.fn();
    on = vi.fn(() => () => {});
    send = vi.fn();
  },
}));

vi.mock('./DataManager.ts', () => ({ DataManager: class {} }));
vi.mock('./AuthService.ts', () => ({
  AuthService: class {
    onAuthStateChanged = vi.fn();
    isAuthenticated = vi.fn(() => false);
    logout = vi.fn();
    getAccessToken = vi.fn(() => null);
    ensureValidToken = vi.fn(async () => null);
  },
}));
vi.mock('./AssistantService', () => ({ AssistantService: class {} }));
vi.mock('./CoderBotService.ts', () => ({ CoderBotService: class {} }));
vi.mock('./InteractiveCodingService.ts', () => ({
  InteractiveCodingService: class {
    getSessions = vi.fn(() => []);
    isBusy = vi.fn(() => false);
    onSessionsChange = vi.fn(() => () => {});
    onSessionChange = vi.fn(() => () => {});
    initialize = vi.fn(async () => {});
    refreshSessions = vi.fn(async () => []);
    renameSession = vi.fn(async () => {});
  },
}));
vi.mock('./DevProcessService.ts', () => ({ DevProcessService: class {} }));
vi.mock('./NotificationService.ts', () => ({
  NotificationService: class {
    onActionResult = vi.fn();
  },
}));

vi.mock('../ui/components/dialogs/SearchDialog', () => ({
  SearchDialog: class {
    show = vi.fn();
  },
}));
vi.mock('../ui/components/files/FileView', () => ({
  FileView: { registerActions: vi.fn() },
}));
vi.mock('../ui/components/session/AssistantPanel', () => ({
  AssistantPanel: class {},
}));
vi.mock('../ui/components/session/SessionManagerPanel', () => ({
  SessionManagerPanel: class {
    toggle = vi.fn();
  },
  registerSessionGenerateTitleAction: vi.fn(),
}));
vi.mock('../ui/components/session/SessionManagerButton', () => ({
  SessionManagerButton: { updateAll: vi.fn() },
}));
vi.mock('../ui/components/dialogs/HealthCheckDialog', () => ({
  HealthCheckDialog: class {
    show = vi.fn();
  },
}));
vi.mock('../ui/components/common/QuickPromptButton', () => ({
  handleQuickPromptButtonClick: vi.fn(),
}));
vi.mock('../ui/components/pipeline/SpecSection', () => ({
  setTaskSpecProposalUpdater: vi.fn(),
}));
vi.mock('./oneprompt', () => ({
  registerOnePromptHandlers: vi.fn(),
}));

const STORAGE_KEY = 'ajapopaja:theme-set';

/** Load AppContext and themeSets from the same (freshly reset) module graph. */
async function loadApp() {
  const [{ AppContext }, themes] = await Promise.all([
    import('./AppContext.ts'),
    import('../ui/theme/themeSets.ts'),
  ]);
  return { AppContext, ...themes };
}

function resetDocument() {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-set');
  document.documentElement.removeAttribute('style');
  document.body.innerHTML = '<div id="content"></div>';
}

describe('AppContext theme wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    resetDocument();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('restores the persisted set and mode while initialising state', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ setId: 'default', mode: 'light' }));
    const { AppContext, DEFAULT_THEME_SET, themeManager } = await loadApp();

    const app = new AppContext('content', 'http://localhost:8000/api');

    expect(themeManager.getActiveSetId()).toBe(DEFAULT_THEME_SET);
    expect(document.documentElement.getAttribute('data-theme-set')).toBe(DEFAULT_THEME_SET);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(app.getState().theme).toBe('light');
  });

  it('restores the persisted mode even if the manager was imported earlier', async () => {
    const { AppContext, themeManager } = await loadApp();
    expect(themeManager.getActiveSetId()).toBe('default');

    // Simulate the manager singleton being constructed before the persisted
    // selection became available (for example in a long-lived test/module).
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ setId: 'default', mode: 'light' }));

    const app = new AppContext('content', 'http://localhost:8000/api');

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(app.getState().theme).toBe('light');
  });

  it('falls back to the default set for an unknown persisted id', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ setId: 'does-not-exist', mode: 'light' }));
    const { AppContext, DEFAULT_THEME_SET, themeManager } = await loadApp();

    const app = new AppContext('content', 'http://localhost:8000/api');

    expect(themeManager.getActiveSetId()).toBe(DEFAULT_THEME_SET);
    expect(document.documentElement.getAttribute('data-theme-set')).toBe(DEFAULT_THEME_SET);
    expect(app.getState().theme).toBe('light');
  });

  it('falls back to the default set for a corrupt persisted selection', async () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    const { AppContext, DEFAULT_THEME_SET, themeManager } = await loadApp();

    const app = new AppContext('content', 'http://localhost:8000/api');

    expect(themeManager.getActiveSetId()).toBe(DEFAULT_THEME_SET);
    expect(document.documentElement.getAttribute('data-theme-set')).toBe(DEFAULT_THEME_SET);
    expect(app.getState().theme).toBe('dark');
  });

  it('registers set_theme_set and drives the manager from the action element', async () => {
    const { AppContext, DEFAULT_THEME_SET, themeManager } = await loadApp();
    const app = new AppContext('content', 'http://localhost:8000/api');
    const setSet = vi.spyOn(themeManager, 'setSet');

    const button = document.createElement('button');
    button.setAttribute('data-theme-set-id', DEFAULT_THEME_SET);
    document.body.appendChild(button);

    await app.actionRegistry.execute('set_theme_set', new MouseEvent('click'), button);
    await app.actionRegistry.execute('set_theme_set', new MouseEvent('click'), button);

    expect(setSet).toHaveBeenCalledWith(DEFAULT_THEME_SET);
    expect(setSet).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      setId: DEFAULT_THEME_SET,
      mode: 'dark',
    });
  });

  it('tolerates an unknown set id through the manager fallback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { AppContext, DEFAULT_THEME_SET, themeManager } = await loadApp();
    const app = new AppContext('content', 'http://localhost:8000/api');

    const button = document.createElement('button');
    button.setAttribute('data-set-id', 'does-not-exist');

    await app.actionRegistry.execute('set_theme_set', new MouseEvent('click'), button);

    expect(themeManager.getActiveSetId()).toBe(DEFAULT_THEME_SET);
    expect(document.documentElement.getAttribute('data-theme-set')).toBe(DEFAULT_THEME_SET);
  });

  it('keeps toggle_theme as a manager-backed light/dark mode switch', async () => {
    const { AppContext, DEFAULT_THEME_SET, themeManager } = await loadApp();
    const app = new AppContext('content', 'http://localhost:8000/api');
    const setMode = vi.spyOn(themeManager, 'setMode');

    expect(app.getState().theme).toBe('dark');

    await app.actionRegistry.execute('toggle_theme', new MouseEvent('click'), document.body);

    expect(setMode).toHaveBeenCalledWith('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(app.getState().theme).toBe('light');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      setId: DEFAULT_THEME_SET,
      mode: 'light',
    });

    await app.actionRegistry.execute('toggle_theme', new MouseEvent('click'), document.body);
    expect(app.getState().theme).toBe('dark');
  });

  it('syncs state when the manager mode changes elsewhere', async () => {
    const { AppContext, themeManager } = await loadApp();
    const app = new AppContext('content', 'http://localhost:8000/api');

    themeManager.setMode('light');
    expect(app.getState().theme).toBe('light');

    themeManager.setMode('dark');
    expect(app.getState().theme).toBe('dark');
  });
});
