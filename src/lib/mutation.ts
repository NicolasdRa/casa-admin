import { errorCode } from "./errors.ts";

type AuditAction = "create" | "update" | "delete";
type Recorder = (action: AuditAction, entity: string) => Promise<void>;
// Exclusive keys (`error?: never` / `ok?: never`) so callers can read result?.ok and result?.error
// without narrowing — a plain `{ ok: true } | { error: string }` union forbids reading either.
type Outcome = { ok: true; error?: never } | { ok?: never; error: string };

// Default recorder is loaded lazily: session.ts reaches into the db + vinxi request context, which
// the node:test runner can't resolve. Tests inject a fake `record`, so this branch is app-only.
const defaultRecord: Recorder = async (action, entity) => {
  const { recordAudit } = await import("./session.ts");
  await recordAudit(action, entity);
};

/**
 * The shared envelope for every mutating server action: run the work, record the audit entry **only
 * if it succeeded**, and map any thrown message to a stable i18n code. Auth/permission gating stays
 * at the call site (the guards vary per route); this owns the part that was copy-pasted ~20×.
 *
 * `record` is injectable the same way db fns take `db` first — tests pass a fake recorder, so the
 * audit-fires-only-on-success contract is pinned without a session or db (mutation.test.ts).
 */
export async function runMutation(
  config: { audit: readonly [AuditAction, string]; errors?: readonly [string, string][] },
  work: () => unknown | Promise<unknown>,
  record: Recorder = defaultRecord,
): Promise<Outcome> {
  try {
    await work();
    await record(config.audit[0], config.audit[1]);
    return { ok: true };
  } catch (e) {
    // A fully CodedError-migrated route omits `errors` entirely — the code rides on the throw.
    return { error: errorCode(e, (config.errors ?? []) as [string, string][]) };
  }
}
