import { createEffect, type JSX } from "solid-js";
import { useI18n } from "~/lib/i18n";

/**
 * Reusable centered modal built on the native <dialog> element, so focus trapping, Esc-to-close,
 * inert background and the ::backdrop come for free (same approach as the mobile app-sheet).
 * Controlled: parent owns `open`; `onClose` fires on Esc, backdrop click, and the × button, so the
 * parent's signal stays in sync however the dialog is dismissed.
 */
export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: JSX.Element;
}) {
  let dialog: HTMLDialogElement | undefined;
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  const { t } = useI18n();

  // Drive the native dialog from the controlled `open` prop. showModal() throws if already open,
  // so guard on the element's own state. Effects run client-side only — safe for SSR.
  createEffect(() => {
    const d = dialog;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    else if (!props.open && d.open) d.close();
  });

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is mouse-only by nature; keyboard dismissal is the native <dialog> Esc handler.
    <dialog
      ref={dialog}
      class="modal"
      aria-labelledby={titleId}
      onClose={() => props.onClose()}
      onClick={(e) => {
        // A click whose target is the dialog itself is the backdrop (children live in .modal-panel).
        if (e.target === dialog) props.onClose();
      }}
    >
      <div class="modal-panel">
        <header class="modal-head">
          <h2 id={titleId}>{props.title}</h2>
          <button
            type="button"
            class="btn-ghost modal-close"
            aria-label={t("common.close")}
            onClick={() => props.onClose()}
          >
            ✕
          </button>
        </header>
        <div class="modal-body">{props.children}</div>
      </div>
    </dialog>
  );
}
