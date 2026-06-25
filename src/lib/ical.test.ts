import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIcs } from "./ical.ts";

const AIRBNB = `BEGIN:VCALENDAR
PRODID:-//Airbnb Inc//Hosting Calendar 0.8.8//EN
CALSCALE:GREGORIAN
VERSION:2.0
BEGIN:VEVENT
DTEND;VALUE=DATE:20260705
DTSTART;VALUE=DATE:20260701
UID:abc123@airbnb.com
SUMMARY:Reserved
END:VEVENT
BEGIN:VEVENT
DTEND;VALUE=DATE:20260710
DTSTART;VALUE=DATE:20260708
UID:def456@airbnb.com
SUMMARY:Airbnb (Not available)
END:VEVENT
END:VCALENDAR`;

test("parseIcs extracts VEVENTs with ISO dates", () => {
  const events = parseIcs(AIRBNB);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    uid: "abc123@airbnb.com",
    start: "2026-07-01",
    end: "2026-07-05",
    summary: "Reserved",
  });
  assert.equal(events[1].uid, "def456@airbnb.com");
  assert.equal(events[1].end, "2026-07-10");
});

test("parseIcs unfolds RFC 5545 continuation lines", () => {
  // RFC 5545 folding is byte-exact: a CRLF+space is inserted to wrap, removed on unfold — it can
  // split mid-word, so reconstruction is plain concatenation ("CONF" + "IRMED" = "CONFIRMED").
  const folded = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260101
DTEND;VALUE=DATE:20260103
UID:long@airbnb.com
SUMMARY:Reservation CONF
 IRMED by host
END:VEVENT
END:VCALENDAR`;
  const [e] = parseIcs(folded);
  assert.equal(e.summary, "Reservation CONFIRMED by host");
});

test("parseIcs skips VEVENTs missing UID or dates", () => {
  const partial = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260101
SUMMARY:no end, no uid
END:VEVENT
END:VCALENDAR`;
  assert.deepEqual(parseIcs(partial), []);
});

test("parseIcs returns [] for empty / non-calendar input", () => {
  assert.deepEqual(parseIcs(""), []);
  assert.deepEqual(parseIcs("garbage"), []);
});
