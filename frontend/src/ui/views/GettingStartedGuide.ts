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

import { BaseDialog } from '../components/dialogs/dialog_common.ts';
import { Icon } from '../components/common/Icon.ts';
import { escapeHtml } from '../components/utils/html.ts';

/**
 * The empty-state “readme” of the dashboard.
 *
 * It is rendered inline while no pipeline exists and can be reopened as an
 * overlay (via the small *Guide* button in the pipeline header) once pipelines
 * are present, so the onboarding reference never gets in the way but is always
 * one click away.
 *
 * This module is intentionally presentation-only: the dashboard owns the
 * action handlers and delegates clicks through the shared action registry
 * (`create_pipeline`, `create_pipeline_from_guide`, `open_getting_started`,
 * `copy_project_prompt`, `toggle_assistant`).
 */

/** A ready-to-use project setup prompt offered as an expandable card. */
export interface ProjectBlueprint {
  id: string;
  title: string;
  subtitle: string;
  /** Icon name understood by {@link Icon.render}. */
  icon: string;
  tags: string[];
  prompt: string;
}

/**
 * The curated blueprints shown in the “Jump-start a project” section. Each
 * prompt is a complete, self-contained instruction that a coding agent can act
 * on without further clarification.
 */
export const PROJECT_BLUEPRINTS: ProjectBlueprint[] = [
  {
    id: 'react-spa',
    title: 'React single-page app',
    subtitle: 'Vite + TypeScript + React + Tailwind',
    icon: 'lightning',
    tags: ['Vite', 'TypeScript', 'React', 'Tailwind'],
    prompt: `You are setting up a brand-new web application in this repository.

Goal: a production-ready single-page application.

Stack
- Vite (latest) as the build tool and dev server
- TypeScript in strict mode
- React 18+ with function components and hooks
- React Router for client-side routing
- Tailwind CSS for styling
- Vitest + React Testing Library for tests
- ESLint + Prettier

Please:
1. Scaffold the app at the repository root.
2. Configure TypeScript strict mode, path aliases and the Vite dev proxy if needed.
3. Create a clean folder structure: src/components, src/pages, src/lib, src/styles.
4. Build a small but polished example feature (for example a task list with
   add / complete / delete) that exercises state, routing and reusable components.
5. Add responsive styling and a light/dark theme toggle using Tailwind.
6. Add unit tests for the example feature.
7. Add a README that documents setup, scripts (dev, build, test, lint) and structure.
8. Make sure "npm run build", "npm run lint" and "npm test" all pass.

Do not commit node_modules/ or dist/. Briefly explain the key decisions when done.`,
  },
  {
    id: 'fullstack',
    title: 'React + Python API',
    subtitle: 'Vite/TypeScript/React frontend with a FastAPI backend',
    icon: 'architecture',
    tags: ['Vite', 'React', 'FastAPI', 'Python', 'uv'],
    prompt: `You are setting up a brand-new full-stack web application in this repository.

Goal: a React frontend and a Python API backend that work together locally.

Frontend (frontend/)
- Vite + TypeScript + React
- React Router and Tailwind CSS
- A small typed API client with error handling
- Vitest + React Testing Library

Backend (backend/)
- Python 3.11+ managed with uv (single workspace)
- FastAPI + Uvicorn
- Pydantic request/response models
- CORS configured for the Vite dev server
- An in-memory store behind a repository interface
- pytest + httpx for API tests

Endpoints
- GET /api/health -> { "status": "ok" }
- GET/POST/PUT/DELETE /api/items -> a simple CRUD example

Please:
1. Create the frontend/ and backend/ structure plus shared root scripts.
2. Wire the frontend to the backend (at least list and create).
3. Add loading, empty and error states in the UI.
4. Add a root README with exact run instructions for both halves.
5. Ensure "uv run pytest", "uv run ruff check", "npm run build", "npm run lint"
   and "npm test" all pass.

Do not commit build artifacts. Keep the API contract typed on both sides.`,
  },
  {
    id: 'python-cli',
    title: 'Python CLI with Rich UI',
    subtitle: 'Typer + Rich command-line application',
    icon: 'file',
    tags: ['Python', 'Typer', 'Rich', 'pytest'],
    prompt: `You are setting up a brand-new Python command-line application in this repository.

Goal: a polished, installable CLI with a rich terminal UI.

Stack
- Python 3.11+ managed with uv (single pyproject.toml)
- typer for the command-line interface
- rich for tables, panels, progress bars, trees and colours
- pydantic-settings for configuration
- pytest for tests
- ruff for linting and formatting

Please:
1. Create the package under src/<package_name>/ with a thin __main__.py and a
   cli module exposing the Typer app.
2. Add example commands that showcase Rich output:
   - hello NAME -> a panel greeting
   - list -> a formatted table
   - sync -> a live progress bar
3. Add a --verbose flag, a --version flag and environment-based configuration.
4. Separate pure business logic from presentation so the core is unit-testable.
5. Add tests with pytest covering the logic and at least one CLI invocation via
   typer.testing.CliRunner.
6. Add a README with installation and usage examples.
7. Ensure "uv run pytest" and "uv run ruff check" pass.

Do not commit __pycache__/ or build artifacts.`,
  },
];

