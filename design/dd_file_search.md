# Design: Pipeline File Search (`FileSearchInputView` + backend)

## 1. Context and goal

The File Browser tab of `PipelineDetailView` currently lets the user browse a
pipeline repository directory by directory. For larger repositories this is
slow to navigate: the user has to know the path. We want a small, fast,
as-you-type **file search** in the File Browser header so the user can jump
directly to a file (or directory) by typing part of its name/path.

Concretely (from task `6ac5812c174a96cecdbcfa2c`):

* A new reusable `FileSearchInputView` component: a compact text field with an
  **optional, default-off** search button.
* It is placed in the File Browser header, **left of the Refresh button**, with
  a delimiter between them; it must not change the header height.
* Enter or the button issues a search. Results are shown as a list sorted by
  path (name search mandatory, path search desirable) and selecting a result
  displays it in `FileBrowseView`.
* The component is designed to be embeddable elsewhere later.
* **The main problem to solve is the backend and the wire protocol** for the
  widget (HTTP vs. WebSocket), with a search that is fast enough for a great
  as-you-type experience while keeping memory/CPU/disk usage bounded.

This document focuses on the backend and on the speed/resource trade-offs. The
frontend component is specified only to the extent needed to fix the contract.

## 2. Requirements and constraints

| # | Requirement |
|---|-------------|
| R1 | Filename search is mandatory; path search is a plus. |
| R2 | As-you-type target: p95 server response **< 50 ms** on a warm index; first query may be slower but must not block the event loop. |
| R3 | Results sorted deterministically, ideally name matches first then by full repo-relative path. |
| R4 | Memory must be capped and idle indexes must expire; the server runs on a modest host. |
| R5 | The index must reflect the current working tree closely enough (short TTL is acceptable). |
| R6 | Must respect `IGNORED_DIRECTORIES` and never expose absolute paths. |
| R7 | Read-only; must not mutate the repository. |
| R8 | Reuse existing auth (`get_current_user`), error mapping and the File Browser router/client patterns. |

## 3. Evaluation criteria

* **Latency**: steady-state query latency and worst-case (cold) latency.
* **CPU / disk**: cost per keystroke and per cache miss.
* **Memory**: resident cost per indexed repository and total.
* **Freshness**: how quickly working-tree changes appear.
* **Operational complexity**: moving parts, dependencies, failure modes.
* **Implementation cost**: code that must be written and maintained.

## 4. Options considered (summary)

| Option | Query latency | Memory | Freshness | Complexity |
|--------|---------------|--------|-----------|------------|
| A. Walk the tree per keystroke (`os.walk`/`find`) | 50–500 ms+ | ~0 | instant | low |
| B. `git ls-files` per request | 20–100 ms + spawn | ~0 | instant | low |
| C. `rg --files` / `fd` / `plocate` per request | 10–60 ms + spawn | ~0 | instant | med (new dep) |
| **D. In-memory per-pipeline path index (recommended)** | **2–10 ms** | **bounded, LRU+TTL** | **≤ soft TTL** | med |
| E. Persistent on-disk index (SQLite FTS / custom) | 1–5 ms | OS page cache | needs invalidation | high |
| F. Trigram / trie inverted index in memory | < 2 ms | large | ≤ soft TTL | high |
| G. WebSocket search channel | same as D + framing | same | same | high |
| H. Ship index to browser and search client-side | 0 ms after download | browser + leak | poor | med |

The recommended option is **D** served over **HTTP**. The rest are detailed and
rejected in §6.

## 5. Recommended design

### 5.1 Architecture overview

```
FileSearchInputView (frontend)
   │  debounce 150 ms, AbortController (cancel stale request)
   ▼
GET /api/pipelines/{id}/files/search?q=…&limit=20
   │
   ▼
api/routes/file_browser.py :: search_files()      (thin HTTP layer)
   │  auth + error mapping + pipeline lookup
   ▼
core/services/file_search.py :: FileSearchService (reusable, no FastAPI)
   │
   ├── FileSearchIndexManager  (module-level singleton, LRU + TTL)
   │       └── per-pipeline PathIndex  (immutable snapshot)
   │
   └── asyncio.to_thread(build_index)  (os.walk, single-flight lock)
```

The index lives in the `core` service layer so agent tools (assistant `find`)
can reuse it later. All FastAPI concerns stay in the route.

### 5.2 What is indexed

A single `os.walk` of the resolved pipeline root, skipping:

