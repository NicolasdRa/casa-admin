import { createSignal } from "solid-js";

export interface ConfirmOptions {
  message: string;
  /** Dialog heading; falls back to a generic "Confirm" title when omitted. */
  title?: string;
  /** Render the confirm button as destructive (delete / irreversible financial action). */
  danger?: boolean;
}
interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * Promise-based replacement for the native confirm(): `confirm(opts)` opens the dialog and resolves
 * true/false once the user answers. Split from <ConfirmProvider> (which owns the <Modal> markup) so
 * the resolver logic is testable under createRoot with no DOM — same split as createEntityForm.
 */
export function createConfirm() {
  const [pending, setPending] = createSignal<PendingConfirm | null>(null);

  const settle = (answer: boolean) => {
    const cur = pending();
    if (!cur) return;
    setPending(null);
    cur.resolve(answer);
  };

  const confirm = (opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      // A new ask supersedes any still-open one — resolve it false so its caller never hangs.
      pending()?.resolve(false);
      setPending({ ...opts, resolve });
    });

  return {
    pending,
    confirm,
    accept: () => settle(true),
    cancel: () => settle(false),
  };
}
