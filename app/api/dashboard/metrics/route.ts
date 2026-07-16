import { NextRequest, NextResponse } from "next/server";
import { hashSessionToken, verifySessionJwt } from "@/lib/auth";
import { pool } from "@/lib/db";

type Version = {
  platform: string;
  appVersion: string;
  activeUsers: number;
};

function dashboardAdmins() {
  return new Set(
    (process.env.RELAY_DASHBOARD_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get("relay_dashboard_session")?.value;

  if (!token) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const session = verifySessionJwt(token);
    const sessionResult = await pool.query(
      `
      select id
      from sessions
      where user_id = $1
        and token_hash = $2
        and expires_at > now()
      limit 1
      `,
      [session.userId, hashSessionToken(token)]
    );

    if (sessionResult.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!dashboardAdmins().has(session.email.toLowerCase())) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const [activeUsersResult, activeInstallationsResult, relayAccountsResult, versionsResult] =
      await Promise.all([
        pool.query(`
          select count(distinct user_id)::int as active_users
          from relay_user_presence where last_seen_at >= now() - interval '5 minutes';
        `),
        pool.query(`
          select count(*)::int as active_installations
          from relay_user_presence where last_seen_at >= now() - interval '5 minutes';
        `),
        pool.query(`select count(*)::int as relay_accounts from users;`),
        pool.query(`
          select platform, app_version, count(distinct user_id)::int as active_users
          from relay_user_presence where last_seen_at >= now() - interval '5 minutes'
          group by platform, app_version order by active_users desc, platform, app_version;
        `),
      ]);

    const versions: Version[] = versionsResult.rows.map((row) => ({
      platform: row.platform,
      appVersion: row.app_version,
      activeUsers: row.active_users,
    }));

    return NextResponse.json({
      activeUsers: activeUsersResult.rows[0].active_users,
      activeInstallations: activeInstallationsResult.rows[0].active_installations,
      relayAccounts: relayAccountsResult.rows[0].relay_accounts,
      versions,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
}
