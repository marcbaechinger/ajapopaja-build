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

import { iconMap } from './icons.ts';

export interface IconOptions {
  size?: number; // pixel size (e.g., 14, 16, 20, 24)
  className?: string; // additional Tailwind classes
  label?: string; // accessible label -> aria-label
  dataAttrs?: Record<string, string>; // arbitrary data- attributes
}

export class Icon {
  private static runtimeRegistry: Record<string, string> = {};

  /**
   * Registers a new icon mapping at runtime.
   */
  static register(name: string, id: string): void {
    this.runtimeRegistry[name] = id;
  }

  /**
   * Renders an SVG element that references an icon from the sprite.
   */
  static render(name: string, opts: IconOptions = {}): string {
    const symbolId = this.runtimeRegistry[name] || iconMap[name];
    if (!symbolId) {
      console.warn(`Icon "${name}" not found in registry.`);
      return '';
    }

    const { size = 16, className = '', label, dataAttrs = {} } = opts;

    // Map size to Tailwind classes if possible, otherwise use inline style
    let sizeClass = '';
    let style = '';
    if (size === 12) sizeClass = 'w-3 h-3';
    else if (size === 14) sizeClass = 'w-3.5 h-3.5';
    else if (size === 16) sizeClass = 'w-4 h-4';
    else if (size === 18) sizeClass = 'w-4.5 h-4.5';
    else if (size === 20) sizeClass = 'w-5 h-5';
    else if (size === 24) sizeClass = 'w-6 h-6';
    else if (size === 32) sizeClass = 'w-8 h-8';
    else if (size === 48) sizeClass = 'w-12 h-12';
    else {
      style = `width: ${size}px; height: ${size}px;`;
    }

    const accessibility = label
      ? `role="img" aria-label="${label}"`
      : 'aria-hidden="true"';

    const dataAttributes = Object.entries(dataAttrs)
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');

    const combinedClasses = [sizeClass, className].filter(Boolean).join(' ');

    return `
      <svg xmlns="http://www.w3.org/2000/svg" 
           class="${combinedClasses}" 
           ${style ? `style="${style}"` : ''} 
           viewBox="0 0 24 24" 
           fill="none" 
           stroke="currentColor" 
           stroke-width="2" 
           stroke-linecap="round" 
           stroke-linejoin="round" 
           ${accessibility} 
           ${dataAttributes}>
        <use href="/icons.svg#${symbolId}" />
      </svg>
    `.trim();
  }
}
