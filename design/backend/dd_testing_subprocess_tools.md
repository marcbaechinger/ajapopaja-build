# Design Doc: Efficient and Effective Testing for Subprocess-based Tools

## Purpose
This document evaluates strategies for testing assistant tools that rely on system subprocess commands (e.g., `grep`, `find`, `git`). The goal is to define a testing pattern that is reliable, fast, and maintains high confidence in the tool's behavior.

## Current state
We currently use two main patterns:
1.  **Unit Tests with Mocks (`test_search_tools.py`)**: Uses `unittest.mock.patch` to mock `subprocess.run`. It verifies that the correct arguments are passed and that the tool correctly parses a *simulated* output string.
2.  **Integration Tests with Real Workspace (`test_grep_integration_real.py`)**: Creates a temporary directory with real files and runs the *actual* system command via the tool. It verifies the end-to-end behavior.

## Evaluation of Strategies

### 1. Mocking `subprocess.run` (Unit Testing)
*   **Pros**:
    *   **Extremely Fast**: No filesystem I/O or external process execution.
    *   **Deterministic**: Tests don't depend on the environment's `grep` version or availability.
    *   **Comprehensive Error Handling**: Easy to simulate rare edge cases (e.g., binary files, permission errors, process crashes).
*   **Cons**:
    *   **Fragile Parsing**: The mock might provide output that doesn't perfectly match the real command's output (as seen in the `-Z` vs `-nI` parsing issue).
    *   **Argument Mismatch**: Doesn't verify if the generated `grep` command is actually valid or supported by the installed `grep`.
    *   **Maintenance Heavy**: If the command's output format changes, the mock data must be manually updated.

### 2. Real Workspace and Subprocess (Integration Testing)
*   **Pros**:
    *   **High Confidence**: Verifies that the tool works with the actual system binaries.
    *   **Automatic Parsing Validation**: Ensures the regex/parsing logic correctly handles real-world output (including null bytes, newlines, and multi-byte characters).
    *   **Environment Verification**: Confirms the command exists and supports the chosen flags.
*   **Cons**:
    *   **Slower**: Requires setting up a filesystem and spawning external processes.
    *   **Environment Dependent**: Might fail on systems with different versions of the command (e.g., BSD `grep` vs GNU `grep`).
    *   **Setup Overhead**: Requires creating and cleaning up temporary directories and files.

### 3. Hybrid Approach (Recommended)
We should use a combination of both, but with clear roles:

#### A. The "Golden" Integration Test
*   **When**: For every tool using a subprocess.
*   **What**: At least one positive test case and one negative test case using a real `tempfile.TemporaryDirectory`.
*   **Focus**: Verify the command generation and the parsing logic against the actual system output.

#### B. The "Surgical" Unit Test
*   **When**: For complex parsing logic or error handling.
*   **What**: Use mocks to inject specific, tricky output strings (e.g., paths with spaces, extreme line lengths, special characters).
*   **Focus**: Verify that the Python logic (e.g., truncation, JSON formatting) handles these strings correctly.

## Proposed Guidelines for New Tools

1.  **Prefer Integration for Parsing**: Do not mock the output of a command if the primary complexity of the tool is parsing that output. Use a real `TemporaryDirectory`.
2.  **Mock for Resilience**: Use mocks specifically to test how the tool behaves when the command is *missing*, *fails*, or returns *corrupt data*.
3.  **Sanitize Assertions**: In integration tests, use flexible assertions (like `any(...)` or `in`) to handle slight variations in path ordering or whitespace across different system versions.
4.  **Standardized Mocking**: Create a utility fixture or helper that provides a consistent way to mock `subprocess.run` results, reducing boilerplate in unit tests.

## Conclusion
The recent transition from `-Z` to standard output for `grep` highlights that **integration tests are the only effective way to verify parsing logic**. While unit tests are faster, they often hide the very bugs they are intended to find by making assumptions about the output format. For the Ajapopaja Build project, we will prioritize real workspace tests for all subprocess-based tools.