/** Renders a single expandable project blueprint card. */
function renderBlueprintCard(bp: ProjectBlueprint): string {
  const tags = bp.tags
    .map(
      (tag) =>
        `<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-app-border text-app-muted bg-app-surface">${escapeHtml(tag)}</span>`
    )
    .join('');

  return `
    <details class="group/blueprint rounded-xl border border-app-border bg-app-bg overflow-hidden transition-colors hover:border-app-accent-2/40">
      <summary class="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none p-4 flex items-start gap-4">
        <span class="shrink-0 w-10 h-10 rounded-lg bg-app-accent-2/10 border border-app-accent-2/20 text-app-accent-2 flex items-center justify-center">
          ${Icon.render(bp.icon, { size: 20 })}
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center justify-between gap-3">
            <span class="font-bold text-app-text">${escapeHtml(bp.title)}</span>
            <span class="text-app-muted transition-transform duration-200 group-open/blueprint:rotate-180">
              ${Icon.render('chevronDown', { size: 16 })}
            </span>
          </span>
          <span class="block text-xs text-app-muted mt-1">${escapeHtml(bp.subtitle)}</span>
          <span class="flex flex-wrap gap-1.5 mt-2">${tags}</span>
        </span>
      </summary>
      <div class="border-t border-app-border p-4 bg-app-surface/40">
        <div class="flex items-center justify-between gap-3 mb-2">
          <span class="text-[10px] font-bold uppercase tracking-widest text-app-muted">Ready-to-use project setup prompt</span>
          <button type="button"
                  data-action-click="copy_project_prompt"
                  data-copy-target="prompt-${bp.id}"
                  class="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-app-bg border border-app-border text-[10px] font-bold uppercase tracking-wider text-app-accent-2 hover:bg-app-accent-2/10 transition-all cursor-pointer">
            ${Icon.render('copy', { size: 12 })}
            <span class="copy-label">Copy prompt</span>
          </button>
        </div>
        <pre id="prompt-${bp.id}" class="text-xs leading-relaxed text-app-text/90 whitespace-pre-wrap break-words font-mono bg-app-bg border border-app-border rounded-lg p-3 max-h-72 overflow-y-auto custom-scrollbar">${escapeHtml(bp.prompt)}</pre>
      </div>
    </details>
  `;
}

function renderStep(
  number: string,
  title: string,
  body: string,
  icon: string
): string {
  return `
    <div class="flex items-start gap-4 p-5 rounded-xl border border-app-border bg-app-bg">
      <div class="shrink-0">
        <span class="w-9 h-9 rounded-full bg-app-accent-1/10 border border-app-accent-1/30 text-app-accent-1 font-black flex items-center justify-center text-sm">${number}</span>
      </div>
      <div class="min-w-0">
        <h3 class="font-bold text-app-text flex items-center gap-2">
          <span class="text-app-accent-2">${Icon.render(icon, { size: 16 })}</span>
          ${escapeHtml(title)}
        </h3>
        <div class="text-sm text-app-muted mt-1.5 leading-relaxed">${body}</div>
      </div>
    </div>
  `;
}

