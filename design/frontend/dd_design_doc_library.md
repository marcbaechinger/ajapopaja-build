# Design Doc Library Dialog Design

## Overview

The **DesignDocLibraryDialog** is a wide modal that lets a user browse, search,
and read the Markdown design documents of a pipeline. It is opened from the
pipeline header (the documentation icon) or with the `d` keyboard shortcut and
builds on the generic `BaseDialog` component.

## Backend

Two read-only endpoints are exposed by a dedicated router
(`api/routes/design_docs.py`), nested under the pipeline resource:

| Method | URI | Description |
| :--- | :--- | :--- |
| `GET` | `/pipelines/{pipeline_id}/design-docs` | List Markdown docs under the pipeline's `doc_root`. Optional `q` searches paths and content. |
| `GET` | `/pipelines/{pipeline_id}/design-docs/content` | Return the raw Markdown for a `path` relative to `doc_root`. |

The filesystem work lives in `core/utils/design_docs.py` and never touches the
database, so it can be unit-tested against a temporary directory. Every access
is constrained to the pipeline's `doc_root` via `safe_join`, which rejects
absolute paths and `..` traversal. Only files ending in `.md` are listed or
read. List/search results carry the relative path, a title derived from the
first level-1 heading (falling back to the file name), size, modification time,
and — for content matches — a short snippet around the hit.

The response models (`DesignDocInfo`, `DesignDocContent`,
`DesignDocListResponse`) live in `core/models/models.py`.

## Frontend

`DesignDocClient` wraps the two endpoints. `DesignDocLibraryDialog` organises
the UI as:

* a **collapsible search panel** at the top with a debounced search input and a
  scrollable result list;
* a **tab strip** and a **reading area** below it.

Selecting a result opens it in a new tab. Document content is fetched lazily on
first open and cached in memory for the lifetime of the dialog, so switching
between tabs is instant. Tabs can be closed individually; closing the active tab
activates its neighbour. Markdown is rendered with the shared `renderMarkdown`
helper (marked + DOMPurify) inside a `prose-theme` article, matching the
approach used by `TaskItem`.

### User Experience

* The dialog uses up to 95% of the viewport width so long design documents are
  comfortable to read.
* The search input is focused automatically on open.
* Search is debounced and also triggers on `Enter`.
* Empty, loading and error states are shown explicitly for both the list and the
  document content.
* The active document can be copied to the clipboard in one click.
