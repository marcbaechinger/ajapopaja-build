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
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pipelineId` | `string` | – | Pipeline whose repository is browsed. |
| `client` | `FileBrowserClient` | – | Read-only fetch client (list/read). |
| `actionRegistry` | `ActionRegistry` | – | Registry for the browser's actions (`file_browser_*`, `copy_file_path`). |
| `resizable` | `boolean` | `false` | When `true`, the main content panel can be resized vertically by dragging its bottom edge. Width is never resizable and the breadcrumb/status bars stay fixed. |

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
