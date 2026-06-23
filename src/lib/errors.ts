// A failure that already knows its own i18n code. Thrown by db fns so the code lives *at the throw
// site* instead of in a per-route needle table (CA candidate-2). The message stays human for logs.
export class CodedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CodedError";
    this.code = code;
  }
}

// Map a thrown error to a stable i18n suffix code. Raw exception text never reaches the user:
// the server action returns the code, the page translates `<namespace>.err_<code>` in the active
// locale. A CodedError short-circuits — its code wins, no table needed. Otherwise we fall back to
// substring matching against the message: `includes` (not `startsWith`) so a needle may sit
// mid-message; the table is checked in order, so put the more specific needle first; "generic" last.
// ponytail: the needle path is the brittle seam being retired — migrate throws to CodedError and the
// table shrinks to []. Both styles coexist so migration is incremental and safe.
export function errorCode(e: unknown, table: [string, string][]): string {
  if (e instanceof CodedError) return e.code;
  const m = e instanceof Error ? e.message : String(e);
  return table.find(([needle]) => m.includes(needle))?.[1] ?? "generic";
}
