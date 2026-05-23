import crypto from "crypto";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET;

if (!JWT_SECRET) throw new Error("JWT_SECRET is required");
if (!MAGIC_LINK_SECRET) throw new Error("MAGIC_LINK_SECRET is required");

export function createRandomToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashMagicToken(token: string) {
  return crypto
    .createHmac("sha256", MAGIC_LINK_SECRET!)
    .update(token)
    .digest("hex");
}

export function hashSessionToken(token: string) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

export function signSessionJwt(payload: { userId: string; email: string }) {
  return jwt.sign(payload, JWT_SECRET!, {
    expiresIn: "30d",
  });
}

export function verifySessionJwt(token: string) {
  return jwt.verify(token, JWT_SECRET!) as {
    userId: string;
    email: string;
  };
}

export function getBearerToken(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length);
}
