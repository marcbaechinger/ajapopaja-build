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

export class LocalStorageManager {
  private static instances: Map<string, LocalStorageManager> = new Map();
  private storage: Storage | Map<string, string>;
  private prefix: string;

  private constructor(prefix: string) {
    this.prefix = prefix;
    if (typeof window !== 'undefined' && window.localStorage) {
      this.storage = window.localStorage;
    } else {
      this.storage = new Map();
    }
  }

  private isBrowserStorage(s: Storage | Map<string, string>): s is Storage {
    return (s as any).getItem !== undefined;
  }

  static getInstance(prefix: string = 'app'): LocalStorageManager {
    if (!this.instances.has(prefix)) {
      this.instances.set(prefix, new LocalStorageManager(prefix));
    }
    return this.instances.get(prefix)!;
  }

  static resetInstances(): void {
    this.instances.clear();
  }

  private fullKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  put<T>(key: string, value: T): void {
    const str = JSON.stringify(value);
    if (this.isBrowserStorage(this.storage)) {
      this.storage.setItem(this.fullKey(key), str);
    } else {
      this.storage.set(this.fullKey(key), str);
    }
  }

  get<T>(key: string, defaultValue: T | null = null): T | null {
    let str: string | null;
    if (this.isBrowserStorage(this.storage)) {
      str = this.storage.getItem(this.fullKey(key));
    } else {
      str = this.storage.get(this.fullKey(key)) || null;
    }

    if (str === null) return defaultValue;
    try {
      return JSON.parse(str) as T;
    } catch (e) {
      console.warn(`LocalStorageManager: failed to parse key ${key}`, e);
      return defaultValue;
    }
  }

  remove(key: string): void {
    if (this.isBrowserStorage(this.storage)) {
      this.storage.removeItem(this.fullKey(key));
    } else {
      this.storage.delete(this.fullKey(key));
    }
  }

  exists(key: string): boolean {
    if (this.isBrowserStorage(this.storage)) {
      return this.storage.getItem(this.fullKey(key)) !== null;
    }
    return this.storage.has(this.fullKey(key));
  }

  clearPrefix(): void {
    if (this.isBrowserStorage(this.storage)) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < this.storage.length; i++) {
        const k = this.storage.key(i);
        if (k && k.startsWith(this.prefix + ':')) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => (this.storage as Storage).removeItem(k));
    } else {
      for (const k of this.storage.keys()) {
        if (k.startsWith(this.prefix + ':')) {
          this.storage.delete(k);
        }
      }
    }
  }
}
