import assert from "node:assert/strict";
import { test } from "node:test";
import { base32Decode, base32Encode, hotp, randomBase32Secret, verifyTotp } from "./totp.ts";

// RFC 4226 Appendix D test vectors — secret ASCII "12345678901234567890".
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const HOTP = [
  "755224",
  "287082",
  "359152",
  "969429",
  "338314",
  "254676",
  "287922",
  "162583",
  "399871",
  "520489",
];

test("hotp matches RFC 4226 vectors", () => {
  for (let c = 0; c < HOTP.length; c++) assert.equal(hotp(SECRET, c), HOTP[c]);
});

test("base32 round-trips", () => {
  assert.equal(base32Decode(SECRET).toString("ascii"), "12345678901234567890");
  assert.equal(base32Encode(Buffer.from("12345678901234567890")), SECRET);
});

test("verifyTotp accepts the current code and rejects a wrong one", () => {
  // counter = floor(59/30) = 1 -> code "287082"
  assert.equal(verifyTotp(SECRET, "287082", 59_000, 0), true);
  assert.equal(verifyTotp(SECRET, "000000", 59_000, 0), false);
});

test("verifyTotp tolerates one step of skew", () => {
  // at 89s counter=2 ("359152"); window 1 still accepts counter-1 code "287082"
  assert.equal(verifyTotp(SECRET, "287082", 89_000, 1), true);
});

test("randomBase32Secret is decodable and ~32 chars for 20 bytes", () => {
  const s = randomBase32Secret();
  assert.equal(base32Decode(s).length, 20);
});
