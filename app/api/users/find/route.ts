import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");

  if (!email) {
    return NextResponse.json(
      { error: "email required" },
      { status: 400 }
    );
  }

  const result = await pool.query(
    `
    select
      u.id,
      u.email
    from users u
    where lower(u.email)=lower($1)
    limit 1
    `,
    [email]
  );

  return NextResponse.json({
    exists: result.rows.length > 0,
    user: result.rows[0] ?? null,
  });
}
