# Design: "Open raw" file in a new tab

## 1. Overview

Add a small **`raw`** button to the `FileView` header, next to the file title
and the existing *copy path* button, styled like the copy button. Clicking it
opens a new browser tab that streams the selected file from the pipeline
workspace with a best-effort `Content-Type`, so the browser renders or
downloads it natively (images, PDFs, JSON, Markdown, logs, …).

The hard part is authentication: a browser navigation (`window.open`, `<a
href>`, new tab) **cannot attach the `Authorization: Bearer` header** that
every other API call uses. The design solves this with a short-lived,
path-bound, signed URL token minted by an authenticated endpoint — the
"one-time token that expires" the task spec hints at, with one deliberate
adjustment (see §3.2).

## 2. Requirements

- `raw` button next to the title/copy button, same visual style as the copy
  button, labelled `raw`.
- A new tab displays the file with a reasonable MIME type.
- Only authenticated access is possible.
- Serves the **full** file (the existing `/content` endpoint truncates text at
  1 MiB and refuses to return binary bytes); binary files must work, since the
  raw view is their only useful representation.
- Read-only; reuses the existing path-escape / `.git`-exclusion safety.

## 3. Authentication design

### 3.1 Options considered

| Option | Why not |
| --- | --- |
| A. Append the current 30-minute **access token** as a query parameter | Leaks a long-lived bearer credential into browser history, server access logs and (potentially) the `Referer` header. Same weakness already accepted for WebSockets, but a 30-min token in a copy-pastable URL is worse. |
| B. Use the existing HttpOnly **refresh cookie** for a top-level GET | Works (cookies are sent on same-origin navigation), but promotes a 7-day refresh credential into a general read credential and widens the CSRF surface. Refresh tokens are currently only honored at `/api/auth/refresh`. |
| C. **Short-lived, path-bound signed URL token** (chosen) | Adds one authenticated "mint" round-trip, but keeps the long-lived credentials out of URLs and keeps the raw endpoint stateless. |

### 3.2 Chosen: short-lived, path-bound signed token

Two new endpoints:

1. `POST /api/pipelines/{pipeline_id}/files/raw-url?path=<rel>` — authenticated
   with the normal `get_current_user` dependency. Validates the path (fails
   fast on traversal / missing / directory) and returns a signed token plus its
   TTL.
2. `GET /api/pipelines/{pipeline_id}/files/raw?token=<jwt>` — **no**
   `get_current_user` dependency; the token *is* the authentication. The file
   path is taken **from the token**, not from the URL, so the URL cannot be
   edited to read a different file.

Token claims (JWT, HS256, same `SECRET_KEY`/`ALGORITHM` as the rest of the app):

```json
{
  "sub": "<username>",
  "scope": "file:raw",
  "pipeline_id": "<pipeline>",
  "path": "<validated repo-relative path>",
  "jti": "<uuid4>",
  "exp": "<now + 60s>"
}
```

The token binds **user + pipeline + exact path** together. The consume
endpoint additionally checks that `pipeline_id` matches the route, so a token
minted for pipeline A cannot be replayed against pipeline B.

**Why 60 s (and not strict single-use)?** A file viewer (PDF.js, images, video,
large text) issues retries and HTTP `Range` requests; a strictly one-time token
would break the second request and make the feature flaky. The short TTL plus
the user/pipeline/path binding gives the same practical protection with none of
the failure modes. `jti` is still included so a later revision can add a
best-effort single-use check for non-`Range` requests if it is ever needed.

### 3.3 Token-confusion prevention (important)

`get_current_user` currently accepts **any** valid JWT with a `sub`. A raw
token therefore would also authenticate the whole REST API and the root
WebSocket. All token-decoding entry points must reject `scope == "file:raw"`:

- `api.auth.get_current_user` (HTTP dependency),
- `api.auth.get_current_user_from_token` (WS/notifications/MCP),
- the root `websocket_endpoint` in `api/main.py`, which decodes the JWT
  directly instead of calling the helper.

Preferably centralise this in one `decode_token` helper so future entry points
inherit the check. Refresh/login paths already reject raw tokens because they
require `refresh: true` or issue new tokens.

### 3.4 Frontend flow (popup-blocker safe)

`window.open()` must be called **synchronously inside the click handler**, or
the browser blocks the popup. Because minting the token is `async`, the handler
opens a blank tab first and navigates it once the token arrives:

