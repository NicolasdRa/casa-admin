// CA-84: minimal iCal (RFC 5545) reader for OTA calendar feeds. Airbnb & Booking.com publish
// per-listing .ics exports that are nothing but all-day VEVENTs (DTSTART/DTEND with VALUE=DATE,
// a UID, a SUMMARY) — no recurrence, no VTIMEZONE. So this parses exactly that and ignores the rest.
// ponytail: hand-rolled because the feeds are this simple; swap in `node-ical` only if a feed ever
// ships RRULE / VTIMEZONE / datetime VEVENTs (it won't for these two providers).

export interface IcalEvent {
  uid: string;
  start: string; // ISO "YYYY-MM-DD" (check-in / block start)
  end: string; // ISO "YYYY-MM-DD" (check-out — DTEND is exclusive, see lib/overlap.ts)
  summary: string;
}

/** YYYYMMDD -> YYYY-MM-DD; returns null for anything that isn't 8 digits. */
function isoDate(raw: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Unfold RFC 5545 continuation lines (a line beginning with space/tab continues the previous). */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/** Parse VEVENTs into reservation blocks. Events missing a UID or either date are dropped. */
export function parseIcs(text: string): IcalEvent[] {
  const events: IcalEvent[] = [];
  let cur: Partial<IcalEvent> | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur?.uid && cur.start && cur.end) events.push(cur as IcalEvent);
      cur = null;
    } else if (cur) {
      // "NAME;PARAM=x:value" — split name+params from value at the first colon.
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const name = line.slice(0, colon).split(";")[0];
      const value = line.slice(colon + 1);
      if (name === "UID") cur.uid = value.trim();
      else if (name === "SUMMARY") cur.summary = value.trim();
      else if (name === "DTSTART") cur.start = isoDate(value) ?? cur.start;
      else if (name === "DTEND") cur.end = isoDate(value) ?? cur.end;
    }
  }
  return events.map((e) => ({ ...e, summary: e.summary ?? "" }));
}
