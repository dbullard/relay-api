import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBearerToken, hashSessionToken, verifySessionJwt } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers.get("authorization"));

    if (!token) {
      return NextResponse.json(
        { ok: false, authenticated: false, error: "Missing bearer token" },
        { status: 401 }
      );
    }

    const session = verifySessionJwt(token);
    const tokenHash = hashSessionToken(token);

    const result = await pool.query(
      `
      select id, expires_at
      from sessions
      where user_id = $1
        and token_hash = $2
        and expires_at > now()
      limit 1
      `,
      [session.userId, tokenHash]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { ok: false, authenticated: false, error: "Session not found or expired" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      ok: true,
      authenticated: true,
      user: {
        id: session.userId,
        email: session.email,
      },
      session: {
        expiresAt: result.rows[0].expires_at,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, authenticated: false, error: "Invalid session" },
      { status: 401 }
    );
  }
}
