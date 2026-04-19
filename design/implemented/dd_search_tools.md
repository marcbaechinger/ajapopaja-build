# Search Tools Documentation

This document describes the search tools available in the Ajapopaja Build assistant. These tools are designed to help AI agents navigate and understand the codebase within a pipeline's workspace.

## Grep Tool

The `grep` tool allows for recursive text searching across files in the workspace. It uses the system `grep` command and respects ignored directories (like `.git`, `node_modules`, etc.).

### API Usage

```python
await grep(
    pipeline_id="pipeline_id",
    pattern="search_pattern",
    file_glob="*.ts",
    ignore_case=True,
    context_lines=2
)
```

### Arguments

- `pipeline_id` (str): The unique identifier of the pipeline.
- `pattern` (str): The regex pattern to search for (Extended Regex syntax).
- `file_glob` (Optional[str]): A glob pattern to filter the files searched (e.g., `*.ts`, `src/**/*.py`).
- `ignore_case` (bool): If set to `True`, the search will be case-insensitive. Defaults to `False`.
- `context_lines` (Optional[int]): The number of lines of context to include before and after each match.

### Result Format

The tool returns a string containing the matching lines, prefixed by the filename and line number. If multiple matches are found across different files, they are listed sequentially.

Example:
```
frontend/src/core/clients/PipelineClient.ts:1:import { BaseClient } from './BaseClient.ts';
frontend/src/core/clients/PipelineClient.ts:3:export class PipelineClient extends BaseClient {
```

If `context_lines` is used, matches are separated by `--` lines.

## Find Tool

The `find` tool searches for files or directories by name.

### API Usage

```python
await find(
    pipeline_id="pipeline_id",
    name_pattern="*.ts",
    type="f"
)
```

### Arguments

- `pipeline_id` (str): The unique identifier of the pipeline.
- `name_pattern` (str): The pattern to match against the filename or directory name.
- `type` (Optional[str]): Use `'f'` for files or `'d'` for directories.

## Tree Tool

The `tree` tool provides a visual representation of the directory structure.

### API Usage

```python
await tree(
    pipeline_id="pipeline_id",
    path="src",
    depth=2
)
```

### Arguments

- `pipeline_id` (str): The unique identifier of the pipeline.
- `path` (str): The relative path to the directory to visualize. Defaults to `"."`.
- `depth` (Optional[int]): The maximum depth of the tree to display.
- `follow_symlinks` (bool): Whether to follow symbolic links. Defaults to `False`.
