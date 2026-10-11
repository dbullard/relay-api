import crypto from "crypto";

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function verifyHmacHex(body: string, signatureHex: string, secret: string): boolean {
  const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return safeEqual(digest, signatureHex);
}
