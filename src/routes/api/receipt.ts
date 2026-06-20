import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { APIEvent } from "@solidjs/start/server";
import { getExpenseById } from "~/db/expenses";
import { db } from "~/db/index";
import { currentUser } from "~/lib/session";

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

// Serves an expense's receipt. Auth-gated (middleware redirects unauth too); basename() neutralises
// any path traversal in the stored filename.
export async function GET(event: APIEvent) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const id = Number(new URL(event.request.url).searchParams.get("id"));
  const expense = getExpenseById(db, id);
  if (!expense?.receiptUrl) return new Response("Not found", { status: 404 });
  const name = basename(expense.receiptUrl);
  const dir = process.env.UPLOAD_DIR ?? "uploads";
  try {
    const data = await readFile(`${dir}/${name}`);
    const ext = name.split(".").pop() ?? "";
    return new Response(data, {
      headers: { "content-type": TYPES[ext] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
