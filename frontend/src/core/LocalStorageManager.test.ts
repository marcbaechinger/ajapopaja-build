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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalStorageManager } from './LocalStorageManager';

describe('LocalStorageManager', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset singleton instances for testing if necessary, 
    // but here we can just clear the storage.
  });

  it('should store and retrieve values with prefix', () => {
    const manager = LocalStorageManager.getInstance('test');
    manager.put('foo', { bar: 123 });

    expect(manager.get('foo')).toEqual({ bar: 123 });
    expect(localStorage.getItem('test:foo')).toBe(JSON.stringify({ bar: 123 }));
  });

  it('should return default value if key does not exist', () => {
    const manager = LocalStorageManager.getInstance('test');
    expect(manager.get('non-existent', 'default')).toBe('default');
  });

  it('should handle parse errors gracefully', () => {
    localStorage.setItem('test:bad', 'invalid-json');
    const manager = LocalStorageManager.getInstance('test');
    
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(manager.get('bad', 'fallback')).toBe('fallback');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should check for existence', () => {
    const manager = LocalStorageManager.getInstance('test');
    manager.put('exists', true);
    expect(manager.exists('exists')).toBe(true);
    expect(manager.exists('not-exists')).toBe(false);
  });

  it('should remove items', () => {
    const manager = LocalStorageManager.getInstance('test');
    manager.put('remove-me', 1);
    manager.remove('remove-me');
    expect(manager.exists('remove-me')).toBe(false);
  });

  it('should clear items with prefix only', () => {
    const testManager = LocalStorageManager.getInstance('test');
    const otherManager = LocalStorageManager.getInstance('other');

    testManager.put('k1', 1);
    testManager.put('k2', 2);
    otherManager.put('k3', 3);

    testManager.clearPrefix();

    expect(testManager.exists('k1')).toBe(false);
    expect(testManager.exists('k2')).toBe(false);
    expect(otherManager.exists('k3')).toBe(true);
  });

  it('should fallback to Map if localStorage is unavailable (Exhaustive)', () => {
    // 1. Reset state
    LocalStorageManager.resetInstances();
    localStorage.clear();

    // 2. Stub environment (simulate no localStorage)
    vi.stubGlobal('localStorage', undefined);
    
    // 3. Instantiate with a unique prefix
    const manager = LocalStorageManager.getInstance('fallback-exhaustive');
    
    // 4. Exercise API
    manager.put('test-key', { data: 'passed' });
    expect(manager.get('test-key')).toEqual({ data: 'passed' });
    expect(manager.exists('test-key')).toBe(true);
    
    manager.remove('test-key');
    expect(manager.exists('test-key')).toBe(false);
    expect(manager.get('test-key')).toBeNull();

    // 5. Verify cleanup
    vi.unstubAllGlobals();
  });

  it('should throw error for empty or whitespace-only prefix', () => {
    expect(() => LocalStorageManager.getInstance('')).toThrow('LocalStorageManager: prefix cannot be empty.');
    expect(() => LocalStorageManager.getInstance('   ')).toThrow('LocalStorageManager: prefix cannot be empty.');
  });

  it('should trim prefix during instantiation', () => {
    const manager = LocalStorageManager.getInstance('  trimmed  ');
    manager.put('foo', 123);
    
    // Key should be 'trimmed:foo' not '  trimmed  :foo'
    expect(localStorage.getItem('trimmed:foo')).toBe('123');
  });
});
