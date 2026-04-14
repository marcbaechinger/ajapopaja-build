# Dependency License Compliance Guide

This document outlines the policy and procedures for ensuring that all third-party dependencies used in **Ajapopaja Build** comply with the project's **Apache License 2.0**.

## 1. License Policy

We only allow dependencies with "permissive" licenses. Using dependencies with "copyleft" or "reciprocal" licenses (like GPL or AGPL) is strictly prohibited as they may impose requirements that are incompatible with our project's goals.

### 1.1. Allowed Licenses
- Apache-2.0
- MIT / MIT-0
- BSD-2-Clause / BSD-3-Clause
- ISC
- 0BSD
- CC0-1.0
- BlueOak-1.0.0
- Unlicense / Public Domain
- Python Software Foundation License (PSFL)

### 1.2. Prohibited Licenses
- GPL (v2, v3)
- LGPL (unless explicitly reviewed)
- AGPL
- SSPL

---

## 2. Auditing Python Dependencies

We use `pip-licenses` to audit the backend.

### 2.1. Run a Summary Audit
```bash
cd backend
uv pip install pip-licenses
uv run python -m piplicenses --summary
```

### 2.2. CI Compliance Check
To check for prohibited licenses (fails if found):
```bash
cd backend
uv run python -m piplicenses --fail-on "GPL;AGPL;LGPL"
```

---

## 3. Auditing JavaScript Dependencies

We use `license-checker` to audit the frontend.

### 3.1. Run a Summary Audit
```bash
cd frontend
npm run license-check:summary
```

### 3.2. CI Compliance Check
This command will fail if an unapproved license is detected:
```bash
cd frontend
npm run license-check
```

---

## 4. Resolving Violations

If an incompatible license is detected:
1. **Find Alternatives**: Look for a replacement package with a permissive license.
2. **Review Usage**: If the package is only used for development (and not bundled/distributed), it *might* be acceptable after legal review.
3. **Request Exception**: If no alternative exists, open a discussion issue before proceeding.
