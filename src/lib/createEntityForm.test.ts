import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "solid-js";
import { createEntityForm } from "./createEntityForm.ts";

test("openForm clears the prior submission, then opens — no stale banner", () => {
  createRoot((dispose) => {
    const seen: string[] = [];
    const form = createEntityForm({
      get result() {
        return undefined;
      },
      clear: () => seen.push("clear"),
    });
    assert.equal(form.open(), false);
    form.openForm();
    // clear must happen (so the modal opens fresh), and the form must be open
    assert.deepEqual(seen, ["clear"]);
    assert.equal(form.open(), true);
    dispose();
  });
});

test("openForm tolerates a submission with no clear() (first ever open)", () => {
  createRoot((dispose) => {
    const form = createEntityForm({
      get result() {
        return undefined;
      },
    });
    form.openForm();
    assert.equal(form.open(), true);
    dispose();
  });
});
