# Design Document: Validate Prefix in LocalStorageManager

## 1. Overview

The `LocalStorageManager` relies on a prefix (namespace) to avoid key collisions between different modules. To ensure robustness and prevent data leaking between namespaces, it is critical that every manager instance has a non-empty, valid prefix. This task introduces strict validation for the prefix during instantiation.

## 2. Goals

- Prevent instantiation of `LocalStorageManager` with empty, whitespace-only, or invalid prefixes.
- Standardize prefixes by trimming leading/trailing whitespace.
- Ensure all existing and future modules provide a valid prefix.

## 3. Proposed Changes

### 3.1. `LocalStorageManager.ts`

- Update the constructor to:
    - Trim the provided `prefix`.
    - Check if the trimmed `prefix` is empty.
    - Throw an `Error` (e.g., `"LocalStorageManager: prefix cannot be empty."`) if validation fails.
- Update `getInstance(prefix)` to apply the same trimming/validation logic before checking the singleton cache.

### 3.2. Existing Usages

Verify that all current modules passing a prefix meet the new validation criteria:
- `AuthService` -> `'auth'` (Valid)
- `PipelineDetailView` -> `'pipeline'` (Valid)
- `AssistantPanel` -> `'assistant'` (Valid)

## 4. Design Decisions

### 4.1. Throwing vs. Falling Back
We will **throw an error** rather than falling back to a default prefix if an empty string is provided. This forces developers to explicitly define a namespace, reducing the risk of accidental data mixing in the global namespace.

### 4.2. Trimming
Automatically trimming the prefix is a convenience that prevents subtle bugs where `"auth "` and `"auth"` might be treated as different namespaces.

## 5. Verification

### 5.1. Unit Tests
Add new tests to `LocalStorageManager.test.ts`:
- Verify that passing an empty string to `getInstance()` throws an error.
- Verify that passing a whitespace-only string throws an error.
- Verify that a prefix like `"  my-app  "` is correctly trimmed to `"my-app"`.

### 5.2. Functional Check
Ensure the SPA still functions correctly and no runtime errors are triggered from existing modules.
