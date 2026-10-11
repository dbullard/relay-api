import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { verifySessionJwt } from "@/lib/auth";
import crypto from "crypto";
import { authenticateBearer, type SessionQuery } from "@/lib/session";
import { deleteAccountData } from "@/lib/deleteAccount";
import { publicServerError } from "@/lib/http";

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

export async function DELETE(req: NextRequest) {
  const auth = await authenticateBearer(
    req.headers.get("authorization"),
    pool.query.bind(pool) as SessionQuery,
    verifySessionJwt
  );
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await deleteAccountData(client, auth.session.userId);
    await client.query("commit");
    console.log(
      "[ACCOUNT] deleted account",
      crypto.createHash("sha256").update(auth.session.userId).digest("hex").slice(0, 12)
    );
    return NextResponse.json({ ok: true, deleted: true });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    const { body, status } = publicServerError("ACCOUNT_DELETE", error, "Unable to delete account");
    return NextResponse.json(body, { status });
  } finally {
    client.release();
  }
}
