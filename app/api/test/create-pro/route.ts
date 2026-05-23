import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  const email = "test@relay.local";

  const userResult = await pool.query(
    `
    insert into users (email)
    values ($1)
    on conflict (email)
    do update set email = excluded.email
    returning id, email
    `,
    [email]
  );

  const user = userResult.rows[0];

  await pool.query(
    `
    insert into subscriptions (
      user_id,
      provider,
      provider_subscription_id,
      status,
      current_period_end
    )
    values ($1, 'test', 'test-subscription-1', 'active', now() + interval '30 days')
    `,
    [user.id]
  );

  return NextResponse.json({
    ok: true,
    user,
    pro: true,
  });
}
