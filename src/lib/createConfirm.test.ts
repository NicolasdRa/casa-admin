import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "solid-js";
import { createConfirm } from "./createConfirm.ts";

test("accept() resolves the pending confirm to true and clears it", async () => {
  await createRoot(async (dispose) => {
    const c = createConfirm();
    const answer = c.confirm({ message: "Delete?" });
    assert.equal(c.pending()?.message, "Delete?");
    c.accept();
    assert.equal(await answer, true);
    assert.equal(c.pending(), null);
    dispose();
  });
});

test("cancel() resolves the pending confirm to false and clears it", async () => {
  await createRoot(async (dispose) => {
    const c = createConfirm();
    const answer = c.confirm({ message: "Delete?" });
    c.cancel();
    assert.equal(await answer, false);
    assert.equal(c.pending(), null);
    dispose();
  });
});

test("accept/cancel with nothing pending is a no-op (no throw)", () => {
  createRoot((dispose) => {
    const c = createConfirm();
    c.accept();
    c.cancel();
    assert.equal(c.pending(), null);
    dispose();
  });
});

test("a second confirm() supersedes the first (resolves it false), then shows the new one", async () => {
  await createRoot(async (dispose) => {
    const c = createConfirm();
    const first = c.confirm({ message: "First?" });
    const second = c.confirm({ message: "Second?", danger: true });
    // the first promise must settle (false), never hang
    assert.equal(await first, false);
    assert.equal(c.pending()?.message, "Second?");
    assert.equal(c.pending()?.danger, true);
    c.accept();
    assert.equal(await second, true);
    dispose();
  });
});
