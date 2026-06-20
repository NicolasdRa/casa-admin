/** RP-5: minimal RFC-4180 CSV (Excel opens it natively). Quotes cells containing "," CR/LF or quotes. */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

function cell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
