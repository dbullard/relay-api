import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "./rateLimit";

function fakeQuery() {
  const counts = new Map<string, number>();
  const calls: unknown[][] = [];
  const query = async (_text: string, params: unknown[]) => {
    calls.push(params);
    const k = `${params[0]}|${params[1]}`;
    const next = (counts.get(k) ?? 0) + 1;
    counts.set(k, next);
    return { rows: [{ count: next }] };
  };
  return { query, calls };
}

test("allows up to the limit then blocks", async () => {
  const { query } = fakeQuery();
  const now = 1_800_000_000_000;
  for (let i = 1; i <= 3; i++) {
    const r = await checkRateLimit(query, "magic:a@b.c", 3, 900, now);
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, 3 - i);
  }
  const blocked = await checkRateLimit(query, "magic:a@b.c", 3, 900, now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 900);
});

test("a new window resets the count", async () => {
  const { query } = fakeQuery();
  const now = 1_800_000_000_000;
  for (let i = 0; i < 4; i++) await checkRateLimit(query, "k", 3, 60, now);
  const later = await checkRateLimit(query, "k", 3, 60, now + 61_000);
  assert.equal(later.allowed, true);
});

test("different keys are independent", async () => {
  const { query } = fakeQuery();
  const now = 1_800_000_000_000;
  for (let i = 0; i < 4; i++) await checkRateLimit(query, "a", 3, 60, now);
  assert.equal((await checkRateLimit(query, "b", 3, 60, now)).allowed, true);
});

test("fails open when the database errors", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const r = await checkRateLimit(async () => { throw new Error("db down"); }, "k", 3, 60);
    assert.equal(r.allowed, true);
  } finally {
    console.error = original;
  }
});
