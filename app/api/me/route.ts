import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { verifySessionJwt } from "@/lib/auth";
import { authenticateBearer, type SessionQuery } from "@/lib/session";

function isSubscriptionPro(status: string, currentPeriodEnd: string | null) {
  if (
    status === "active" ||
    status === "trialing" ||
    status === "on_trial" ||
    status === "billing_grace_period"
  ) {
    return true;
  }

  if (status === "cancelled" && currentPeriodEnd) {
    return new Date(currentPeriodEnd) > new Date();
  }

  return false;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateBearer(
      req.headers.get("authorization"),
      pool.query.bind(pool) as SessionQuery,
      verifySessionJwt
    );
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, authenticated: false, pro: false, subscriptions: [], error: auth.error },
        { status: auth.status }
      );
    }
    const session = auth.session;

    const result = await pool.query(
      `
      select
        provider,
        status,
        current_period_end
      from subscriptions
      where user_id = $1
      order by created_at desc
      `,
      [session.userId]
    );

    const subscriptions = result.rows;
    const pro = subscriptions.some((row) =>
      isSubscriptionPro(row.status, row.current_period_end)
    );

    return NextResponse.json({
      ok: true,
      authenticated: true,
      user: {
        id: session.userId,
        email: session.email,
      },
      pro,
      subscriptions,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        authenticated: false,
        pro: false,
        subscriptions: [],
        error: "Invalid session",
      },
      { status: 401 }
    );
  }
}
