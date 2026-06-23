import { createEffect, createSignal } from "solid-js";

// The shape we read off a router `useSubmission(action)` — kept loose so any action's submission
// fits structurally. `result` is the action's return (`{ ok: true } | { error: string }`).
interface FormSubmission {
  result?: { ok?: boolean; error?: string };
  clear?: () => void;
}

/**
 * The modal "add" form lifecycle that every CRUD route hand-rolled: an open signal, a form-element
 * ref, reset-on-success, and clear-before-open (so a reopened modal never shows last time's banner).
 * The route still owns its `useSubmission` handle (it reads `pending`/`result` in JSX) and passes it
 * in — which also keeps this primitive free of router context, so it's testable under createRoot.
 *
 * `onSuccess` runs after a successful submit for routes that also reset extra signals (expenses,
 * bookings reset their date/amount/currency inputs there).
 */
export function createEntityForm(submission: FormSubmission, onSuccess?: () => void) {
  const [open, setOpen] = createSignal(false);
  let formEl: HTMLFormElement | undefined;
  createEffect(() => {
    if (submission.result?.ok) {
      formEl?.reset();
      onSuccess?.();
    }
  });
  return {
    open,
    setOpen,
    /** Open the modal fresh — wipe any stale saved/error banner from the previous submit first. */
    openForm: () => {
      submission.clear?.();
      setOpen(true);
    },
    /** `ref` for the <form> element so reset-on-success can clear its native fields. */
    setRef: (el: HTMLFormElement) => {
      formEl = el;
    },
  };
}
