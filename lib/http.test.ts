import test from "node:test";
import assert from "node:assert/strict";
import { publicServerError } from "./http";

test("never exposes the underlying message", () => {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => logs.push(a.join(" "));
  try {
    const r = publicServerError("TEST", new Error('password authentication failed for user "postgres"'));
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { ok: false, error: "Something went wrong. Please try again." });
    assert.ok(logs.join("\n").includes("password authentication failed")); // logged server-side
  } finally {
    console.error = original;
  }
});

test("custom public message and non-Error values", () => {
  const original = console.error;
  console.error = () => {};
  try {
    const r = publicServerError("TEST", "boom", "Unable to link license");
    assert.equal(r.body.error, "Unable to link license");
  } finally {
    console.error = original;
  }
});
