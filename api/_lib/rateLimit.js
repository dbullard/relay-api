async function checkRateLimit(query, key, limit, windowSeconds, nowMs = Date.now()) {
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

function clientIp(headers) {
  const forwarded = headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return headers["x-real-ip"] || "unknown";
}

// Returns true when the request was rejected (response already sent).
async function enforce(req, res, pool, keyPrefix, limit, windowSeconds) {
  const result = await checkRateLimit(
    pool.query.bind(pool),
    `${keyPrefix}:ip:${clientIp(req.headers)}`,
    limit,
    windowSeconds
  );
  if (result.allowed) return false;
  res.setHeader("Retry-After", String(result.retryAfterSeconds));
  res.status(429).json({ ok: false, error: "Too many requests. Please try again later." });
  return true;
}

module.exports = { checkRateLimit, clientIp, enforce };
