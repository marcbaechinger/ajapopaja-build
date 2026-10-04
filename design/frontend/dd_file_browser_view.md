# Design: File Browser View

## 1. Overview
`FileBrowseView` (`frontend/src/ui/components/FileBrowseView.ts`) is the
read-only repository browser shown in the **File Browser** tab of the
`PipelineDetailView`. It owns a stable shell (top/bottom breadcrumbs and a main
content panel) and re-renders only the fragments that changed as the user
navigates directories or opens files. All HTTP access goes through
`FileBrowserClient`, and a monotonically increasing request id discards stale
responses from fast clicking.

The main panel is rendered by one of two fragments:
- `DirectoryView` — the directory listing (name, size, modified, git status).
- `FileView` — a single file's metadata header plus a syntax-highlighted,
  read-only code block.

## 2. Public API
`FileBrowseView` is constructed with a mount element and a
`FileBrowseViewOptions` object:

```ts
export interface FileBrowseViewOptions {
  pipelineId: string;
  client: FileBrowserClient;
  actionRegistry: ActionRegistry;
  /** Optional; default false. */
  resizable?: boolean;
  /** Explicit route path ('' = root). null/omitted = persisted lastPath. */
  initialPath?: string | null;
  /** Emitted for user-initiated navigation only. */
  onNavigate?: (state: { dir: string; file: string | null }) => void;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pipelineId` | `string` | – | Pipeline whose repository is browsed. |
| `client` | `FileBrowserClient` | – | Read-only fetch client (list/read). |
| `actionRegistry` | `ActionRegistry` | – | Registry for the browser's actions (`file_browser_*`, `copy_file_path`). |
| `resizable` | `boolean` | `false` | When `true`, the main content panel can be resized vertically by dragging its bottom edge. Width is never resizable and the breadcrumb/status bars stay fixed. |
| `initialPath` | `string \| null` | `null` | Explicit repo-relative path from the route. A non-empty value wins over the persisted `lastPath:`; `null`/omitted falls back to `lastPath:`; `''` explicitly selects the repository root. |
| `onNavigate` | `(state) => void` | – | Called with `{ dir, file }` only for user-initiated navigation (entry click, breadcrumb, file open) — never for `render()`/initial-restore, route-driven (`navigateTo(…, { silent: true })`) or `refresh()` loads. |

### Path resolution and the route

`render()` follows the precedence `initialPath` (non-empty) > persisted
`lastPath:` > repository root, then calls `navigateTo(initialPath, { silent: true })`
for an explicit path:

```ts
async navigateTo(path: string, opts: { silent?: boolean } = {}): Promise<void> {
  if (!path) return this.loadDirectory('', opts);
  try {
    const meta = await this.client.getMeta(this.pipelineId, path);
    if (meta?.isDir === false) return this.openFile(path, opts);
  } catch { /* fall through: treat as a directory */ }
  return this.loadDirectory(path, opts);
}
```

`getMeta()` decides file vs. directory in one request (a missing `isDir` on a
test double / older backend defaults to a directory), and a directory load
still surfaces the normal error state on failure. `loadDirectory()` and
`openFile()` accept the same `{ silent }` flag; only non-silent calls emit
`onNavigate`, which is what prevents a push/`hashchange` feedback loop.
`getCurrentPath()` returns `{ dir, file }` for host-side idempotence checks.
The existing `requestId` stale-guard covers any overlap introduced by the extra
`getMeta()` request.


## 3. Resizable height
The option mirrors the established resizable-log pattern in `PiView`:

- **Non-resizable (default):** the main panel uses
  `flex-1 min-w-0 flex flex-col overflow-hidden`, filling the remaining space
  of the fixed-height shell exactly as before.
- **Resizable:** the main panel uses `resize-y overflow-x-hidden h-[70vh]`.
  `resize-y` restricts the drag to the height (never the width);
  `overflow-x-hidden` supplies the non-`visible` overflow that the native
  resize handle requires while preventing horizontal overflow; `h-[70vh]` is
  the initial height. Subsequent adjustments are handled by the browser's
  native `resize` behaviour, so no JavaScript is needed to persist the new
  size.

The outer shell uses `min-h-[70vh]` instead of a fixed `h-[70vh]`, so it grows
with the main panel instead of clamping the resizable panel to a fixed height.

## 4. Implementation notes
- `PipelineDetailView.mountFileBrowseView()` constructs the view with
  `resizable: true` so the File Browser tab is adjustable by default.
- Existing callers that omit `resizable` render exactly as before.

## 5. Testing
- Unit tests in `FileBrowseView.test.ts` assert the default class string and
  the `resize-y overflow-x-hidden h-[70vh]` class string when `resizable` is
  enabled, plus that `resize-x` is never present.
- Existing directory-listing, breadcrumb, file-opening and refresh tests
  continue to pass.
