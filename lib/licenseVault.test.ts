import test from "node:test";
import assert from "node:assert/strict";
import { encryptLicenseKey, decryptLicenseKey } from "./licenseVault";

test("round trip with the dedicated secret", () => {
  process.env.RELAY_LICENSE_ENCRYPTION_SECRET = "dedicated-secret";
  delete process.env.JWT_SECRET;
  assert.equal(decryptLicenseKey(encryptLicenseKey("KEY-ABC-123")), "KEY-ABC-123");
});

test("refuses to fall back to JWT_SECRET", () => {
  delete process.env.RELAY_LICENSE_ENCRYPTION_SECRET;
  process.env.JWT_SECRET = "jwt-secret";
  assert.throws(() => encryptLicenseKey("KEY"), /RELAY_LICENSE_ENCRYPTION_SECRET/);
});

test("tampered ciphertext fails authentication", () => {
  process.env.RELAY_LICENSE_ENCRYPTION_SECRET = "dedicated-secret";
  const enc = encryptLicenseKey("KEY-ABC-123").split(":");
  enc[3] = Buffer.from("garbage-bytes!").toString("base64");
  assert.throws(() => decryptLicenseKey(enc.join(":")));
});
