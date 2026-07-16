import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  hashMagicToken,
  hashSessionToken,
  signSessionJwt,
} from "@/lib/auth";

export async function GET(req: NextRequest) {
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
      select id, email, redirect_target
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

    return NextResponse.json({
      ok: true,
      user,
      token: jwt,
    });
  } catch (error) {
    await client.query("rollback");
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
