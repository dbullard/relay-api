import crypto from "crypto";

function encryptionKey() {
  const secret = process.env.RELAY_LICENSE_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("RELAY_LICENSE_ENCRYPTION_SECRET is required");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptLicenseKey(licenseKey: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(licenseKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptLicenseKey(payload: string) {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");

  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted license key payload");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
