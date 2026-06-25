import { createContext, For, type ParentProps, useContext } from "solid-js";
import { createToast, TOAST_TTL_MS, type ToastKind } from "~/lib/createToast";
import { useI18n } from "~/lib/i18n";

type ToastFn = (message: string, kind?: ToastKind) => void;
const ToastContext = createContext<ToastFn>();

/**
 * App-wide transient notifications. `useToast()(msg, kind)` appends a toast; the provider owns the
 * auto-dismiss timer (kept out of the primitive so that stays pure). Stacked in a fixed corner,
 * announced politely to screen readers, and dismissable via a real button. Mirrors ConfirmProvider.
 */
export function ToastProvider(props: ParentProps) {
  const { t } = useI18n();
  const { toasts, show, dismiss } = createToast();
  const toast: ToastFn = (message, kind = "info") => {
    const id = show(message, kind);
    setTimeout(() => dismiss(id), TOAST_TTL_MS);
  };
  return (
    <ToastContext.Provider value={toast}>
      {props.children}
      <div class="toast-stack" aria-live="polite">
        <For each={toasts()}>
          {(item) => (
            <output class={`toast toast-${item.kind}`}>
              <span class="toast-msg">{item.message}</span>
              <button
                type="button"
                class="toast-x"
                aria-label={t("common.close")}
                onClick={() => dismiss(item.id)}
              >
                ×
              </button>
            </output>
          )}
        </For>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
