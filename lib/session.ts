import crypto from "crypto";

export type SessionQuery = (text: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
type Claims = { userId: string; email: string };

function bearer(header: string | null) {
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

export async function authenticateBearer(
  authHeader: string | null,
  query: SessionQuery,
  verify: (token: string) => Claims
): Promise<
  | { ok: true; session: Claims }
  | { ok: false; status: 401; error: string }
> {
  const token = bearer(authHeader);
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" };

  let claims: Claims;
  try {
    claims = verify(token);
  } catch {
    return { ok: false, status: 401, error: "Invalid session" };
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const result = await query(
      `select id from sessions where user_id = $1 and token_hash = $2 and expires_at > now() limit 1`,
      [claims.userId, tokenHash]
    );
    if (result.rows.length === 0) {
      return { ok: false, status: 401, error: "Session not found or expired" };
    }
    return { ok: true, session: claims };
  } catch (error) {
    console.error("[SESSION] lookup failed", error instanceof Error ? error.message : error);
    return { ok: false, status: 401, error: "Invalid session" };
  }
}
