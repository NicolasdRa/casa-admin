import { createContext, type ParentProps, useContext } from "solid-js";
import { type ConfirmOptions, createConfirm } from "~/lib/createConfirm";
import { useI18n } from "~/lib/i18n";
import { Modal } from "./Modal";

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>();

/**
 * App-wide confirmation dialog: one <Modal> driven by createConfirm(), with confirm() exposed via
 * context so any route can `await useConfirm()(...)` in place of the native confirm(). Esc / backdrop
 * / Cancel all resolve false (handled by Modal's onClose → cancel).
 */
export function ConfirmProvider(props: ParentProps) {
  const { t } = useI18n();
  const { pending, confirm, accept, cancel } = createConfirm();
  return (
    <ConfirmContext.Provider value={confirm}>
      {props.children}
      <Modal
        open={pending() !== null}
        onClose={cancel}
        title={pending()?.title ?? t("common.confirmTitle")}
      >
        <p class="confirm-message">{pending()?.message}</p>
        <div class="confirm-actions">
          <button type="button" class="btn-ghost" onClick={cancel}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            classList={{ btn: true, "btn-danger": pending()?.danger === true }}
            onClick={accept}
          >
            {t("common.confirm")}
          </button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
