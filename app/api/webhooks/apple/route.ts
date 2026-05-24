import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { NotificationTypeV2 } from "@apple/app-store-server-library";
import { verifyAppleNotification } from "@/lib/app-store";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const signedPayload = String(body.signedPayload ?? "").trim();

    if (!signedPayload) {
      return NextResponse.json(
        { ok: false, error: "signedPayload required" },
        { status: 400 }
      );
    }

    const decoded = await verifyAppleNotification(signedPayload);

    if (decoded.payload.notificationType === NotificationTypeV2.TEST) {
      return NextResponse.json({
        ok: true,
        test: true,
      });
    }

    if (!decoded.record) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "No subscription transaction found in payload",
      });
    }

    const existing = await pool.query(
      `
      select id
      from subscriptions
      where provider = 'app_store'
        and original_transaction_id = $1
      limit 1
      `,
      [decoded.record.originalTransactionId]
    );

    if (existing.rows.length === 0) {
      console.warn("[APPLE] Notification received before account linking", {
        notificationType: decoded.payload.notificationType,
        subtype: decoded.payload.subtype,
        originalTransactionId: decoded.record.originalTransactionId,
        productId: decoded.record.productId,
      });

      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "Subscription has not been linked to a Relay Account yet",
      });
    }

    await pool.query(
      `
      update subscriptions
      set
        status = $2,
        current_period_end = $3,
        updated_at = now()
      where provider = 'app_store'
        and original_transaction_id = $1
      `,
      [
        decoded.record.originalTransactionId,
        decoded.record.status,
        decoded.record.currentPeriodEnd,
      ]
    );

    return NextResponse.json({
      ok: true,
      provider: "app_store",
      notificationType: decoded.payload.notificationType,
      subtype: decoded.payload.subtype ?? null,
      originalTransactionId: decoded.record.originalTransactionId,
      status: decoded.record.status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to process App Store notification",
      },
      { status: 500 }
    );
  }
}
