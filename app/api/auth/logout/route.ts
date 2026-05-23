import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBearerToken, hashSessionToken, verifySessionJwt } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers.get("authorization"));

    if (!token) {
      return NextResponse.json({
        ok: true,
        loggedOut: true,
      });
    }

    const session = verifySessionJwt(token);
    const tokenHash = hashSessionToken(token);

    await pool.query(
      `
      update sessions
      set expires_at = now()
      where user_id = $1
        and token_hash = $2
      `,
      [session.userId, tokenHash]
    );

    return NextResponse.json({
      ok: true,
      loggedOut: true,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      loggedOut: true,
    });
  }
}
