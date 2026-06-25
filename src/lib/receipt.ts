// EX-6: everything about turning an uploaded receipt into a stored file lives here — the plan
// (webp vs passthrough), the safe filename extension, and the disk write. The expense route used to
// inline the sharp + fs blob; this concentrates it into one module so the I/O is testable without
// driving the route, and the db layer stays pure SQL (no sharp/fs pulled into in-memory db tests).

/** Lowercased file extension restricted to [a-z0-9] (max 5). "" if none — guards against odd names. */
export function safeExt(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(filename);
  return m ? m[1].toLowerCase() : "";
}

/** Raster images are normalised to webp (downscaled); everything else (PDFs, etc.) stored as-is. */
export function receiptPlan(mimeType: string): "webp" | "passthrough" {
  return mimeType.startsWith("image/") && mimeType !== "image/svg+xml" ? "webp" : "passthrough";
}

/**
 * Persist an uploaded receipt under a server-controlled filename (`receipt-<id>.<ext>`, never a
 * user-controlled path) and return that filename for setExpenseReceipt. Raster images are rotated
 * to EXIF orientation, downscaled to 2000px and re-encoded as webp; PDFs etc. are stored as-is.
 * sharp is optional — if libvips is missing the original bytes are stored (the original ext kept).
 */
export async function persistReceipt(file: File, expenseId: number): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const dir = process.env.UPLOAD_DIR ?? "uploads";
  await mkdir(dir, { recursive: true });
  let data: Buffer = Buffer.from(await file.arrayBuffer());
  let ext = safeExt(file.name) || "bin";
  if (receiptPlan(file.type) === "webp") {
    try {
      const sharp = (await import("sharp")).default;
      data = await sharp(data)
        .rotate()
        .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      ext = "webp";
    } catch (err) {
      console.error("sharp unavailable; storing original receipt:", (err as Error).message);
    }
  }
  const fname = `receipt-${expenseId}.${ext}`;
  await writeFile(`${dir}/${fname}`, data);
  return fname;
}
