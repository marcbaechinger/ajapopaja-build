# Dialog Common Design Document (`dialog_common.ts`)

## 1. Introduction
The current frontend application utilizes several dialogs (e.g., `ConfirmationDialog.ts`, `HistoryDialog.ts`, `StatsDialog.ts`) that duplicate significant amounts of boilerplate code for DOM creation, event handling, and cleanup. 
Extracting this commonality into a central `dialog_common.ts` module will ensure a consistent look and feel, reduce bugs, and increase developer velocity by providing a unified API for dialog management.

## 2. Analysis of Existing Dialogs
A review of the existing dialog implementations reveals the following duplicated logic:

### 2.1 Reusable/Unified Aspects
*   **DOM Initialization & Styling:** All dialogs create a `<dialog>` element, append it to the `document.body`, and apply a similar baseline Tailwind class string for positioning, backdrop blur, rounded corners, borders, and shadows.
*   **Layout:** The internal layout usually consists of a standard header (with a title and a close button) and a scrollable content area, though `ConfirmationDialog` combines them slightly differently.
*   **Backdrop Click Handling:** All dialogs implement an identical `click` event listener to determine if the user clicked outside the dialog's bounding client rectangle (the backdrop) to trigger a close.
*   **Escape Key Handling:** All dialogs listen to the `cancel` event to prevent default behavior and route it through their custom close logic.
*   **Cleanup Logic:** All dialogs utilize a `setTimeout` within a `cleanup()` method to remove the dialog node from the DOM after the close animation completes.
*   **Promise-based Resolution:** `ConfirmationDialog` uses a `Promise<boolean>` to return the result of the interaction. This pattern is highly effective and can be generalized so that any dialog can optionally resolve with a typed value.

### 2.2 Varying Aspects (To be parameterized)
*   **Width and Height Constraints:** e.g., `max-w-md` vs `max-w-2xl` and `max-h-[80vh]` vs `max-h-[90vh]`.
*   **Header Content:** Icon and title text.
*   **Body Content:** HTML string or DOM nodes.
*   **Footer/Action Buttons:** Present in `ConfirmationDialog`, absent in `StatsDialog` and `HistoryDialog`.

## 3. Proposed Solution: `BaseDialog<T>`
We propose creating an abstract `BaseDialog<T>` class (or a factory function) in `frontend/src/ui/components/dialog_common.ts`.

### 3.1 Class Signature
```typescript
export interface DialogOptions {
  maxWidth?: string;
  maxHeight?: string;
  title: string;
  iconSvg?: string;
}

export abstract class BaseDialog<T = void> {
  protected dialog: HTMLDialogElement;
  private resolveRef: ((value: T | null) => void) | null = null;

  constructor(options: DialogOptions) {
    // 1. Create dialog element
    // 2. Apply common classes + options constraints
    // 3. Render common header, abstract body, abstract footer
    // 4. Attach common event listeners (backdrop, escape)
  }

  // Abstract methods for child classes to implement
  protected abstract renderBody(): string | HTMLElement;
  protected renderFooter?(): string | HTMLElement; // Optional

  // Unified show method returning a promise
  public async show(): Promise<T | null> {
    document.body.appendChild(this.dialog);
    this.dialog.showModal();
    return new Promise((resolve) => {
      this.resolveRef = resolve;
    });
  }

  // Unified close method
  protected close(result: T | null = null) {
    this.dialog.close();
    if (this.resolveRef) this.resolveRef(result);
    setTimeout(() => this.dialog.remove(), 300);
  }
}
```

### 3.2 Benefits
*   **Stringency:** The standard backdrop, shadow, positioning, and close behaviors are guaranteed across all dialogs.
*   **Code Reuse:** Eliminates repetitive event listener and DOM cleanup logic.
*   **Predictable Data Flow:** The Promise-based `.show()` method standardizes how data (like form submissions or confirmations) is returned to the caller.

## 4. Further Areas for Common Functionality Unification
*   **View/Component Mounting:** The existing Views (`DashboardView`, `PipelineDetailView`) manually construct HTML strings and attach event listeners in `registerActions`. A lightweight component system (or a `renderComponent` helper) that automatically binds actions could unify UI rendering.
*   **Toast Notifications/Alerts:** A unified `NotificationService` could replace `alert()` calls scattered throughout the views (e.g., `alert('Failed to delete pipeline')`), providing a styled, non-blocking toast message.
*   **HTTP Client Error Handling:** The `TaskClient` and `PipelineClient` both check `!response.ok` and throw standard errors. A generic HTTP wrapper or interceptor could unify error handling, authentication headers, and automatic retries or generic toast triggers.