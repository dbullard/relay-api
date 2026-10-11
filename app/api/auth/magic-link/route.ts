import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { createRandomToken, hashMagicToken } from "@/lib/auth";
import { sendMagicLinkEmail } from "@/lib/email";
import { publicServerError } from "@/lib/http";
import { checkRateLimit, type Query } from "@/lib/rateLimit";
import { clientIp } from "@/lib/clientIp";
import { isValidChallenge } from "@/lib/pkce";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const redirectTarget = body.redirectTarget;

    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
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

    const codeChallenge = body.codeChallenge;
    const requirePkce = process.env.RELAY_REQUIRE_PKCE === "true";
    if (codeChallenge !== undefined && !isValidChallenge(codeChallenge)) {
      return NextResponse.json({ ok: false, error: "Invalid code challenge" }, { status: 400 });
    }
    if (requirePkce && redirectTarget === undefined && codeChallenge === undefined) {
      return NextResponse.json({ ok: false, error: "Please update Relay to sign in" }, { status: 400 });
    }

    const ip = clientIp(req.headers);
    const ipLimit = await checkRateLimit(pool.query.bind(pool) as Query, `magic:ip:${ip}`, 20, 3600);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
      );
    }
    const emailLimit = await checkRateLimit(pool.query.bind(pool) as Query, `magic:email:${email}`, 3, 900);
    if (!emailLimit.allowed) {
      return NextResponse.json({ ok: true, message: "Magic link sent" });
    }

    const token = createRandomToken();
    const tokenHash = hashMagicToken(token);

    await pool.query(
      `
      insert into magic_links (email, token_hash, expires_at, redirect_target, code_challenge)
      values ($1, $2, now() + interval '15 minutes', $3, $4)
      `,
      [email, tokenHash, redirectTarget ?? null, codeChallenge ?? null]
    );

    const baseUrl =
      process.env.RELAY_API_PUBLIC_URL ??
      (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");

    if (!baseUrl) {
      await pool.query(`delete from magic_links where token_hash = $1`, [tokenHash]);
      const { body: errBody, status } = publicServerError(
        "AUTH_MAGIC_LINK",
        new Error("RELAY_API_PUBLIC_URL is not configured")
      );
      return NextResponse.json(errBody, { status });
    }

    const verifyUrl = `${baseUrl}/api/auth/verify?token=${token}`;

    const isDev = process.env.NODE_ENV === "development";

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
    const { body, status } = publicServerError("AUTH_MAGIC_LINK", error);
    return NextResponse.json(body, { status });
  }
}