```ts
register('open_file_raw', async (_event, element) => {
  const path = element.getAttribute('data-path');
  if (!path) return;
  const win = window.open('', '_blank');   // synchronous → allowed
  if (win) win.opener = null;             // no opener access for the raw doc
  try {
    const { token } = await this.client.createRawFileToken(this.pipelineId, path);
    const url = this.client.rawFileUrl(this.pipelineId, token);
    if (win) win.location.href = url;
    else window.location.href = url;      // popup blocked fallback
  } catch (error) {
    win?.close();
    console.error('Failed to open raw file:', error);
  }
});
```

## 4. Backend design

### 4.1 Auth helpers — `backend/api/src/api/auth.py`

- `RAW_FILE_SCOPE = "file:raw"`
- `RAW_FILE_TOKEN_TTL_SECONDS = 60`
- `create_raw_file_token(username, pipeline_id, path) -> str`
- `decode_raw_file_token(token) -> RawFileToken` — verifies signature/expiry and
  that `scope == RAW_FILE_SCOPE`; raises `HTTPException(401)` otherwise.
- Reject `RAW_FILE_SCOPE` in `get_current_user` / `get_current_user_from_token`;
  add the same check in `api/main.py`'s WebSocket handshake.

### 4.2 Service — `backend/core/src/core/services/file_browser.py`

- Add a public `resolve_file(pipeline, rel_path) -> tuple[Path, str]` helper
  that wraps the existing `_resolve_path(..., allow_root=False)` and the
  `is_dir` / `is_file` checks. Both `read_file` and the new raw endpoint then
  share the exact same `safe_join` / `sanitize_relative_path` / `.git`
  exclusion behaviour — no duplicated path logic.
- Add `guess_media_type(name) -> str`:
  - explicit override map for developer extensions that `mimetypes` gets wrong
    (`file.ts` resolves to `video/mp2t` on many systems) → force
    `text/plain; charset=utf-8` for source/config extensions (`.ts`, `.tsx`,
    `.js`, `.jsx`, `.md`, `.yml`, `.yaml`, `.toml`, `.py`, `.rs`, `.go`, …);
  - otherwise `mimetypes.guess_type`; append `; charset=utf-8` for `text/*`;
  - unknown → `application/octet-stream`.

### 4.3 Routes — `backend/api/src/api/routes/file_browser.py`

```python
class RawFileUrl(BaseModel):
    token: str
    expires_in: int

@router.post("/raw-url", response_model=RawFileUrl)
async def create_raw_file_url(
    pipeline_id: str,
    path: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
):
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    _resolved, clean = FileBrowserService.resolve_file(pipeline, path)
    return RawFileUrl(
        token=create_raw_file_token(current_user.username, pipeline_id, clean),
        expires_in=RAW_FILE_TOKEN_TTL_SECONDS,
    )

@router.get("/raw")
async def read_raw_file(pipeline_id: str, token: str = Query(...)):
    claims = decode_raw_file_token(token)          # 401 on bad/expired
    if claims.pipeline_id != pipeline_id:
        raise HTTPException(403, "Token does not match this pipeline")
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    resolved, _ = FileBrowserService.resolve_file(pipeline, claims.path)
    return FileResponse(resolved, media_type=guess_media_type(resolved.name), headers={...})
```

Error mapping: invalid/expired token → 401; wrong pipeline or path escape →
403; missing/`.git` → 404; directory → 400. The raw handler returns a
`Response`, so it wraps `resolve_file` in the existing `_handle` translation
(or an explicit `try/except` with the same mapping).

### 4.4 Response headers / MIME

`FileResponse` streams efficiently and supplies `Content-Length`,
`Last-Modified`, `ETag` and `Range` support (needed for PDF/video). On top:

| Header | Value | Why |
| --- | --- | --- |
| `Content-Type` | `guess_media_type(name)` | Reasonable MIME. |
| `Content-Disposition` | `inline; filename*=UTF-8''<percent-encoded>` | Display inline; only the basename is exposed, never the absolute path. |
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing surprises. |
| `Content-Security-Policy` | `sandbox` | A repo-controlled `.html`/`.svg` opened at the app origin must not execute scripts. |
| `Cache-Control` | `private, no-store` | Token-bearing URLs must not be cached by shared caches. |

## 5. Frontend design

### 5.1 Client — `frontend/src/core/clients/FileBrowserClient.ts`

- `createRawFileToken(pipelineId, path)` → `POST .../files/raw-url?path=…`
  through `BaseClient` (so it inherits the bearer token + 401 refresh/retry);
  returns `{ token, expires_in }`.
- `rawFileUrl(pipelineId, token)` → `` `${this.baseUrl}/pipelines/${pipelineId}/files/raw?token=${encodeURIComponent(token)}` ``.

