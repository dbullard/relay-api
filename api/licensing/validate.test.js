// eslint-disable-next-line @typescript-eslint/no-require-imports -- Legacy Vercel functions use CommonJS.
const test = require("node:test");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Legacy Vercel functions use CommonJS.
const assert = require("node:assert/strict");

// Replace the shared pool BEFORE the handler is required.
const trafficCalls = [];
let failTraffic = false;
let pendingTraffic = null;
const poolPath = require.resolve("../_lib/pool");
require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: {
    query: async (text, params) => {
      if (String(text).includes("legacy_license_traffic")) {
        trafficCalls.push(params);
        if (pendingTraffic) return pendingTraffic;
        if (failTraffic) throw new Error("db down");
        return { rows: [] };
      }
      return { rows: [{ count: 1 }] }; // rate limiter
    },
  },
};

process.env.RELAY_LICENSE_ENCRYPTION_SECRET = "test-secret";
global.fetch = async () => ({
  ok: true,
  status: 200,
  text: async () =>
    JSON.stringify({ valid: true, license_key: { status: "active" }, instance: { id: "inst-1", name: "Mac" } }),
});

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Legacy Vercel functions use CommonJS.
const handler = require("./validate");

function makeRes() {
  return {
    code: 200,
    body: null,
    setHeader() {},
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
  };
}

const req = () => ({
  method: "POST",
  headers: {},
  body: { licenseKey: "ABCD-1234-EFGH-5678", instanceID: "inst-1", appVersion: "1.1.0" },
});

test("validate records one legacy traffic row and still succeeds", async () => {
  trafficCalls.length = 0;
  failTraffic = false;
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.equal(trafficCalls.length, 1);
  assert.equal(trafficCalls[0][0], "validate");
});

test("validate response is identical when the counter database fails", async () => {
  trafficCalls.length = 0;
  failTraffic = true;
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.entitlement.isActive, true);
});

for (const endpoint of ["validate", "activate"]) {
  test(`${endpoint} responds while the counter database is still pending`, async () => {
    let finishTraffic;
    pendingTraffic = new Promise((resolve) => { finishTraffic = resolve; });
    failTraffic = false;
    const res = makeRes();
    const request = req();
    request.body.instanceName = "Mac";
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Legacy Vercel functions use CommonJS.
    const endpointHandler = require(`./${endpoint}`);
    const response = endpointHandler(request, res);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(res.body?.ok, true, "license response must not wait for traffic recording");
      assert.equal(res.code, 200);
    } finally {
      finishTraffic({ rows: [] });
      await response;
      pendingTraffic = null;
    }
  });
}
