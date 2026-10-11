import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { publicServerError } from "@/lib/http";
import { verifyHmacHex } from "@/lib/signature";

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

  if (!verifyHmacHex(body, signature, secret)) {
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

  const providerUpdatedAt = stringValue(attributes.updated_at);

  const currentPeriodEnd =
    attributes.renews_at ??
    attributes.ends_at ??
    attributes.trial_ends_at ??
    null;

  if (!email || !subscriptionId) {
    console.log("[LEMON] missing required fields", {
      eventName,
      hasEmail: Boolean(email),
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
        current_period_end,
        provider_updated_at
      )
      values ($1, 'lemon_squeezy', $2, $3, $4, $5, $6)
      on conflict (provider, provider_subscription_id)
      where provider_subscription_id is not null
      do update set
        user_id = excluded.user_id,
        provider_customer_id = excluded.provider_customer_id,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        provider_updated_at = excluded.provider_updated_at,
        updated_at = now()
      where subscriptions.provider_updated_at is null
         or excluded.provider_updated_at is null
         or excluded.provider_updated_at >= subscriptions.provider_updated_at
      `,
      [user.id, customerId, subscriptionId, status, currentPeriodEnd, providerUpdatedAt]
    );

    await client.query("commit");

    console.log("[LEMON]", eventName, subscriptionId, status);

    return NextResponse.json({
      ok: true,
      eventName,
      email,
      subscriptionId,
      status,
    });
  } catch (error) {
    await client.query("rollback");

    const { body, status } = publicServerError("LEMON_WEBHOOK", error);
    return NextResponse.json(body, { status });
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
