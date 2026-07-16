import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { createRandomToken, hashMagicToken } from "@/lib/auth";
import { sendMagicLinkEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const redirectTarget = body.redirectTarget;

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { ok: false, error: "Valid email required" },
        { status: 400 }
      );
    }

    if (redirectTarget !== undefined && redirectTarget !== "dashboard") {
      return NextResponse.json(
        { ok: false, error: "Invalid redirect target" },
        { status: 400 }
      );
    }

    const token = createRandomToken();
    const tokenHash = hashMagicToken(token);

    await pool.query(
      `
      insert into magic_links (email, token_hash, expires_at, redirect_target)
      values ($1, $2, now() + interval '15 minutes', $3)
      `,
      [email, tokenHash, redirectTarget ?? null]
    );

    const baseUrl =
      process.env.RELAY_API_PUBLIC_URL ?? "http://localhost:3000";

    const verifyUrl = `${baseUrl}/api/auth/verify?token=${token}`;

    const isDev = process.env.NODE_ENV !== "production";

    try {
      await sendMagicLinkEmail(email, verifyUrl);
    } catch (emailError) {
      await pool.query(
        `
        delete from magic_links
        where token_hash = $1
        `,
        [tokenHash]
      );

      console.error("[AUTH] Failed to send magic link email", emailError);

      return NextResponse.json(
        {
          ok: false,
          error: "Failed to send magic link",
          ...(isDev ? { verifyUrl, devOnlyToken: token } : {}),
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Magic link sent",
      ...(isDev ? { verifyUrl, devOnlyToken: token } : {}),
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
