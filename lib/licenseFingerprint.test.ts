import test from "node:test";
import assert from "node:assert/strict";
import { licenseFingerprint } from "./licenseFingerprint";

test("stable, secret-dependent, whitespace-insensitive", () => {
  const a = licenseFingerprint("KEY-123", "s1");
  assert.equal(a, licenseFingerprint("  KEY-123\n", "s1"));
  assert.notEqual(a, licenseFingerprint("KEY-123", "s2"));
  assert.notEqual(a, licenseFingerprint("KEY-124", "s1"));
  assert.match(a, /^[0-9a-f]{64}$/);
});
