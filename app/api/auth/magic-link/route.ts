import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { createRandomToken, hashMagicToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { ok: false, error: "Valid email required" },
        { status: 400 }
      );
    }

    const token = createRandomToken();
    const tokenHash = hashMagicToken(token);

    await pool.query(
      `
      insert into magic_links (email, token_hash, expires_at)
      values ($1, $2, now() + interval '15 minutes')
      `,
      [email, tokenHash]
    );

    const baseUrl =
      process.env.RELAY_API_PUBLIC_URL ?? "http://localhost:3000";

    const verifyUrl = `${baseUrl}/api/auth/verify?token=${token}`;

    const isDev = process.env.NODE_ENV !== "production";

return NextResponse.json({
  ok: true,
  message: "Magic link created",
  verifyUrl,
  ...(isDev ? { devOnlyToken: token } : {}),
});
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
