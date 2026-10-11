const test = require("node:test");
const assert = require("node:assert/strict");
const { validLicenseKey, validInstanceName, validEmail } = require("./limits");

test("license keys", () => {
  assert.equal(validLicenseKey("38b1460a-5104-4067-a91d-77b872934d51"), true);
  assert.equal(validLicenseKey("short"), false);
  assert.equal(validLicenseKey("x".repeat(129)), false);
  assert.equal(validLicenseKey("has space in it 123456"), false);
  assert.equal(validLicenseKey(undefined), false);
});
test("instance names", () => {
  assert.equal(validInstanceName("David's MacBook"), true);
  assert.equal(validInstanceName(""), false);
  assert.equal(validInstanceName("a\nb"), false);
  assert.equal(validInstanceName("x".repeat(101)), false);
});
test("emails", () => {
  assert.equal(validEmail("a@b.co"), true);
  assert.equal(validEmail("a b@c.co"), false);
  assert.equal(validEmail("no-at-sign"), false);
  assert.equal(validEmail("a@" + "b".repeat(260)), false);
});
