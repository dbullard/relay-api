import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  createRandomToken,
  hashMagicToken,
  hashSessionToken,
  signSessionJwt,
} from "@/lib/auth";
import { publicServerError } from "@/lib/http";
import { checkRateLimit, type Query } from "@/lib/rateLimit";
import { clientIp } from "@/lib/clientIp";

export async function GET(req: NextRequest) {
  const verifyLimit = await checkRateLimit(
    pool.query.bind(pool) as Query,
    `verify:ip:${clientIp(req.headers)}`,
    30,
    600
  );
  if (!verifyLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(verifyLimit.retryAfterSeconds) } }
    );
  }

  const client = await pool.connect();

  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Token required" },
        { status: 400 }
      );
    }

    const tokenHash = hashMagicToken(token);

    await client.query("begin");

    const magicResult = await client.query(
      `
      select id, email, redirect_target, code_challenge
      from magic_links
      where token_hash = $1
        and used_at is null
        and expires_at > now()
      limit 1
      for update
      `,
      [tokenHash]
    );

    if (magicResult.rows.length === 0) {
      await client.query("rollback");
      return NextResponse.json(
        { ok: false, error: "Invalid or expired magic link" },
        { status: 401 }
      );
    }

    const magicLink = magicResult.rows[0];
    const email = magicLink.email.toLowerCase();
    const wantsApp =
      req.nextUrl.searchParams.get("redirect") === "app" &&
      magicLink.redirect_target !== "dashboard";

    if (wantsApp && magicLink.code_challenge) {
      // PKCE flow: no session yet. Hand the app a one-time code that is
      // useless without the verifier only the app holds.
      const code = createRandomToken();
      await client.query(
        `
        update magic_links
        set used_at = now(),
            auth_code_hash = $2,
            auth_code_expires_at = now() + interval '2 minutes'
        where id = $1
        `,
        [magicLink.id, hashMagicToken(code)]
      );
      await client.query("commit");

      const callbackUrl = new URL("relay://auth/callback");
      callbackUrl.searchParams.set("code", code);
      const redirect = NextResponse.redirect(callbackUrl);
      redirect.headers.set("Cache-Control", "no-store");
      redirect.headers.set("Referrer-Policy", "no-referrer");
      return redirect;
    }

    if (wantsApp && process.env.RELAY_REQUIRE_PKCE === "true") {
      await client.query("rollback");
      return NextResponse.json(
        { ok: false, error: "Please update Relay to sign in" },
        { status: 400 }
      );
    }

    const userResult = await client.query(
      `
      insert into users (email)
      values ($1)
      on conflict (email)
      do update set email = excluded.email
      returning id, email
      `,
      [email]
    );

    const user = userResult.rows[0];

    await client.query(
      `
      update magic_links
      set used_at = now()
      where id = $1
      `,
      [magicLink.id]
    );

    const jwt = signSessionJwt({
      userId: user.id,
      email: user.email,
    });

    const sessionHash = hashSessionToken(jwt);

    await client.query(
      `
      insert into sessions (
        user_id,
        token_hash,
        expires_at
      )
      values (
        $1,
        $2,
        now() + interval '30 days'
      )
      `,
      [user.id, sessionHash]
    );


    await client.query("commit");

    if (magicLink.redirect_target === "dashboard") {
      const dashboardAdmins = new Set(
        (process.env.RELAY_DASHBOARD_ADMIN_EMAILS ?? "")
          .split(",")
          .map((adminEmail) => adminEmail.trim().toLowerCase())
          .filter(Boolean)
      );

      if (!dashboardAdmins.has(user.email.toLowerCase())) {
        return NextResponse.json(
          { ok: false, error: "Dashboard access denied" },
          { status: 403 }
        );
      }

      const response = NextResponse.redirect(new URL("/dashboard", req.url));
      response.cookies.set("relay_dashboard_session", jwt, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });

      return response;
    }

    if (req.nextUrl.searchParams.get("redirect") === "app") {
      const appCallbackUrl = new URL("relay://auth/callback");
      appCallbackUrl.searchParams.set("token", jwt);

      const legacyRedirect = NextResponse.redirect(appCallbackUrl);
      legacyRedirect.headers.set("Cache-Control", "no-store");
      legacyRedirect.headers.set("Referrer-Policy", "no-referrer");
      return legacyRedirect;
    }

    return NextResponse.json({
      ok: true,
      user,
      token: jwt,
    });
  } catch (error) {
    await client.query("rollback");
    const { body, status } = publicServerError("AUTH_VERIFY", error);
    return NextResponse.json(body, { status });
  } finally {
    client.release();
  }
}
