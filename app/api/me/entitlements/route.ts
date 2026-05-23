import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  try {
    const result = await pool.query(`
      select
        provider,
        status,
        current_period_end
      from subscriptions
      limit 10
    `);

    const hasPro = result.rows.some(
      (row) =>
        row.status === "active" ||
        row.status === "trialing"
    );

    return NextResponse.json({
      pro: hasPro,
      subscriptions: result.rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        pro: false,
        error:
          error instanceof Error
            ? error.message
            : "unknown",
      },
      { status: 500 }
    );
  }
}
