# Design: Download button in the FileView

Task: **Add a download button in the FileView**
(`6ac7fcf477e2755e5d03373d`)

## 1. Goal

Add a **download** button to the `FileView` header, directly next to the
existing *copy path* button, in the same muted/rounded icon-button style. On
click the browser opens a save dialog so the user can choose where to write the
full file — including binary and truncated files.

Affected file: `frontend/src/ui/components/files/FileView.ts`
(sibling changes in `FileBrowseView.ts`, `icons.ts`, `icons.svg`,
`FileBrowserClient.ts`).

## 2. Why this is not just `<a href="/files/content" download>`

- `GET /files/content` returns a **JSON `FileContent`**, not raw bytes, and
  truncates text at 1 MiB. Binary files have no `content` at all.
- The API is **authenticated** with a bearer token that a plain browser
  navigation/`download` link cannot attach.

So the download must go through the already-designed raw-file endpoint, which
already solves both problems: a short-lived, path-bound `file:raw` token and a
binary-safe streaming response (see `design/proposed/dd_file_raw_open.md` §3–4).
This design **reuses** that endpoint rather than opening files a second way.

> Dependency: if the raw-file endpoint is not implemented yet, this task ships
> it first (or together) — the download button cannot stream full/binary files
> without it.

## 3. Backend change

Extend the raw endpoint with an optional attachment mode; keep the default
`inline` behaviour used by the "raw" button:

```python
@router.get("/raw")
async def read_raw_file(pipeline_id: str, token: str = Query(...),
                        download: bool = False):
    ...
    disposition = "attachment" if download else "inline"
    headers = {"Content-Disposition":
               f"{disposition}; filename*=UTF-8''{quote(path.name)}", ...}
    return FileResponse(resolved, media_type=guess_media_type(resolved.name),
                        headers=headers)
```

Only the basename is exposed, never the absolute path. All path-safety and token
checks stay as designed in `dd_file_raw_open.md`.

## 4. Frontend design

### 4.1 Icon

Add a download glyph to the sprite and map it:

- `frontend/public/icons.svg`:
  ```html
  <symbol id="download-icon" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
  </symbol>
  ```
- `frontend/src/ui/components/common/icons.ts`: `download: 'download-icon',`

### 4.2 Button — `FileView.renderHeader`

Immediately after the copy button (same classes, `p-1`, size 14):

```html
<button type="button" data-action-click="download_file" data-path="<path>"
  class="shrink-0 p-1 rounded text-app-muted hover:text-app-text hover:bg-app-surface/60 transition-colors cursor-pointer"
  title="Download file" aria-label="Download file">
  ${Icon.render('download', { size: 14 })}
</button>
```

Rendered for **every** file (text, binary, truncated): downloading is exactly
how a binary/truncated file can be obtained in full.

### 4.3 Action

Register `download_file` in `FileBrowseView.registerActions()` (that class owns
both the `FileBrowserClient` and the `pipelineId`); `FileView.registerActions()`
stays context-free.

Flow (registered in `FileBrowseView`):

1. `const path = element.getAttribute('data-path')`.
2. `const { token } = await this.client.createRawFileToken(this.pipelineId, path)`
   — new client helper mirroring `readFile`, hits `POST …/files/raw-url`.
3. Prefer the **File System Access API** so a save dialog is guaranteed:
   ```ts
   const url = this.client.rawFileUrl(this.pipelineId, token, { download: true });
   const response = await fetch(url);                      // token in query
   if (window.showSaveFilePicker) {
     const handle = await window.showSaveFilePicker({ suggestedName: file.name });
     const writable = await handle.createWritable();
     await response.body.pipeTo(writable);                 // streamed, no buffering
   } else {
     // Fallback: blob + temporary <a download>
     const blob = await response.blob();
     const objectUrl = URL.createObjectURL(blob);
     const a = document.createElement('a');
     a.href = objectUrl; a.download = file.name; a.click();
     URL.revokeObjectURL(objectUrl);
   }
   ```
4. Best-effort UI feedback: briefly swap the icon for a check
   (reuse `FileView.showCopiedFeedback`), or show a toast on failure.

Note: `fetch` cannot reuse `BaseClient.fetch` here because the raw request is
authenticated by the token query param, not the bearer header. The mint call
itself *does* go through `BaseClient`.

### 4.4 Client — `FileBrowserClient`

- `createRawFileToken(pipelineId, path)` → `POST …/files/raw-url?path=…`
  (returns `{ token, expires_in }`).
- `rawFileUrl(pipelineId, token, opts?)` →
  `…/files/raw?token=<enc>[&download=1]`.

## 5. Testing

- `FileView.test.ts`: header renders a `download` button with `data-path`,
  `data-action-click="download_file"` and an accessible label; present for
  binary and truncated files too.
- `icons.svg` / `Icon.test.ts`: `download` symbol exists and resolves.
- `FileBrowseView.test.ts`: clicking mints a token and calls
  `showSaveFilePicker` (mock) with `suggestedName`; without the picker API it
  creates an `<a download>` fallback.
- Backend (`test_file_browser_routes.py`): `?download=1` returns
  `Content-Disposition: attachment; filename*=…` and full binary bytes.

## 6. Out of scope

- Zip/multi-file download; per-directory download.
- Progress UI for very large files (the streamed picker path shows the
  browser's own progress).
