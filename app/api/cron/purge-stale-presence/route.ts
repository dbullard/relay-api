import { timingSafeEqual } from "node:crypto";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function hasValidCronAuthorization(authorization: string | null): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !authorization) return false;

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const received = Buffer.from(authorization);

  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(request: Request) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"))) {
    return new Response(null, { status: 401 });
  }

  try {
    await pool.query(`
      delete from relay_user_presence
      where last_seen_at < now() - interval '30 days'
    `);

    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 500 });
  }
}
