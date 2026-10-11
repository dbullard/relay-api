export type Query = (text: string, params: unknown[]) => Promise<{ rows: { count: number }[] }>;

export async function checkRateLimit(
  query: Query,
  key: string,
  limit: number,
  windowSeconds: number,
  nowMs: number = Date.now()
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  const nowSec = Math.floor(nowMs / 1000);
  const windowStartSec = nowSec - (nowSec % windowSeconds);
  try {
    const result = await query(
      `insert into rate_limits (key, window_start, count)
       values ($1, to_timestamp($2), 1)
       on conflict (key, window_start)
       do update set count = rate_limits.count + 1
       returning count`,
      [key, windowStartSec]
    );
    const count = Number(result.rows[0].count);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: windowStartSec + windowSeconds - nowSec,
    };
  } catch (error) {
    console.error("[RATE_LIMIT] check failed, allowing request", error instanceof Error ? error.message : error);
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}
