import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

function verifySignature(body: string, signature: string, secret: string) {
  const digest = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

function normalizeStatus(eventName: string, status: string | null) {
  if (eventName === "subscription_expired") return "expired";
  if (eventName === "subscription_cancelled") return "cancelled";
  if (eventName === "subscription_resumed") return "active";
  if (eventName === "subscription_payment_failed") return status ?? "past_due";
  return status ?? "unknown";
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-signature");

  if (!signature) {
    return NextResponse.json(
      { ok: false, error: "missing signature" },
      { status: 401 }
    );
  }

  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "missing webhook secret" },
      { status: 500 }
    );
  }

  const body = await req.text();

  if (!verifySignature(body, signature, secret)) {
    return NextResponse.json(
      { ok: false, error: "invalid signature" },
      { status: 401 }
    );
  }

  let payload: any;

  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 }
    );
  }

  const eventName = payload?.meta?.event_name;
  const attributes = payload?.data?.attributes ?? {};
  const dataId = payload?.data?.id ? String(payload.data.id) : null;

  const supportedEvents = new Set([
    "subscription_created",
    "subscription_updated",
    "subscription_cancelled",
    "subscription_resumed",
    "subscription_expired",
    "subscription_payment_success",
    "subscription_payment_failed",
  ]);

  if (!supportedEvents.has(eventName)) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      eventName,
    });
  }

  const email =
    attributes.user_email ??
    attributes.customer_email ??
    attributes.email ??
    payload?.meta?.custom_data?.email ??
    null;

  const subscriptionId =
    dataId ??
    attributes.subscription_id?.toString() ??
    attributes.first_subscription_item?.subscription_id?.toString() ??
    null;

  const customerId =
    attributes.customer_id?.toString() ??
    attributes.customer?.toString() ??
    null;

  const rawStatus = attributes.status ? String(attributes.status) : null;
  const status = normalizeStatus(eventName, rawStatus);

  const currentPeriodEnd =
    attributes.renews_at ??
    attributes.ends_at ??
    attributes.trial_ends_at ??
    null;

  if (!email || !subscriptionId) {
    console.log("[LEMON] missing required fields", {
      eventName,
      email,
      subscriptionId,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "missing email or subscription id",
      },
      { status: 400 }
    );
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const userResult = await client.query(
      `
      insert into users (email)
      values ($1)
      on conflict (email)
      do update set email = excluded.email
      returning id, email
      `,
      [email.toLowerCase()]
    );

    const user = userResult.rows[0];

    const existingResult = await client.query(
      `
      select id
      from subscriptions
      where provider = 'lemon_squeezy'
        and provider_subscription_id = $1
      limit 1
      `,
      [subscriptionId]
    );

    if (existingResult.rows.length > 0) {
      await client.query(
        `
        update subscriptions
        set
          user_id = $1,
          provider_customer_id = $2,
          status = $3,
          current_period_end = $4,
          updated_at = now()
        where id = $5
        `,
        [
          user.id,
          customerId,
          status,
          currentPeriodEnd,
          existingResult.rows[0].id,
        ]
      );
    } else {
      await client.query(
        `
        insert into subscriptions (
          user_id,
          provider,
          provider_customer_id,
          provider_subscription_id,
          status,
          current_period_end
        )
        values ($1, 'lemon_squeezy', $2, $3, $4, $5)
        `,
        [user.id, customerId, subscriptionId, status, currentPeriodEnd]
      );
    }

    await client.query("commit");

    console.log("[LEMON]", eventName, email, subscriptionId, status);

    return NextResponse.json({
      ok: true,
      eventName,
      email,
      subscriptionId,
      status,
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