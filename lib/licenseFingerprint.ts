import crypto from "crypto";

export function licenseFingerprint(licenseKey: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(licenseKey.trim()).digest("hex");
}
