import test from "node:test";
import assert from "node:assert/strict";
import { authenticateBearer } from "./session";

const goodVerify = (token: string) => {
  if (token !== "good.jwt") throw new Error("bad signature");
  return { userId: "u1", email: "a@b.c" };
};

test("missing header → 401", async () => {
  const r = await authenticateBearer(null, async () => ({ rows: [] }), goodVerify);
  assert.deepEqual(r, { ok: false, status: 401, error: "Missing bearer token" });
});

test("bad signature → 401 (not a throw)", async () => {
  const r = await authenticateBearer("Bearer nope", async () => ({ rows: [] }), goodVerify);
  assert.deepEqual(r, { ok: false, status: 401, error: "Invalid session" });
});

test("valid JWT but no live session row → 401", async () => {
  const r = await authenticateBearer("Bearer good.jwt", async () => ({ rows: [] }), goodVerify);
  assert.deepEqual(r, { ok: false, status: 401, error: "Session not found or expired" });
});

test("valid JWT and live session → ok, queried by user and token hash", async () => {
  let seen: unknown[] = [];
  const r = await authenticateBearer("Bearer good.jwt", async (_t, p) => { seen = p; return { rows: [{ id: "s1" }] }; }, goodVerify);
  assert.deepEqual(r, { ok: true, session: { userId: "u1", email: "a@b.c" } });
  assert.equal(seen[0], "u1");
  assert.match(String(seen[1]), /^[0-9a-f]{64}$/); // sha256 hex, never the raw token
});

test("database error → 503 (never 401, which signs the app out)", async () => {
  const original = console.error; console.error = () => {};
  try {
    const r = await authenticateBearer("Bearer good.jwt", async () => { throw new Error("db"); }, goodVerify);
    assert.deepEqual(r, { ok: false, status: 503, error: "Service temporarily unavailable" });
  } finally { console.error = original; }
});
