import crypto from "crypto";

function encryptionSecret() {
  return process.env.RELAY_LICENSE_ENCRYPTION_SECRET ?? process.env.JWT_SECRET;
}

function encryptionKey() {
  const secret = encryptionSecret();

  if (!secret) {
    throw new Error("Missing license encryption secret");
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