/** Renders the numbered getting-started walkthrough. */
function renderSteps(): string {
  const repoStep = `
    <p class="mb-1">Ajapopaja connects to your Gitea host over HTTPS. Create a repository,
    then generate an access token that lets Ajapopaja clone it and push changes back.</p>
    <div class="grid md:grid-cols-2 gap-4 mt-3">
      <div class="rounded-lg border border-app-border/70 bg-app-surface/50 p-3">
        <div class="text-[10px] font-bold uppercase tracking-widest text-app-accent-2 mb-2">1a · Create the repository</div>
        <ol class="list-decimal ml-4 space-y-1">
          <li>Sign in to Gitea and click <span class="text-app-text font-semibold">+ → New Repository</span>.</li>
          <li>Name it, e.g. <code class="text-app-accent-2">my-app</code>, and choose public or private.</li>
          <li>Initialise it with a README so there is an initial commit to clone.</li>
          <li>Copy the HTTPS clone URL: <code class="text-app-accent-2 break-all">https://git.example.com/you/my-app.git</code>.</li>
        </ol>
      </div>
      <div class="rounded-lg border border-app-border/70 bg-app-surface/50 p-3">
        <div class="text-[10px] font-bold uppercase tracking-widest text-app-accent-2 mb-2">1b · Generate an access token</div>
        <ol class="list-decimal ml-4 space-y-1">
          <li>Click your avatar → <span class="text-app-text font-semibold">Settings → Applications</span>.</li>
          <li>Under <span class="text-app-text font-semibold">Manage Access Tokens</span> click <span class="text-app-text font-semibold">Generate New Token</span>.</li>
          <li>Name it, e.g. <code class="text-app-accent-2">ajapopaja-build</code>.</li>
          <li>Grant the <span class="text-app-text font-semibold">repository</span> permission with <span class="text-app-text font-semibold">Read and Write</span> so Ajapopaja can clone and push.</li>
          <li>Also enable the <span class="text-app-text font-semibold">issues</span> permission (Read and Write) if you want task/issue integration.</li>
          <li>Generate the token and copy it — it is shown only once.</li>
        </ol>
      </div>
    </div>
    <div class="mt-3 flex items-start gap-2 text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200/90 p-2.5">
      <span class="mt-0.5">${Icon.render('alert', { size: 14 })}</span>
      <span>Keep the token secret. Ajapopaja stores it on the server and never sends it back to the browser.</span>
    </div>
  `;

  const pipelineStep = `
    <p>Open the pipeline dialog and choose the <span class="text-app-text font-semibold">Remote Repository</span> tab.
    Enter the repository name, HTTPS clone URL, your Gitea username and the token from step 1.</p>
    <p class="mt-2">No remote yet? You can also start with a local workspace path and connect Gitea later.</p>
  `;

  const taskStep = `
    <p>Inside the pipeline click <span class="text-app-text font-semibold">New Task</span> and describe one unit of work.
    Add a title and a spec, and tick <span class="text-app-text font-semibold">design document</span> when the change needs a plan first.</p>
    <p class="mt-2">Small, focused tasks produce better agent results than one giant task.</p>
  `;

  const agentStep = `
    <p><span class="text-app-text font-semibold">ArchBot</span> drafts the design → you approve it →
    <span class="text-app-text font-semibold">CoderBot</span> implements it and opens a pull request →
    <span class="text-app-text font-semibold">ReviewBot</span> reviews the diff.</p>
    <p class="mt-2">Everything lands back in the pipeline for your accept / reject decision.</p>
  `;

  return `
    <div class="flex flex-col gap-3">
      ${renderStep('1', 'Create a Gitea repository and credentials', repoStep, 'folder')}
      ${renderStep('2', 'Connect the repository to a new pipeline', pipelineStep, 'architecture')}
      ${renderStep('3', 'Break the work into tasks', taskStep, 'check')}
      ${renderStep('4', 'Let the agents implement and review', agentStep, 'git-pull-request')}
    </div>
  `;
}

