import { createSignal } from "solid-js";

export type ToastKind = "success" | "error" | "info";
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

/** How long a toast lingers before the provider auto-dismisses it. */
export const TOAST_TTL_MS = 4000;

/**
 * Toast queue, split from <ToastProvider> (which owns the markup + auto-expire timer) so the
 * push/dismiss logic is testable under createRoot with no DOM — same split as createConfirm.
 * `show()` appends a toast and returns its id; `dismiss(id)` removes it.
 */
export function createToast() {
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  let seq = 0;

  const show = (message: string, kind: ToastKind = "info") => {
    const id = ++seq;
    setToasts((list) => [...list, { id, message, kind }]);
    return id;
  };
  const dismiss = (id: number) => setToasts((list) => list.filter((t) => t.id !== id));

  return { toasts, show, dismiss };
}
