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

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

import type { ActionHandler, ActionRegistry } from '../../../core/ActionRegistry.ts';
import type { FileContent } from '../../../core/domain.ts';
import { Icon } from '../common/Icon.ts';
import {
  escapeHtml,
  formatFileSize,
  formatTimestamp,
  gitStatusPresentation,
} from '../utils/fileBrowser.ts';

/**
 * highlight.js core plus only the languages the file browser is likely to
 * show. Registering a curated set keeps the bundle small instead of pulling in
 * the full (~1 MB) highlight.js language bundle.
 */
const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  makefile,
  markdown,
  php,
  plaintext,
  python,
  ruby,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language);
}

/** Map a lowercase file extension to a registered highlight.js language. */
const EXTENSION_LANGUAGE: Record<string, string> = {
  // JavaScript / TypeScript
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  // Python
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  // JVM / Apple
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  // C family
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  // Other languages
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  rake: 'ruby',
  php: 'php',
  // Shell
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  // Data / config
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  toml: 'ini',
  // Markup
  html: 'xml',
  htm: 'xml',
  xhtml: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  css: 'css',
  // Docs
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  // Build
  dockerfile: 'dockerfile',
  mk: 'makefile',
  make: 'makefile',
};

/** Map a lowercase base filename to a registered highlight.js language. */
const FILENAME_LANGUAGE: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  '.env': 'ini',
  '.gitignore': 'plaintext',
  '.dockerignore': 'plaintext',
};

/** Skip highlighting very large payloads to keep the main thread responsive. */
const MAX_HIGHLIGHT_LENGTH = 100_000;
/** Auto-detection is far more expensive, so only run it on smaller files. */
const MAX_AUTO_HIGHLIGHT_LENGTH = 20_000;

/** Resolve the highlight.js language for a file from its name/extension. */
function detectLanguage(file: FileContent): string | null {
  // Prefer the file name, then fall back to the repository-relative path. The
  // backend normally supplies the basename in `name`, but a search hit (or a
  // test double) may only carry the extension on `path`.
  const candidates = [file.name, file.path].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  for (const candidate of candidates) {
    const base = candidate.toLowerCase().split('/').pop() ?? '';
    const byName = FILENAME_LANGUAGE[base];
    if (byName) return byName;
    const dot = base.lastIndexOf('.');
    if (dot > 0) {
      const language = EXTENSION_LANGUAGE[base.slice(dot + 1)];
      if (language) return language;
    }
  }
  return null;
}

/**
 * Highlight `content` for the given file, returning trusted HTML. highlight.js
 * escapes all source text, so its output is safe to inject into the DOM.
 * Falls back to escaped plain text when highlighting is unavailable or the
 * file is too large.
 */
function highlightContent(content: string, language: string | null): string {
  try {
    if (language && hljs.getLanguage(language)) {
      if (content.length > MAX_HIGHLIGHT_LENGTH) return escapeHtml(content);
      return hljs.highlight(content, { language, ignoreIllegals: true }).value;
    }
    if (content.length > MAX_AUTO_HIGHLIGHT_LENGTH) return escapeHtml(content);
    return hljs.highlightAuto(content).value;
  } catch {
    return escapeHtml(content);
  }
}

/**
 * Main-panel view for a single file: metadata header plus a read-only code
 * block. Binary and truncated files render a clear message instead of content.
 * Text content is syntax-highlighted with a lightweight highlight.js subset.
 */
export class FileView {
  /**
   * Register the actions owned by the file view. Currently this is the
   * "copy path" action, which writes the repository-relative path to the
   * clipboard so it can be pasted elsewhere (e.g. a terminal or the agent
   * prompt).
   */
  static registerActions(registry: ActionRegistry): void {
    const copyPath: ActionHandler = async (_event, element) => {
      const path = element.getAttribute('data-path');
      if (!path) return;
      try {
        await navigator.clipboard.writeText(path);
        this.showCopiedFeedback(element);
      } catch (error) {
        console.error('Failed to copy file path:', error);
      }
    };
    registry.register('copy_file_path', copyPath);
  }

