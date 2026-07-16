import { cookies } from "next/headers";
import { forbidden, unauthorized } from "next/navigation";
import { hashSessionToken, verifySessionJwt } from "@/lib/auth";
import { pool } from "@/lib/db";
import DashboardClient from "./dashboard-client";

function dashboardAdmins() {
  return new Set(
    (process.env.RELAY_DASHBOARD_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export default async function DashboardPage() {
  const token = (await cookies()).get("relay_dashboard_session")?.value;

  if (!token) {
    unauthorized();
  }

  let session: ReturnType<typeof verifySessionJwt>;

  try {
    session = verifySessionJwt(token);
  } catch {
    unauthorized();
  }

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
    unauthorized();
  }

  if (!dashboardAdmins().has(session.email.toLowerCase())) {
    forbidden();
  }

  return <DashboardClient />;
}