* every directory whose basename is in `IGNORED_DIRECTORIES`
  (`.git`, `node_modules`, `.venv`, `__pycache__`, `dist`, `.pytest_cache`,
  `.logs`), and
* any symlinked directory escaping the root (the walk already runs on the
  resolved root; do **not** follow links).

For every file and directory we store the smallest useful tuple:

```python
@dataclass(frozen=True, slots=True)
class PathRecord:
    path: str        # repo-relative POSIX, e.g. "frontend/src/main.ts"
    name: str        # basename, e.g. "main.ts"
    is_dir: bool
```

An immutable snapshot is stored:

```python
@dataclass(frozen=True)
class PathIndex:
    root: str            # resolved workspace root (cache key / authorization scope)
    records: tuple[PathRecord, ...]
    built_at: float      # monotonic timestamp
    truncated: bool      # True when entry/byte caps were hit
```

We deliberately do **not** precompute casefolded copies in v1. Case-insensitive
matching is done with `str.casefold()` on the needle and a per-record
`name.casefold()`/`path.casefold()` fallback only when needed. If profiling
shows it matters, a parallel `names_fold` tuple can be added behind the same
snapshot without changing the API. (Rationale in §5.9.)

`is_dir` is included so selecting a directory navigates into it; the task only
requires files, but directories cost almost nothing and make the widget more
useful.

### 5.3 Build: single-flight, off the event loop

* Building the index is CPU/disk work and must never run on the asyncio event
  loop. Use `asyncio.to_thread(self._build_sync, root)` (Python ≥ 3.11 is
  guaranteed by the project).
* Per pipeline-key there is an `asyncio.Lock`. Concurrent first queries either
  wait for the in-flight build or share the same `asyncio.Task` (single-flight)
  so N tabs opening at once still produce exactly one walk.
* `_build_sync` uses `os.walk`, checks the caps while walking, and returns the
  snapshot. A failed walk raises `UnreadablePathError` → HTTP 500 by the
  existing `_handle` mapping.

Expected cost (measured order of magnitude): ~50–150 ms for a warm 10k-file
tree, ~0.5–2 s cold; this is a one-time cost per TTL window, not per keystroke.

### 5.4 Cache: LRU + TTL + hard caps

`FileSearchIndexManager` is a process-wide singleton with its own lock:

| Knob | Default | Purpose |
|------|---------|---------|
| `MAX_CACHED_PIPELINES` | 8 | bound total number of indexes |
| `MAX_INDEX_ENTRIES` | 100 000 | bound entries per repo |
| `MAX_INDEX_BYTES` | 32 MiB | bound text stored per index |
| `SOFT_TTL_SECONDS` | 20 s | after this, serve stale + schedule rebuild |
| `IDLE_TTL_SECONDS` | 600 s | drop the index entirely (free memory) |
| `MAX_RESULTS` | 50 | hard server-side result cap |

Eviction is LRU by `last_used`. On `IDLE_TTL` the snapshot is dropped; the next
query rebuilds lazily. This satisfies "load an index/cache in memory to be
quick, but cap and expire it when not used for a while".

**Stale-while-revalidate**: if a snapshot is older than `SOFT_TTL` but not idle,
the query is answered immediately from the stale snapshot and a background
rebuild task is started (deduplicated by key). This keeps as-you-type latency
flat even while the tree is changing.

**Cheap freshness probe**: before using (not rebuilding) a snapshot, `stat` the
resolved root and `<root>/.git/index`. If either mtime moved past `built_at`,
mark it dirty and trigger the background rebuild. This catches commits,
checkouts and pulls immediately; arbitrary nested file writes are covered by
the soft TTL. It is a stat, not a walk, so it is effectively free.

### 5.5 Matching and ranking

The query is normalized once (`strip()`, `casefold()`). If empty, return an
empty result (the route requires `min_length=1`). Matching runs in a worker
thread as part of the search call (the same `asyncio.to_thread`) whenever a
snapshot may need building; pure matching over a warm snapshot is fast enough
to run inline, but keeping it off-loop is cheap insurance for very large repos.

The scorer fills a bounded min-heap of size `limit` so we never sort the whole
match set:

1. **Name match (mandatory)** — `needle in rec.name.casefold()`. Primary bucket.
2. **Path match** — `needle in rec.path.casefold()` and not already in bucket 1.
3. **Subsequence (fuzzy, optional)** — only if bucket 1+2 are under the limit and
   `len(needle) >= 2`; every needle char appears in order in the casefolded
   path. Gives typo/abbreviation tolerance (`fbrv` → `FileBrowseView.ts`).

