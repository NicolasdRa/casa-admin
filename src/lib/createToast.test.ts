import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "solid-js";
import { createToast } from "./createToast.ts";

test("createToast: show appends unique toasts, dismiss removes by id", () => {
  createRoot((dispose) => {
    const { toasts, show, dismiss } = createToast();
    assert.equal(toasts().length, 0);

    const a = show("Saved", "success");
    const b = show("Failed", "error");
    show("Note"); // kind defaults to "info"
    assert.equal(toasts().length, 3);
    assert.notEqual(a, b); // each toast gets a distinct id
    assert.equal(toasts()[0].message, "Saved");
    assert.equal(toasts()[1].kind, "error");
    assert.equal(toasts()[2].kind, "info");

    dismiss(a);
    assert.deepEqual(
      toasts().map((t) => t.message),
      ["Failed", "Note"],
    );
    dispose();
  });
});
