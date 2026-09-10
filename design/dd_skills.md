# Design Document: Self-Contained Ajapopaja Pi Skill (`dd_skills.md`)

## 1. Overview

The Ajapopaja Build project ships a **Pi** skill (`.pi/skills/ajapopaja/SKILL.md`) that lets a coding agent interact with the Ajapopaja Build MCP server for task management. Today the skill is **not self-contained**: it references the helper script by an absolute repository path (`backend/mcp/src/scripts/mcp_client.py`). If the skill directory is copied to a user's skill location or a shared location, that path breaks and the skill stops working.

This document proposes making the skill **self-contained** so the entire `ajapopaja/` directory can be copied anywhere and still function, and restructuring the skill around a clear **basic workflow** while preserving all existing functionality as auxiliary.

## 2. Goals & Non-Goals

### Goals
- Make the `ajapopaja/` skill directory fully self-contained (bundled helper script, relative paths).
- Define a clear, primary workflow: **get next task → implement → propose commit message → mark completed**.
- Preserve all existing functionality (search, status, details, design-doc updates, spec updates, tool listing) as auxiliary actions.
- Keep the skill compatible with the [Agent Skills standard](https://agentskills.io/specification) and Pi's skill loading rules.

### Non-Goals
- Changing the MCP server protocol or the `mcp_client.py` CLI interface.
- Adding new MCP tools.
- Changing how Pi discovers or loads skills.

## 3. Current State

The skill lives at `.pi/skills/ajapopaja/SKILL.md` and documents a CLI built on `mcp_client.py`. The script is located at `backend/mcp/src/scripts/mcp_client.py` and is invoked with absolute repository-relative paths, e.g.:

```bash
python3 backend/mcp/src/scripts/mcp_client.py --url http://localhost:8000 get-task <pipeline_id>
```

**Problem:** The skill is not portable. Copying `ajapopaja/` to `~/.pi/agent/skills/` or a shared location breaks every command because the script path no longer resolves.

## 4. Proposed Design

### 4.1. Bundle the Helper Script

Copy `mcp_client.py` into the skill directory so the skill is self-contained:

```
ajapopaja/
├── SKILL.md          # Instructions + workflow
└── mcp_client.py     # Bundled CLI helper (self-contained)
```

The skill then invokes the script with a **relative path** from the skill directory:

```bash
python3 ./mcp_client.py --url http://localhost:8000 <command> ...
```

Because the script is bundled, the directory can be copied to any skill location (user skills, shared skills, project skills) and still work. The script's only external dependency is `httpx`, which the skill documents as a one-time setup step (`pip install httpx`).

### 4.2. Restructure SKILL.md Around a Primary Workflow

The skill is reorganized so the **basic workflow** is the primary, prominent content, with all other functionality preserved but clearly marked as auxiliary.

**Primary workflow (4 steps):**

1. **Get the next task** – `get-task <pipeline_id>` picks up the next `scheduled` task and moves it to `inprogress`.
2. **Implement the task** – `get-task-details <task_id>` retrieves the spec/design doc; if the task requires a design doc (`want_design_doc`), `update-design-doc` is used first; then the agent implements the task in the workspace.
3. **Propose a commit message** – the agent proposes a commit message for the commit that implements the task.
4. **Mark the task as completed** – `complete-task <task_id> --commit <hash> --info <summary> --version <v>` records the commit and marks the task `implemented`.

**Auxiliary actions (preserved):**
- `list` – list available MCP tools.
- `search-tasks` – search by keywords/status/pipeline with pagination.
- `get-task-status` – check status and verification results.
- `update-task-spec` – update a task's specification.
- `update-design-doc` – provide/update a design document (also used in step 2 when required).

### 4.3. Frontmatter

The frontmatter (`name`, `description`) is preserved unchanged so skill discovery and the `/skill:ajapopaja` command keep working.

## 5. Design Decisions

### 5.1. Bundle vs. Reference the Script
**Challenge:** Keep the skill portable without duplicating maintenance.
**Decision:** Bundle a copy of `mcp_client.py` in the skill directory. This is the standard pattern for self-contained skills (see the Agent Skills standard and Pi's skill docs, which recommend relative paths and bundled helper scripts). The script is small, stable, and has a single external dependency (`httpx`). Keeping the canonical copy in `backend/mcp/src/scripts/` is acceptable; the skill copy is the portable distribution.

### 5.2. Relative Paths
**Challenge:** Ensure commands work regardless of where the skill is installed.
**Decision:** Use `./mcp_client.py` (relative to the skill directory) instead of repository-absolute paths. Pi resolves relative paths from the skill directory, so this works in any location.

### 5.3. Workflow-First Structure
**Challenge:** Make the skill's purpose obvious while retaining full functionality.
**Decision:** Present the 4-step workflow as the primary section and group the remaining commands under an "Auxiliary Actions" section. This keeps the skill complete while making the intended usage clear.

## 6. Implementation Plan

1. **Copy the script** – copy `backend/mcp/src/scripts/mcp_client.py` to `.pi/skills/ajapopaja/mcp_client.py`.
2. **Rewrite `SKILL.md`** – restructure around the 4-step workflow, switch all commands to `./mcp_client.py`, add a Setup section, and move non-core commands under "Auxiliary Actions".
3. **Write this design document** – `design/dd_skills.md`.
4. **Verify** – run a command from the skill directory (e.g. `python3 ./mcp_client.py --url http://localhost:8000 list`) to confirm the bundled script works.

## 7. Migration / Compatibility

- No changes to the MCP server, the CLI interface, or the script's behavior.
- Existing users of the skill get the same commands; only the invocation path changes (from `backend/mcp/src/scripts/mcp_client.py` to `./mcp_client.py`).
- The skill remains valid per the Agent Skills standard and Pi's skill validation (valid frontmatter, non-empty description, relative paths).
