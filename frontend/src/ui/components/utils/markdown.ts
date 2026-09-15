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
