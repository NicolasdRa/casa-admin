import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// CA-23: RFC 6238 TOTP (SHA-1, 30s step, 6 digits) for optional 2FA. Pure + node:crypto only.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** RFC 4226 HOTP. */
export function hotp(secretBase32: string, counter: number, digits = 6): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, "0");
}

/** RFC 6238 TOTP at a given epoch-millis. */
export function totp(secretBase32: string, atMs: number, step = 30, digits = 6): string {
  return hotp(secretBase32, Math.floor(atMs / 1000 / step), digits);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Verify a token allowing ±`window` steps of clock skew. */
export function verifyTotp(secretBase32: string, token: string, atMs: number, window = 1): boolean {
  const counter = Math.floor(atMs / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    if (safeEqual(hotp(secretBase32, counter + w), token)) return true;
  }
  return false;
}

export function randomBase32Secret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** otpauth:// URI for QR enrolment in an authenticator app. */
export function otpauthUri(secret: string, account: string, issuer = "Casa Bosque"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
