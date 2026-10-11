import crypto from "crypto";

const B64URL = /^[A-Za-z0-9_-]+$/;

export function isValidChallenge(value: unknown): value is string {
  return typeof value === "string" && value.length === 43 && B64URL.test(value);
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128) return false;
  if (!isValidChallenge(challenge)) return false;
  const computed = crypto.createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
