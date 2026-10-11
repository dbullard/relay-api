import test from "node:test";
import assert from "node:assert/strict";
import { deleteAccountData } from "./deleteAccount";

test("deletes child tables before users, binding the right ids", async () => {
  const calls: { text: string; params: unknown[] }[] = [];
  const client = {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text: text.replace(/\s+/g, " ").trim(), params });
      if (/select email from users/.test(text)) return { rows: [{ email: "a@b.c" }] };
      return { rows: [] };
    },
  };
  await deleteAccountData(client, "user-1");

  const tables = calls
    .map((c) => /delete from (\w+)/.exec(c.text)?.[1])
    .filter((t): t is string => Boolean(t));
  assert.deepEqual(tables, [
    "relay_user_presence", "sessions", "license_activations", "licenses",
    "subscriptions", "magic_links", "users",
  ]);
  const magic = calls.find((c) => c.text.includes("delete from magic_links"))!;
  assert.deepEqual(magic.params, ["a@b.c"]);
  const users = calls.find((c) => c.text.includes("delete from users"))!;
  assert.deepEqual(users.params, ["user-1"]);
});

test("unknown user is a no-op", async () => {
  const calls: string[] = [];
  const client = { query: async (t: string) => { calls.push(t); return { rows: [] }; } };
  await deleteAccountData(client, "missing");
  assert.equal(calls.filter((c) => c.includes("delete from")).length, 0);
});
