import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { persistReceipt, receiptPlan, safeExt } from "./receipt.ts";

test("receiptPlan normalises images to webp, passes through the rest (EX-6)", () => {
  assert.equal(receiptPlan("image/jpeg"), "webp");
  assert.equal(receiptPlan("image/png"), "webp");
  assert.equal(receiptPlan("image/heic"), "webp");
  assert.equal(receiptPlan("image/svg+xml"), "passthrough"); // vector, not raster
  assert.equal(receiptPlan("application/pdf"), "passthrough");
  assert.equal(receiptPlan(""), "passthrough");
});

test("safeExt extracts a lowercase extension or empty (EX-6)", () => {
  assert.equal(safeExt("scan.PDF"), "pdf");
  assert.equal(safeExt("a.b.jpeg"), "jpeg");
  assert.equal(safeExt("noext"), "");
  assert.equal(safeExt("../../etc/passwd"), ""); // no extension -> empty, no traversal token kept
});

test("persistReceipt writes a passthrough file under the server-controlled name (EX-6)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "receipt-"));
  process.env.UPLOAD_DIR = dir;
  try {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const file = new File([bytes], "../../scan.PDF", { type: "application/pdf" });
    const fname = await persistReceipt(file, 42);
    assert.equal(fname, "receipt-42.pdf"); // id-derived name, no user-controlled path
    assert.deepEqual(new Uint8Array(await readFile(join(dir, fname))), bytes);
  } finally {
    delete process.env.UPLOAD_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});
