import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBearerToken, verifySessionJwt } from "@/lib/auth";

function isSubscriptionPro(status: string, currentPeriodEnd: string | null) {
  if (status === "active" || status === "trialing" || status === "on_trial") {
    return true;
  }

  if (status === "cancelled" && currentPeriodEnd) {
    return new Date(currentPeriodEnd) > new Date();
  }

  return false;
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers.get("authorization"));

    if (!token) {
      return NextResponse.json(
        {
          pro: false,
          authenticated: false,
          subscriptions: [],
          error: "Missing bearer token",
        },
        { status: 401 }
      );
    }

    const session = verifySessionJwt(token);

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

    const hasPro = result.rows.some((row) =>
      isSubscriptionPro(row.status, row.current_period_end)
    );

    return NextResponse.json({
      pro: hasPro,
      authenticated: true,
      user: {
        id: session.userId,
        email: session.email,
      },
      subscriptions: result.rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        pro: false,
        authenticated: false,
        subscriptions: [],
        error: error instanceof Error ? error.message : "Invalid session",
      },
      { status: 401 }
    );
  }
}
