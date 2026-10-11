import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { hashMagicToken, hashSessionToken, signSessionJwt } from "@/lib/auth";
import { verifyPkce } from "@/lib/pkce";
import { checkRateLimit, type Query } from "@/lib/rateLimit";
import { clientIp } from "@/lib/clientIp";
import { publicServerError } from "@/lib/http";

const INVALID = { ok: false, error: "Invalid or expired code" };

export async function POST(req: NextRequest) {
  const limit = await checkRateLimit(pool.query.bind(pool) as Query, `exchange:ip:${clientIp(req.headers)}`, 30, 600);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  let body: { code?: unknown; codeVerifier?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json(INVALID, { status: 401 }); }
  const code = typeof body.code === "string" ? body.code : "";
  const verifier = typeof body.codeVerifier === "string" ? body.codeVerifier : "";
  if (!code || !verifier) return NextResponse.json(INVALID, { status: 401 });

  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query(
      `select id, email, code_challenge from magic_links
       where auth_code_hash = $1 and auth_code_used_at is null and auth_code_expires_at > now()
       limit 1 for update`,
      [hashMagicToken(code)]
    );
    if (found.rows.length === 0) {
      await client.query("rollback");
      return NextResponse.json(INVALID, { status: 401 });
    }
    const link = found.rows[0];
    // Burn the code on first use, even when the verifier is wrong.
    await client.query("update magic_links set auth_code_used_at = now() where id = $1", [link.id]);
    if (!verifyPkce(verifier, link.code_challenge ?? "")) {
      await client.query("commit");
      return NextResponse.json(INVALID, { status: 401 });
    }

    const userResult = await client.query(
      `insert into users (email) values ($1)
       on conflict (email) do update set email = excluded.email returning id, email`,
      [String(link.email).toLowerCase()]
    );
    const user = userResult.rows[0];
    const jwt = signSessionJwt({ userId: user.id, email: user.email });
    await client.query(
      `insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '30 days')`,
      [user.id, hashSessionToken(jwt)]
    );
    await client.query("commit");
    return NextResponse.json({ ok: true, user, token: jwt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    const { body: b, status } = publicServerError("AUTH_EXCHANGE", error);
    return NextResponse.json(b, { status });
  } finally {
    client.release();
  }
}
