import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBearerToken, verifySessionJwt } from "@/lib/auth";

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

function isLicensePro(status: string, expiresAt: string | null) {
  if (status !== "active" && status !== "inactive") {
    return false;
  }

  if (!expiresAt) {
    return true;
  }

  return new Date(expiresAt) > new Date();
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

    const subscriptionResult = await pool.query(
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

    const licenseResult = await pool.query(
      `
      select
        license_key_masked,
        customer_email,
        product_name,
        variant_name,
        status,
        expires_at,
        source,
        linked_at,
        last_validated_at
      from licenses
      where user_id = $1
      order by linked_at desc
      `,
      [session.userId]
    );

    const hasSubscriptionPro = subscriptionResult.rows.some((row) =>
      isSubscriptionPro(row.status, row.current_period_end)
    );

    const hasLicensePro = licenseResult.rows.some((row) =>
      isLicensePro(row.status, row.expires_at)
    );

    const hasPro = hasSubscriptionPro || hasLicensePro;

    return NextResponse.json({
      pro: hasPro,
      authenticated: true,
      user: {
        id: session.userId,
        email: session.email,
      },
      sources: {
        subscription: hasSubscriptionPro,
        license: hasLicensePro,
      },
      subscriptions: subscriptionResult.rows,
      licenses: licenseResult.rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        pro: false,
        authenticated: false,
        subscriptions: [],
        licenses: [],
        error: error instanceof Error ? error.message : "Invalid session",
      },
      { status: 401 }
    );
  }
}
