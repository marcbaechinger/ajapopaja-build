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

import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Centralised `marked` configuration shared by every Markdown surface in the
 * app (assistant bubbles, spec/review/PR sections and the PiView activity log).
 *
 * `marked` is a single module-level instance, so configuring it here - once, at
 * import time - keeps the rendered output consistent no matter which component
 * triggers the parse. Previously `AssistantPanel` registered a table renderer
 * globally while other callers used a bare `marked.parse`, which made the
 * output depend on module import order.
 *
 * - Tables are wrapped in a horizontally scrollable container with the app's
 *   surface tokens so wide tables do not overflow their pane.
 * - Links open in a new tab with `rel="noopener noreferrer"`.
 */
marked.use({
  renderer: {
    table(token: any) {
      let header = '';
      // header
      let cell = '';
      for (let i = 0; i < token.header.length; i++) {
        cell += this.tablecell(token.header[i]);
      }
      header += this.tablerow({ text: cell });

      let body = '';
      for (let i = 0; i < token.rows.length; i++) {
        const row = token.rows[i];
        cell = '';
        for (let j = 0; j < row.length; j++) {
          cell += this.tablecell(row[j]);
        }
        body += this.tablerow({ text: cell });
      }
      if (body) body = `<tbody>${body}</tbody>`;

      return `
        <div class="overflow-x-auto my-4 border border-app-border rounded-lg">
          <table class="w-full text-sm text-left bg-app-bg" style="margin-top: 0; margin-bottom: 0">
            <thead class="bg-app-surface text-app-muted uppercase text-[10px] tracking-widest font-bold">
              ${header}
            </thead>
            ${body}
          </table>
        </div>
      `;
    },
    link(token: any) {
      const text = this.parser.parseInline(token.tokens);
      const title = token.title ? ` title="${token.title}"` : '';
      return `<a href="${token.href}" target="_blank" rel="noopener noreferrer"${title}>${text}</a>`;
    },
  },
});

/**
 * Renders a Markdown string to sanitized HTML.
 *
 * Uses `marked` to parse Markdown and `DOMPurify` to strip any potentially
 * unsafe markup before the result is injected into the DOM. Callers should
 * wrap the returned HTML in an element carrying the `prose-theme` class so it
 * picks up the shared Markdown prose styling.
 */
export function renderMarkdown(markdown: string): string {
  const rawHtml = marked.parse(markdown) as string;
  return DOMPurify.sanitize(rawHtml);
}
