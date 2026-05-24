import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBearerToken, verifySessionJwt } from "@/lib/auth";
import {
  resolveAppStoreSubscription,
  setAppAccountTokenForSubscription,
} from "@/lib/app-store";

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers.get("authorization"));

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing bearer token",
        },
        { status: 401 }
      );
    }

    const session = verifySessionJwt(token);
    const body = await req.json();

    const originalTransactionId = String(
      body.originalTransactionId ?? ""
    ).trim();
    const transactionId = String(body.transactionId ?? "").trim();
    const productId = String(body.productId ?? "").trim();

    if (!originalTransactionId || !productId) {
      return NextResponse.json(
        {
          ok: false,
          error: "originalTransactionId and productId are required",
        },
        { status: 400 }
      );
    }

    const resolved = await resolveAppStoreSubscription(
      transactionId || originalTransactionId,
      productId
    );

    if (resolved.record.originalTransactionId !== originalTransactionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "App Store transaction does not match the requested subscription",
        },
        { status: 400 }
      );
    }

    await pool.query(
      `
      insert into subscriptions (
        user_id,
        provider,
        provider_customer_id,
        provider_subscription_id,
        original_transaction_id,
        status,
        current_period_end
      )
      values ($1, 'app_store', null, $2, $3, $4, $5)
      on conflict (provider, original_transaction_id)
      where original_transaction_id is not null
      do update set
        user_id = excluded.user_id,
        provider_subscription_id = excluded.provider_subscription_id,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        updated_at = now()
      `,
      [
        session.userId,
        resolved.record.originalTransactionId,
        resolved.record.originalTransactionId,
        resolved.record.status,
        resolved.record.currentPeriodEnd,
      ]
    );

    try {
      await setAppAccountTokenForSubscription(
        resolved.record.originalTransactionId,
        session.userId,
        resolved.record.environment
      );
    } catch (error) {
      console.error("[APPLE] Failed to set appAccountToken", {
        originalTransactionId: resolved.record.originalTransactionId,
        userId: session.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    return NextResponse.json({
      ok: true,
      linked: true,
      provider: "app_store",
      originalTransactionId: resolved.record.originalTransactionId,
      status: resolved.record.status,
      currentPeriodEnd: resolved.record.currentPeriodEnd,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to link App Store subscription",
      },
      { status: 500 }
    );
  }
}