  /** Briefly swap an action icon for a check to confirm it succeeded. */
  static showCopiedFeedback(element: HTMLElement): void {
    const original = element.innerHTML;
    element.innerHTML = Icon.render('check', { size: 14 });
    window.setTimeout(() => {
      element.innerHTML = original;
    }, 1500);
  }

  static render(file: FileContent): string {
    return `
      <div class="flex flex-col h-full min-h-0">
        ${this.renderHeader(file)}
        <div class="flex-1 min-h-0 overflow-auto bg-app-bg/60 rounded-b-xl" data-role="file-browser-scroll">
          ${this.renderBody(file)}
        </div>
      </div>
    `;
  }

  private static renderHeader(file: FileContent): string {
    const status = gitStatusPresentation(file.gitStatus);
    const badge = status
      ? `<span class="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${status.badgeClass}">${status.label}</span>`
      : '';

    return `
      <div class="flex flex-col gap-2 px-3 py-3 border-b border-app-border/40">
        <div class="flex items-center gap-2 min-w-0">
          <span class="shrink-0 text-app-muted" aria-hidden="true">${Icon.render('file', { size: 16 })}</span>
          <h3 class="text-sm font-bold text-app-text truncate" title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</h3>
          <button type="button" data-action-click="copy_file_path" data-path="${escapeHtml(file.path)}"
            class="shrink-0 p-1 rounded text-app-muted hover:text-app-text hover:bg-app-surface/60 transition-colors cursor-pointer"
            title="Copy path" aria-label="Copy path">${Icon.render('copy', { size: 14 })}</button>
          <button type="button" data-action-click="download_file" data-path="${escapeHtml(file.path)}"
            class="shrink-0 p-1 rounded text-app-muted hover:text-app-text hover:bg-app-surface/60 transition-colors cursor-pointer"
            title="Download file" aria-label="Download file">${Icon.render('download', { size: 14 })}</button>
          <button type="button" data-action-click="open_file_raw" data-path="${escapeHtml(file.path)}"
            data-role="open-raw"
            class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide text-app-muted hover:text-app-text hover:bg-app-surface/60 transition-colors cursor-pointer"
            title="Open raw file" aria-label="Open raw file">raw</button>
          ${badge}
        </div>
        <div class="grid grid-cols-2 gap-x-6 text-[11px] text-app-muted" data-role="file-metadata">
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 min-w-0" data-role="file-metadata-column">
            <dt class="font-semibold uppercase tracking-wider text-[9px]">Path</dt>
            <dd class="truncate" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</dd>
            <dt class="font-semibold uppercase tracking-wider text-[9px]">Size</dt>
            <dd>${escapeHtml(formatFileSize(file.size))}</dd>
          </dl>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 min-w-0 border-l border-app-border/40 pl-6" data-role="file-metadata-column">
            <dt class="font-semibold uppercase tracking-wider text-[9px]">Created</dt>
            <dd class="truncate" title="${escapeHtml(formatTimestamp(file.createdAt))}">${escapeHtml(formatTimestamp(file.createdAt))}</dd>
            <dt class="font-semibold uppercase tracking-wider text-[9px]">Modified</dt>
            <dd class="truncate" title="${escapeHtml(formatTimestamp(file.modifiedAt))}">${escapeHtml(formatTimestamp(file.modifiedAt))}</dd>
          </dl>
        </div>
      </div>
    `;
  }

  private static renderBody(file: FileContent): string {
    if (file.isBinary) {
      return `
        <div class="flex flex-col items-center justify-center gap-2 py-16 px-4 text-center">
          <span class="text-app-muted/60">${Icon.render('file', { size: 32 })}</span>
          <p class="text-xs text-app-muted italic">This is a binary file and cannot be displayed.</p>
        </div>
      `;
    }

    const truncated = file.truncated
      ? `<p class="px-3 py-2 text-[11px] text-amber-400 bg-amber-500/10 border-b border-amber-500/20">Showing the first 1&nbsp;MiB of this file.</p>`
      : '';

    const content = file.content ?? '';
    const highlighted = highlightContent(content, detectLanguage(file));
    return `
      ${truncated}
      <pre class="p-3 text-[11px] leading-relaxed text-app-text whitespace-pre overflow-x-auto"><code class="hljs">${highlighted}</code></pre>
    `;
  }
}
