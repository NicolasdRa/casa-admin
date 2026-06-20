/**
 * Minimal quote-aware RFC-4180 CSV reader → rows of string cells. Companion to `toCsv` in csv.ts.
 * Handles quoted fields with embedded commas, newlines, and doubled "" escapes — needed because the
 * imported sheets carry European decimals ("€1.636,47") and free-text inside quotes. Empty cells are
 * preserved (the sheets are sparse, column position is meaningful). No streaming — fine at ~500 rows.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++; // skip the escaped quote
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++; // CRLF as one break
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  // Flush the last cell/row unless the input ended exactly on a line break (no trailing blank row).
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