/** Renders the “Jump-start a project” blueprint section. */
function renderBlueprints(): string {
  return `
    <section class="flex flex-col gap-4">
      <div class="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h3 class="text-xl font-bold text-app-text flex items-center gap-2">
            <span class="text-app-accent-2">${Icon.render('lightning', { size: 18 })}</span>
            Jump-start a new project
          </h3>
          <p class="text-sm text-app-muted mt-1">
            No code yet? Expand a blueprint, copy the prompt and paste it into the Assistant
            (or into a task) to scaffold a complete, working project layout.
          </p>
        </div>
        <button data-action-click="toggle_assistant"
                class="shrink-0 flex items-center gap-2 bg-app-bg hover:bg-app-surface px-4 py-2 rounded-lg border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer">
          ${Icon.render('lightning', { size: 14 })}
          <span class="text-xs font-bold uppercase tracking-widest">Open Assistant</span>
        </button>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
        ${PROJECT_BLUEPRINTS.map(renderBlueprintCard).join('')}
      </div>
    </section>
  `;
}

/**
 * Returns the full onboarding page markup.
 *
 * @param variant `inline` renders the empty-state page inside the dashboard;
 * `dialog` renders the same content inside an overlay and routes the primary
 * button through the dashboard so the guide is dismissed before the creation
 * dialog opens.
 */
export function renderGettingStartedGuide(variant: 'inline' | 'dialog' = 'inline'): string {
  const createAction = variant === 'dialog' ? 'create_pipeline_from_guide' : 'create_pipeline';

  return `
    <div class="flex flex-col gap-8">
      <section class="relative overflow-hidden rounded-2xl border border-app-border bg-app-bg p-6 md:p-8">
        <div class="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-app-accent-2/10 blur-3xl pointer-events-none"></div>
        <div class="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-app-accent-1/10 blur-3xl pointer-events-none"></div>
        <div class="relative">
          <div class="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-app-accent-2 bg-app-accent-2/10 border border-app-accent-2/20 rounded-full px-3 py-1 mb-4">
            <span class="w-1.5 h-1.5 rounded-full bg-app-accent-2"></span>
            Welcome to Ajapopaja Build
          </div>
          <h2 class="text-3xl md:text-4xl font-black text-app-text tracking-tight">Build your first pipeline</h2>
          <p class="text-app-muted mt-3 leading-relaxed max-w-2xl">
            Turn a Gitea repository into an autonomous, human-supervised workspace. Connect the repo,
            describe the work as tasks, and let the agents design, implement and review it — while you
            stay in control and approve every result.
          </p>
          <div class="flex items-center gap-3 mt-6 flex-wrap">
            <button data-action-click="${createAction}"
                    class="flex items-center gap-2 bg-app-accent-1 hover:brightness-110 text-white text-xs font-bold uppercase tracking-widest px-5 py-2.5 rounded-lg transition-all shadow-lg cursor-pointer">
              ${Icon.render('plus', { size: 16 })}
              Create your first pipeline
            </button>
            <button data-action-click="toggle_assistant"
                    class="flex items-center gap-2 bg-app-surface hover:bg-app-bg px-5 py-2.5 rounded-lg border border-app-border text-app-text text-xs font-bold uppercase tracking-widest transition-all cursor-pointer">
              ${Icon.render('lightning', { size: 16 })}
              Ask the Assistant
            </button>
          </div>
          <p class="text-[11px] text-app-muted mt-4">New here? Follow the four steps below — it takes about five minutes.</p>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="text-xs font-black uppercase tracking-widest text-app-muted">How it works</h3>
        ${renderSteps()}
      </section>

      ${renderBlueprints()}
    </div>
  `;
}

/**
 * Overlay wrapper around {@link renderGettingStartedGuide}. Used once pipelines
 * already exist so the reference remains available without occupying the
 * dashboard.
 */
export class GettingStartedDialog extends BaseDialog<void> {
  constructor() {
    super({
      title: 'Getting Started',
      maxWidth: 'max-w-4xl',
      maxHeight: 'max-h-[85vh]',
      iconSvg: Icon.render('documentation', { size: 20 }),
    });
  }

  protected renderBody(): string {
    return `<div class="p-6">${renderGettingStartedGuide('dialog')}</div>`;
  }

  /** Closes the overlay. Public so the dashboard can dismiss it before opening the create dialog. */
  public dismiss(): void {
    this.close();
  }
}
