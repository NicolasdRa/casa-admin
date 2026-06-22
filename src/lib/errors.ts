// Map a thrown error to a stable i18n suffix code. Raw exception text never reaches the user:
// the server action returns the code, the page translates `<namespace>.err_<code>` in the active
// locale. Uses `includes` (not `startsWith`) so a needle may sit mid-message; the table is checked
// in order, so put the more specific needle first. Falls back to "generic".
// ponytail: substring match against thrown text is the brittle seam — the thrown messages live in
// tested db fns, so this stays in sync as long as those tests pin the text.
export function errorCode(e: unknown, table: [string, string][]): string {
  const m = e instanceof Error ? e.message : String(e);
  return table.find(([needle]) => m.includes(needle))?.[1] ?? "generic";
}
