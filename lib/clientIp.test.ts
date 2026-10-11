import test from "node:test";
import assert from "node:assert/strict";
import { clientIp } from "./clientIp";

const h = (m: Record<string, string>) => ({ get: (n: string) => m[n.toLowerCase()] ?? null });

test("uses the first x-forwarded-for hop", () => {
  assert.equal(clientIp(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
});
test("falls back to x-real-ip then unknown", () => {
  assert.equal(clientIp(h({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIp(h({})), "unknown");
});