### 5.2 Button — `frontend/src/ui/components/files/FileView.ts`

In `renderHeader`, immediately after the copy-path button:

```html
<button type="button" data-action-click="open_file_raw" data-path="<path>"
  data-role="open-raw"
  class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide
         text-app-muted hover:text-app-text hover:bg-app-surface/60 transition-colors cursor-pointer"
  title="Open raw file" aria-label="Open raw file">raw</button>
```

Same muted/rounded hover treatment as the copy button, but with a visible
`raw` text label. The button is rendered for **every** file, including binary
and truncated ones, because raw is exactly the way to see the full/binary
content.

### 5.3 Action registration

The handler needs the pipeline id and the client, so it is registered in
`FileBrowseView.registerActions()` (which owns both) rather than in the static,
context-free `FileView.registerActions()`. `FileBrowseView` is currently the
only renderer of `FileView`, so this keeps the context-free contract intact.

If `FileView` is ever rendered outside the browser, the same action can be
registered in `AppContext.initGlobalActions()` resolving the pipeline id like
`open_search` already does (from `data-pipeline-id` or the URL hash).

## 6. Security summary

- Secrets never enter URLs: only a 60 s token bound to one file is exposed.
- Raw scope is rejected everywhere an access token is accepted (§3.3).
- Path safety (symlink escape, `..`, absolute paths, `.git`) is reused via
  `FileBrowserService.resolve_file`.
- `nosniff` + `Content-Security-Policy: sandbox` neutralise HTML/SVG content.
- No absolute filesystem paths leak (only the basename in
  `Content-Disposition`).

## 7. Testing

**Backend** (`backend/tests/routes/test_file_browser_routes.py`):

- `POST /raw-url` requires authentication (401 without override).
- Mint returns a token + `expires_in`; the minted path is normalised.
- `GET /raw?token=…` returns 200 with the right `Content-Type` and
  `Content-Disposition`, and streams the full binary content (no 1 MiB cut).
- No/expired/garbage token → 401; token for a different pipeline → 403;
  `.git`/missing → 404; directory → 400.
- `.ts` is served as `text/plain`, not `video/mp2t`.
- Safety regression: a raw token passed to `/api/auth/me` (and the WS
  handshake) is rejected.
- Note: the existing autouse `mock_auth` fixture only overrides
  `get_current_user`; raw-consumption tests must clear overrides and mint a
  real token via `create_raw_file_token` / drive the mint endpoint.

**Frontend**:

- `FileBrowserClient.test.ts`: `createRawFileToken` posts to the right URL with
  the bearer header; `rawFileUrl` encodes the token.
- `FileView.test.ts`: header renders a `raw` button carrying `data-path`,
  `data-action-click="open_file_raw"` and the `raw` label; it is present for
  binary files too.
- `FileBrowseView.test.ts`: clicking the button mints a token, opens a window
  synchronously and points it at the raw URL; a mint failure closes the tab.

## 8. Alternatives / follow-ups

- **Single-use tokens** via an in-memory `jti` TTL set: rejected for v1 because
  it breaks `Range`/retry semantics; the `jti` claim leaves the door open.
- **`<a href download>` with a cookie**: would require a new cookie-based auth
  path and a CSRF review; deferred.
- **Signed, time-limited URL via a dedicated secret** (e.g.
  `RAW_FILE_TOKEN_SECRET_KEY`): possible hardening; the shared secret plus the
  `scope` check is sufficient for a single-service app.
- Optionally surface the guessed MIME type in the `FileContent` model so the
  button can show a tooltip; not required for the feature.

## 9. Implementation checklist

- [ ] `backend/api/src/api/auth.py` — scope constant, `create_raw_file_token`,
      `decode_raw_file_token`, raw-scope rejection.
- [ ] `backend/api/src/api/main.py` — reject raw scope in the WS handshake.
- [ ] `backend/core/src/core/services/file_browser.py` — `resolve_file`,
      `guess_media_type`.
- [ ] `backend/api/src/api/routes/file_browser.py` — `RawFileUrl`,
      `POST /raw-url`, `GET /raw`.
- [ ] `frontend/src/core/clients/FileBrowserClient.ts` — token + URL helpers.
- [ ] `frontend/src/ui/components/files/FileView.ts` — `raw` button.
- [ ] `frontend/src/ui/components/files/FileBrowseView.ts` — `open_file_raw`
      action.
- [ ] Backend + frontend tests.
- [ ] Optional: design note in `design/backend/dd_user_authentication.md`
      documenting the `file:raw` scope.
