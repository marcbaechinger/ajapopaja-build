# Design Document: Markdown Support for Design Documents (`dd_markdown_design_doc.md`)

## 1. Overview
The current implementation of the `design_doc` field in the Task model only supports plain text. To improve the expressiveness and readability of technical plans, this document proposes adding full Markdown support for both rendering (display mode) and editing (edit mode).

## 2. Goals
1.  **Rich Display**: Render the `design_doc` as formatted HTML in the task sequence view.
2.  **Convenient Editing**: Replace the plain textarea with a Markdown-aware editor featuring syntax highlighting, toolbar, and preview.
3.  **Low Overhead**: Utilize proven, lightweight libraries that integrate well with the existing Vanilla TypeScript architecture.

## 3. Proposed Libraries

### Rendering: `marked`
- **Why**: `marked` is a high-performance, compliant Markdown parser that is widely used and easy to integrate into Vanilla JS environments.
- **Usage**: Converts Markdown strings to HTML strings for injection into the DOM.

### Editing: `EasyMDE`
- **Why**: `EasyMDE` is a drop-in replacement for standard `<textarea>` elements. It provides:
    - Side-by-side preview.
    - Toolbar for common formatting (Bold, Italic, Lists, Code, etc.).
    - Auto-expanding height.
    - Full-screen mode for focused planning.
- **Alternatives considered**: `SimpleMDE` (unmaintained) and `CodeMirror` (more complex to configure).

### Styling: `Tailwind Typography Plugin (@tailwindcss/typography)`
- **Why**: Standard Tailwind CSS resets global styles. The `prose` class from the typography plugin provides beautiful, pre-configured styles for rendered HTML (headings, lists, blockquotes, code blocks) with zero manual CSS.

## 4. Implementation Strategy

### Step 1: Install Dependencies
Run from the `frontend/` directory:
```bash
npm install marked easymde
npm install -D @tailwindcss/typography
```

### Step 2: Update Tailwind Config
Enable the typography plugin in `frontend/vite.config.ts` (if using the Vite plugin) or `tailwind.config.js` to support the `.prose` class.

### Step 3: Refactor `TaskItem.render`
Update the rendering logic to wrap the output of `marked.parse()` in a `.prose` container.

**Current (Conceptual):**
```html
<div class="design-doc-display text-app-text/70">
  ${task.design_doc || 'Click to add design doc...'}
</div>
```

**Proposed (Conceptual):**
```html
<div class="design-doc-display prose prose-invert prose-sm max-w-none text-app-text/70">
  ${task.design_doc ? marked.parse(task.design_doc) : 'Click to add design doc...'}
</div>
```

### Step 4: Refactor `PipelineDetailView` Actions
Modify the `edit_design_doc` and `save_design_doc` actions to initialize and destroy the `EasyMDE` instance.

1.  **On Edit**: When the "Edit" action is triggered, instantiate `EasyMDE` on the target textarea.
    ```typescript
    const editor = new EasyMDE({ element: textareaEl, spellChecker: false });
    // Store editor instance for later cleanup/save
    ```
2.  **On Save/Cancel**: Retrieve the value via `editor.value()`, then call `editor.toTextArea()` to clean up the UI before switching back to the view state.

## 5. Security Considerations
To prevent Cross-Site Scripting (XSS) when rendering user-provided Markdown:
-   **Sanitization**: Use a library like `dompurify` in conjunction with `marked` to ensure any potentially malicious HTML (e.g., `<script>` tags) injected via Markdown is stripped out before rendering.

```bash
npm install dompurify
npm install -D @types/dompurify
```

## 6. Migration Plan
Since the `design_doc` field is already a string, no backend changes or database migrations are required. Existing plain-text design documents will render as standard text in Markdown (since plain text is valid Markdown).
