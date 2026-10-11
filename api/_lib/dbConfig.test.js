const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPoolConfig } = require("./dbConfig");

test("strips sslmode and verifies with provided CA", () => {
  const c = buildPoolConfig({ DATABASE_URL: "postgres://u:p@h:5432/db?sslmode=no-verify&x=1", SUPABASE_DB_CA_CERT: "PEM" });
  assert.equal(new URL(c.connectionString).searchParams.has("sslmode"), false);
  assert.equal(new URL(c.connectionString).searchParams.get("x"), "1");
  assert.deepEqual(c.ssl, { rejectUnauthorized: true, ca: "PEM" });
});

test("default verifies against system roots", () => {
  const c = buildPoolConfig({ DATABASE_URL: "postgres://u:p@h:5432/db" });
  assert.deepEqual(c.ssl, { rejectUnauthorized: true });
});

test("escape hatch disables verification only when explicitly set", () => {
  const original = console.warn; console.warn = () => {};
  try {
    const c = buildPoolConfig({ DATABASE_URL: "postgres://u:p@h:5432/db", RELAY_DB_ALLOW_UNVERIFIED_TLS: "true" });
    assert.deepEqual(c.ssl, { rejectUnauthorized: false });
  } finally { console.warn = original; }
});

test("falls back to POSTGRES_URL and handles unparsable URLs", () => {
  assert.equal(buildPoolConfig({ POSTGRES_URL: "postgres://u:p@h/db" }).connectionString?.startsWith("postgres://"), true);
  assert.equal(buildPoolConfig({ DATABASE_URL: "not a url" }).connectionString, "not a url");
});

test("PEM with escaped newlines is normalized", () => {
  const c = buildPoolConfig({ DATABASE_URL: "postgres://u:p@h/db", SUPABASE_DB_CA_CERT: "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----" });
  assert.equal(c.ssl.ca.includes("\n"), true);
});
