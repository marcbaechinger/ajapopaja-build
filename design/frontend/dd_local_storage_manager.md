# LocalStorageManager

## Overview
The `LocalStorageManager` is a singleton class that centralises interaction with the browser’s local storage. It provides a strongly‑typed, namespaced API for persisting data in the SPA and supplies a graceful fallback when the global `window.localStorage` is unavailable (e.g. during server‑side rendering). The manager is used by all modules that require persistent key‑value storage, such as `AuthService`, `PipelineDetailView`, and `AssistantPanel`.

## Design Principles
1. **Namespace isolation** – All keys are prefixed with a configurable string (default: `app`). This prevents collisions between unrelated modules and allows selective clearing of a module’s data.
2. **Type safety** – Generic `put<T>(key, value)` and `get<T>(key, default?)` methods expose compile‑time safety while delegating serialization to `JSON.stringify`/`JSON.parse`.
3. **Graceful degradation** – When `window.localStorage` is not present, an in‑memory `Map` is used. This preserves functionality in non‑browser contexts such as unit tests.
4. **Single source of truth** – The manager is a true singleton; `getInstance(prefix)` always returns the same instance for a given prefix. This ensures consistency across the application.
5. **Utility helpers** – `exists`, `remove`, `clearPrefix`, and convenience wrappers such as `save`/`load` are provided to cover common patterns without exposing the underlying store.

## API
```ts
class LocalStorageManager {
  // Retrieve the singleton instance for a given namespace.
  static getInstance(prefix?: string): LocalStorageManager;

  // Store an arbitrary value.
  put<T>(key: string, value: T): void;

  // Retrieve a value, returning a default when missing or on parse error.
  get<T>(key: string, defaultValue?: T | null): T | null;

  // Remove a key from the store.
  remove(key: string): void;

  // Check whether a key exists.
  exists(key: string): boolean;

  // Remove all keys that belong to this instance’s namespace.
  clearPrefix(): void;

  // Convenience wrappers for storing complex objects.
  save<T>(key: string, value: T): void;
  load<T>(key: string, defaultValue?: T | null): T | null;
}
```

## Usage Examples
```ts
// Create a manager for authentication data
const authStore = LocalStorageManager.getInstance('auth');

// Store a token
authStore.put('token', userToken);

// Retrieve the token, falling back to null if missing
const token = authStore.get('token', null);

// Check existence
if (authStore.exists('token')) { /* ... */ }

// Remove the token
authStore.remove('token');

// Clear all keys under the `auth:` namespace
authStore.clearPrefix();
```

## Integration Notes
* Replace all direct `localStorage` calls in the codebase with the manager.
* Keep the namespace (`auth`, `pipeline`, `assistant`, etc.) consistent across all callers that share the same domain.
* Tests should import and use the manager instead of mocking `window.localStorage`.

## Extensibility
The manager is intentionally minimal. Future extensions could include:
* Namespace‑wide migration utilities.
* Optional encryption of stored values.
* Event emitter for storage changes across tabs.

---

*This document forms part of the reference design library for the SPA’s persistence layer.*