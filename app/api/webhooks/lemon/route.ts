import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

type LemonWebhookPayload = {
  meta?: {
    event_name?: string;
    custom_data?: {
      email?: string;
    };
  };
  data?: {
    id?: string | number;
    attributes?: Record<string, unknown>;
  };
};

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

  let payload: LemonWebhookPayload;

  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 }
    );
  }

  const eventName = payload?.meta?.event_name ?? "";
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
    stringValue(attributes.user_email) ??
    stringValue(attributes.customer_email) ??
    stringValue(attributes.email) ??
    payload?.meta?.custom_data?.email ??
    null;

  const subscriptionId =
    dataId ??
    stringValue(attributes.subscription_id) ??
    nestedSubscriptionId(attributes.first_subscription_item) ??
    null;

  const customerId =
    stringValue(attributes.customer_id) ??
    stringValue(attributes.customer) ??
    null;

  const rawStatus = stringValue(attributes.status);
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
      on conflict (provider, provider_subscription_id)
      where provider_subscription_id is not null
      do update set
        user_id = excluded.user_id,
        provider_customer_id = excluded.provider_customer_id,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        updated_at = now()
      `,
      [user.id, customerId, subscriptionId, status, currentPeriodEnd]
    );

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

function stringValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function nestedSubscriptionId(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeSubscriptionId = (value as { subscription_id?: unknown })
    .subscription_id;
  return stringValue(maybeSubscriptionId);
}
