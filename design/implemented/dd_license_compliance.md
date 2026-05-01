# Design Document: Dependency License Compliance

**Task ID:** 69dea3aded8dfe2c07581a81
**Status:** PROPOSED

## 1. Goal
Ensure that all third-party dependencies in both the Python (backend) and JavaScript (frontend) projects comply with our project's licensing requirements (Apache License 2.0). We need a repeatable, automated way to audit licenses and detect incompatible ones (e.g., GPL, AGPL) early in the development lifecycle.

## 2. Dependency Overview
- **Backend (Python)**: Managed by `uv` workspaces.
- **Frontend (JS/TS)**: Managed by `npm`.

## 3. Proposed Audit Tools

### 3.1. Python: `pip-licenses`
`pip-licenses` is a lightweight CLI tool that retrieves the license information for all installed packages in a Python environment.
- **Usage**: `uvx pip-licenses --summary --order=license`
- **Integration**: Can be used to generate a CSV or JSON report for CI/CD comparison against an allow-list.

### 3.2. JavaScript: `license-checker-rseidelin`
`license-checker-rseidelin` (an actively maintained fork of `license-checker`) is the industry standard for auditing `node_modules`.
- **Usage**: `npx license-checker-rseidelin --summary`
- **Integration**: Supports a `--failOn` flag to automatically exit with an error if a forbidden license is found.

## 4. Proposed Workflow

### 4.1. Local Audit (Manual)
Developers can run audit commands locally before committing major dependency changes.

### 4.2. CI/CD Integration
Add a `license-check` job to the project's CI pipeline:
1.  **Python Check**:
    ```bash
    uv pip install pip-licenses
    uv run pip-licenses --fail-on "GPL;AGPL;LGPL"
    ```
2.  **JS Check**:
    ```bash
    cd frontend
    npx license-checker-rseidelin --onlyAllow "Apache-2.0;MIT;BSD-2-Clause;BSD-3-Clause;ISC"
    ```

## 5. License Allow-list
The following licenses are considered "safe" and compatible with our project:
- Apache-2.0
- MIT
- BSD-2-Clause / BSD-3-Clause
- ISC
- Unlicense / Public Domain

## 6. Implementation Plan
1.  **Documentation**: Add a `LICENSE_COMPLIANCE.md` file or a section in `README.md` explaining the policy and audit tools.
2.  **Scripts**: Add helper scripts in `package.json` and a Python script (or `uv` command) to simplify auditing.
3.  **Automation**: (Future task) Integrate these checks into the GitHub Actions workflow.

## 7. Verification Plan
- Run the audit tools on the current codebase and verify that no incompatible licenses are present.
- Intentionally add a GPL dependency (in a temporary branch) and verify that the tools correctly flag it.
