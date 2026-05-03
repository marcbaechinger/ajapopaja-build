# Design Document: Testing Fallback Map Storage in LocalStorageManager

## 1. Overview

The `LocalStorageManager` is designed to be robust even in environments where `window.localStorage` is unavailable (e.g., SSR, strictly configured browsers, or specific test environments). In such cases, it should transparently fall back to an in-memory `Map`. This task aims to implement a comprehensive unit test that validates this fallback mechanism.

## 2. Goals

- Verify that `LocalStorageManager` uses an in-memory `Map` when `window.localStorage` is `undefined`.
- Ensure that singleton instances can be reset to allow clean testing of initialization logic.
- Demonstrate that data persists correctly in the fallback store for the lifetime of the manager instance.
- Confirm that the fallback store honors the same prefixing rules as the standard storage.

## 3. Implementation Plan

### 3.1. Prerequisite: Singleton Reset

The `LocalStorageManager` uses a singleton pattern (keyed by prefix). To test initialization logic (like checking for the existence of `window.localStorage`), we must be able to clear the internal `instances` Map.

- [x] Implement `LocalStorageManager.resetInstances()` (Already implemented in previous task).

### 3.2. Test Logic

A new test case will be added to `LocalStorageManager.test.ts` (or an improved version of the existing one) with the following steps:

1. **Reset State**: Call `LocalStorageManager.resetInstances()` and `localStorage.clear()`.
2. **Stub Environment**: Use `vi.stubGlobal('localStorage', undefined)` to simulate a restricted environment.
3. **Instantiate**: Call `LocalStorageManager.getInstance('fallback-test')`.
4. **Exercise API**:
    - `put('key', 'value')`
    - `get('key')` -> expect 'value'
    - `exists('key')` -> expect `true`
5. **Verify Isolation**: Verify that `localStorage.getItem` (if it were accessible) would not contain the data.
6. **Cleanup**: `vi.unstubAllGlobals()`.

## 4. Design Decisions

### 4.1. Global Stubbing
Using Vitest's `vi.stubGlobal` is the idiomatic way to mock global objects like `localStorage`. This ensures that the code under test sees the environment as intended without permanently affecting other tests.

### 4.2. Instance Isolation
By using a unique prefix for the fallback test, we further ensure that it doesn't collide with any other instances that might have been partially initialized or cached in the `instances` Map.

## 5. Verification

Running the test suite with `npm test` should show all tests passing, including the new exhaustive fallback test.
