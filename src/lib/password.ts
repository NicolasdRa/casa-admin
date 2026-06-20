import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt with a per-password random salt. Stored as "salt:hash" (hex).
// ponytail: scryptSync is synchronous (blocks briefly) — fine for a ~3-user internal tool;
// switch to the async scrypt if login throughput ever matters.
const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(plain, Buffer.from(saltHex, "hex"), KEYLEN);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