Ordering key: `(bucket, len(rec.name), len(rec.path), rec.path)` — short exact
name hits first, then deterministic path order. Because we use a bounded heap
the rank is stable and independent of filesystem iteration order. `truncated`
is set when the heap dropped candidates or the index hit an entry/byte cap.

Returned item:

```python
class FileSearchResult(BaseModel):
    path: str
    name: str
    is_dir: bool

class FileSearchResponse(BaseModel):
    query: str
    results: List[FileSearchResult]
    truncated: bool
    index_ready: bool   # False while a first build is in flight (rare)
```

### 5.6 HTTP API

Added to the existing `file_browser` router (`prefix="/pipelines/{pipeline_id}/files"`):

```
GET /api/pipelines/{pipeline_id}/files/search?q=<text>&limit=20
```

* `q: str = Query(..., min_length=1, max_length=200)`
* `limit: int = Query(20, ge=1, le=50)`
* Requires `current_user: User = Depends(get_current_user)` like the siblings.
* Resolves the pipeline via `pipeline_queries.get_pipeline_by_id`, delegates to
  `FileSearchService.search(pipeline, q, limit)`, maps errors through the
  existing `_handle()` helper.

Response is small (≤ 50 short paths), so a normal request/response is the right
fit. The client debounces and cancels with `AbortController`; the server does no
per-connection state.

### 5.7 Security and path handling

* Reuse `FileBrowserService._resolve_root()` (promote it to a public
  `resolve_root()`) so root resolution, missing-workspace errors and
  `PathEscapeError` behaviour match the rest of the file browser exactly.
* The index stores only repo-relative POSIX paths; absolute paths never leave
  `core`.
* The manager keys indexes by resolved root, but a request is only ever served
  after the normal per-pipeline authorization/lookup, so a shared root cannot be
  used to read another pipeline's files through this endpoint.
* Read-only: `os.walk` + `stat`; no writes, no subprocesses, no git mutation.

### 5.8 Concurrency and failure modes

* All index state is guarded by the manager lock; snapshots are immutable, so
  readers never see a partially built index.
* A rebuild failure never drops a good stale snapshot (except on idle expiry);
  it is logged and the old snapshot keeps serving.
* A repo that blows the caps is served as a truncated index rather than
  erroring; `truncated=True` lets the UI show "refine your search".
* If the workspace is missing, the existing `EntityNotFoundError` → HTTP 404
  path is used.
* Index memory is a pure cache: restarting the process loses nothing.

### 5.9 Why no precomputed casefold table in v1

The corpus this app targets is hundreds to low tens of thousands of files (the
current repo has ~500). A linear scan over 50k `str` with `in` runs in single-
digit milliseconds in CPython because the inner comparison is C. Precomputing
`casefold()` variants would roughly double residency for a speedup we do not
need at the target scale. It is a drop-in addition behind the `PathIndex`
snapshot if a deployment ever needs it.

### 5.10 Frontend: `FileSearchInputView`

This is specified here only to lock the contract; the component is standalone.

```ts
export interface FileSearchInputViewOptions {
  /** Performs the search; must honour the abort signal. */
  search: (query: string, signal: AbortSignal) => Promise<FileSearchResponse>;
  /** Result activation. */
  onSelect: (result: FileSearchResult) => void;
  /** Default false. */
  showButton?: boolean;
  /** Optional placeholder / initial value. */
  placeholder?: string;
  initialValue?: string;
}
```

* Renders an `<input>` (`h-7 text-xs`) plus, when `showButton` is true, a small
  icon button. Fixed height so the header height is stable.
* Debounced input (150 ms) triggers a search; Enter triggers immediately;
  the previous in-flight request is aborted with `AbortController`.
* Results render in a lightweight popover/overlay anchored to the input, with
  ArrowUp/ArrowDown/Enter/Escape keyboard handling and `aria-*` roles.
* `onSelect` is wired by `FileBrowseView` to `navigateTo(result.path)` (handles
  both files and directories) or directly to `openFile` for files.
* Placement: inserted in `FileBrowseView.shell()` immediately before
  `#file-browser-refresh-btn`, with a vertical delimiter
  (`w-px h-4 bg-app-border`) so it reads as a separate control group.
* `FileBrowserClient` gains `searchFiles(pipelineId, query, signal)` which calls
  the endpoint through `BaseClient.fetch` (inherits auth/refresh/error mapping;
  the signal is forwarded in `RequestInit`).

### 5.11 Testing

