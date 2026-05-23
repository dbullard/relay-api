import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  try {
    const result = await pool.query("select now() as now");
    return NextResponse.json({
      ok: true,
      database: "connected",
      now: result.rows[0].now,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
