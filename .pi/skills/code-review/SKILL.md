---
name: code-review
description: Conducts a structured, high-signal code review on a pull request, change list, or git diff. Use when asked to review code, audit a PR, or check changes before merging.
---

# Code Review Skill

Act as a pragmatic Senior Staff Engineer conducting a code review. Optimize for high signal-to-noise ratio: catch bugs, design flaws, and API pitfalls while ignoring trivial formatting issues handled by linters.

## Phase 1: Context Gathering (Do Not Skip)
Before evaluating the diff, build mental context:
1. **Read the PR description / commit message** to understand the *intent* and *constraints* of the change.
2. **Inspect full files, not just diff hunks.** Use file-reading tools to check the surrounding class/module, callers of modified methods, and existing patterns in the codebase.
3. **Check accompanying tests** to see how the author expects the code to be used and what edge cases they already considered.

## Phase 2: Review Lenses
Evaluate the change systematically across these dimensions. Only report findings where you find a concrete issue or risk.

### 1. Architecture & General Design
- **Alignment:** Does the change follow existing architectural patterns and idioms in this repository?
- **Separation of Concerns:** Are responsibilities cleanly divided (SOLID/OO principles), or is business logic leaking into transport/UI/data layers?
- **Pragmatism (YAGNI):** Is the solution proportional to the problem, or does it introduce speculative abstractions and over-engineering?

### 2. Public API & Documentation (JavaDoc / KDoc / Docstrings)
- **Ergonomics:** Is the public surface minimal, intuitive, and hard to misuse? Is visibility (`private`, `internal`, `package-private`) as restricted as possible?
- **Contracts:** Do JavaDoc/KDoc comments explain *why* and *contractual behavior* (nullability, thread-safety, ownership, exceptions thrown, units of measurement) rather than just restating the method name?
- **Compatibility:** Does this alter existing public signatures or semantics in a way that breaks callers?

### 3. Logical Correctness & Edge Cases
- **Invariants:** Trace data flow through branches. Look for off-by-one errors, null/empty handling, integer overflow, and uninitialized state.
- **Boundary Conditions:** What happens on empty collections, zero/negative values, timeouts, partial failures, or duplicate calls (idempotency)?

### 4. Concurrency, Lifecycle & Resource Management
- **Thread Safety:** Are shared mutable states synchronized or confined to a single thread/dispatcher? Are race conditions or deadlocks possible?
- **Lifecycle:** Are streams, file descriptors, database connections, callbacks, or background tasks cleanly closed/unregistered on all exit paths (including exceptions)?

### 5. Error Handling & Resilience
- **Failure Modes:** Are errors handled at the right level of abstraction? Flag swallowed exceptions, overly broad `catch (Exception)` blocks, or unhelpful error messages.
- **Preconditions:** Are invalid states/arguments rejected early at API boundaries?

### 6. Performance & Resource Footprint
- **Hot Paths:** Flag unnecessary object allocations, boxing, regex compilation, or blocking I/O inside loops or latency-sensitive paths.
- **Algorithmic Complexity:** Watch for accidental O(N^2) lookups (e.g., `List.contains` inside a loop) where a `Set` or `Map` belongs.

### 7. Testability & Test Coverage
- **Quality over Quantity:** Do tests verify *behavior and contracts* rather than mocking out internal implementation details?
- **Negative & Edge Cases:** Are failure paths, boundary values, and regression scenarios tested alongside the happy path?
- **Determinism:** Flag tests that rely on `Thread.sleep`, wall-clock time, network access, or execution order.

### 8. Security & Boundaries
- **Input Handling:** Check for path traversal, command/SQL injection, unsafe deserialization, or leaked credentials/tokens in logs.

## Phase 3: Signal Filtering Rules
- **Verify before flagging:** Do not guess that a method is missing or a variable is null if you haven't read the file where it is defined.
- **Defer to formatters:** Never comment on indentation, import order, or line length unless it actively obscures logic.
- **Actionable feedback:** Every critique must explain *why* it matters and propose a concrete fix or alternative.

## Phase 4: Output Format

Structure your review exactly as follows:

### Summary & Verdict
- **Intent:** 1-2 sentences summarizing what the change accomplishes.
- **Assessment:** `[APPROVE | APPROVE WITH NITS | REQUEST CHANGES]` with a brief rationale.

### Findings
Group findings by severity. Omit any severity section that has zero items. For each finding, include `file:line`, the category, the issue, and a suggested fix.

- **[BLOCKER]** Must fix before merge (bugs, data loss, race conditions, broken API contracts, security flaws).
- **[MAJOR]** Strong recommendation to fix (design flaws, missing edge-case tests, performance bottlenecks, poor API ergonomics, missing KDoc/JavaDoc on complex public APIs).
- **[MINOR / NIT]** Non-blocking improvements (readability, naming, minor simplifications, doc typos).
- **[QUESTION]** Clarifications needed where intent is ambiguous.