* **Service**: build index over a temp repo; assert ignored directories are
  skipped, caps truncate, ranking orders name before path, subsequence works,
  TTL/LRU eviction releases memory, stale-while-revalidate returns immediately.
* **Route**: extend `backend/tests/routes/test_file_browser_routes.py` — auth
  enforced, `q` validation, 404 for a missing pipeline/workspace, empty results
  for no match, result shape.
* **Client**: `FileBrowserClient.test.ts` asserts the URL/params and that the
  abort signal is forwarded.
* **Component**: `FileSearchInputView.test.ts` asserts debounce, abort of the
  previous request, keyboard selection, optional button on/off and that the
  markup adds no extra header height.

## 6. Alternatives considered

Each alternative below was evaluated and rejected for the reasons given.

### A. Walk the filesystem on every keystroke (`os.walk` / `find`)
**Rejected.** Simple but far too expensive: a full walk of a warm 10k–50k file
tree is 50–500 ms and hits the disk on every keystroke. It cannot meet R2 and
would make as-you-type unusable on cold caches. It also multiplies CPU/disk
load across concurrent users.

### B. `git ls-files` on every request
**Rejected as the primary mechanism.** It is fast (a single git command, tens of
ms) and excludes `.gitignore`d files, but it still spawns a process and reads the
index on every keystroke, and its notion of "what exists" differs from the File
Browser (which lists untracked and ignored-but-not-excluded files). It is a good
*seed* for an in-memory index, not a per-keystroke engine.

### C. `rg --files` / `fd` / `plocate` on every request
**Rejected.** These are excellent at listing files, but none is currently in the
image (`rg`/`fd` are absent; `grep`/`find`/`tree` are present), so they add a
binary dependency and packaging/version concerns. They also spawn a process per
query, return an unordered flat list with no ranking, and `plocate` needs a
system-wide updatedb that does not fit per-pipeline workspaces.

### D. Persistent on-disk index (SQLite FTS5 or a custom binary file)
**Rejected for now.** Persistence buys cold-start speed and lower RAM, but the
corpus is small, the workspace root is per-pipeline and can be recreated,
and we would have to design invalidation, schema migration, corruption
recovery, disk quotas and cleanup of orphaned index files. The added operational
surface (R7/R6) outweighs the benefit at this scale. This is the natural upgrade
path if very large monorepos ever become a target.

### E. Trigram / trie / DAWG inverted index in memory
**Rejected.** Sub-millisecond substring search with small memory is attractive,
but building and maintaining an inverted index for arbitrary substrings (or a
trie for prefix-only search) is materially more code than a linear scan, and the
linear scan already meets the latency target at the expected corpus size. Fuzzy
subsequence matching is also awkward on a plain trigram index. Revisit only if
profiling proves the linear scan insufficient.

### F. WebSocket search channel
**Rejected.** A WebSocket could shave per-message framing overhead and stream
results, but each query is a tiny one-shot request/response with no server push,
ordering requirement or subscription. Using WS would mean a new message type,
its own auth/routing in `websocket_manager`, request correlation ids, and custom
cancellation — all to replace a debounced GET with an `AbortController` that the
existing `BaseClient` already supports. HTTP is strictly simpler and equal in
latency here. (WS remains the right choice for genuinely push-based features,
which this is not.)

### G. Build the index in the browser
**Rejected.** Downloading the path set to the client would leak the repository
structure, duplicate the data in browser memory, and still need a server round
trip to build/refresh it. It also cannot be reused by agent tools and breaks
down as repositories grow.

### H. Content grep (search inside files) as part of v1
**Rejected / deferred.** The task explicitly makes filename search the mandatory
part and content search only "and pathnames?". Content grep has a completely
different cost profile (reads file bodies, needs binary/binary-skip handling
and match context) and would dominate the design. The recommended path index and
HTTP endpoint leave room to add a separate, opt-in content-search endpoint
later without changing this contract.

## 7. Rollout and future work

1. Add `core/services/file_search.py` (index + manager + scorer) with unit
   tests; expose `resolve_root()` from `FileBrowserService`.
2. Add `GET …/files/search` to `routes/file_browser.py` and the response models.
3. Add `FileBrowserClient.searchFiles` and the `FileSearchInputView` component;
   wire it into `FileBrowseView`/`PipelineDetailView` in the header.
4. Later, optional: warm the index when the File Browser tab is first mounted;
   reuse the index from the assistant `find` tool; add an opt-in content-search
   endpoint; add a precomputed casefold table if profiling demands it.
