const test = require("node:test");
const assert = require("node:assert/strict");
const { clientFingerprint, recordLegacyLicenseTraffic } = require("./legacyTraffic");

const SECRET = "test-secret";
const KEY = "ABCD-1234-EFGH-5678";

function fakeQuery() {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return { rows: [] };
  };
  return { query, calls };
}

test("records one upsert with an HMAC fingerprint and never the raw key", async () => {
  const { query, calls } = fakeQuery();
  const ok = await recordLegacyLicenseTraffic(query, {
    endpoint: "validate",
    licenseKey: KEY,
    instanceID: "inst-1",
    appVersion: "1.1.0",
    secret: SECRET,
  });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  const [endpoint, fingerprint, version] = calls[0].params;
  assert.equal(endpoint, "validate");
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(version, "1.1.0");
  assert.ok(!JSON.stringify(calls).includes(KEY), "raw license key must not be sent to the database");
});

test("same key and instance give the same fingerprint; a different instance differs", () => {
  const a = clientFingerprint(KEY, "inst-1", SECRET);
  assert.equal(a, clientFingerprint(`  ${KEY}\n`, "inst-1", SECRET));
  assert.notEqual(a, clientFingerprint(KEY, "inst-2", SECRET));
  assert.notEqual(a, clientFingerprint(KEY, "inst-1", "other-secret"));
  assert.notEqual(a, clientFingerprint(KEY, undefined, SECRET));
});

test("fail-open: a throwing query returns false and does not throw", async () => {
  const query = async () => {
    throw new Error("db down");
  };
  const ok = await recordLegacyLicenseTraffic(query, {
    endpoint: "validate",
    licenseKey: KEY,
    secret: SECRET,
  });
  assert.equal(ok, false);
});

test("skips recording when the secret or license key is missing", async () => {
  const { query, calls } = fakeQuery();
  assert.equal(await recordLegacyLicenseTraffic(query, { endpoint: "validate", licenseKey: KEY, secret: "" }), false);
  assert.equal(await recordLegacyLicenseTraffic(query, { endpoint: "validate", licenseKey: "", secret: SECRET }), false);
  assert.equal(calls.length, 0);
});

test("app version is truncated to 64 characters; non-strings become null", async () => {
  const { query, calls } = fakeQuery();
  await recordLegacyLicenseTraffic(query, { endpoint: "validate", licenseKey: KEY, appVersion: "9".repeat(500), secret: SECRET });
  await recordLegacyLicenseTraffic(query, { endpoint: "validate", licenseKey: KEY, appVersion: { evil: true }, secret: SECRET });
  assert.equal(calls[0].params[2].length, 64);
  assert.equal(calls[1].params[2], null);
});
