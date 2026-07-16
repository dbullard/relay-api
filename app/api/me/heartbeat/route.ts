import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBearerToken, hashSessionToken, verifySessionJwt } from "@/lib/auth";

const allowedPayloadKeys = new Set(["installationId", "platform", "appVersion"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type HeartbeatPayload = {
  installationId: string;
  platform: "macos" | "ios";
  appVersion: string;
};

function validatePayload(value: unknown): HeartbeatPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload);
  if (keys.length !== allowedPayloadKeys.size || keys.some((key) => !allowedPayloadKeys.has(key))) {
    return null;
  }

  const { installationId, platform, appVersion } = payload;
  if (
    typeof installationId !== "string" ||
    !uuidPattern.test(installationId) ||
    (platform !== "macos" && platform !== "ios") ||
    typeof appVersion !== "string" ||
    appVersion.length < 1 ||
    appVersion.length > 128
  ) {
    return null;
  }

  return { installationId, platform, appVersion };
}

export async function POST(req: NextRequest) {
  const token = getBearerToken(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing bearer token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid heartbeat payload" }, { status: 400 });
  }

  const payload = validatePayload(body);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Invalid heartbeat payload" }, { status: 400 });
  }

  let session: ReturnType<typeof verifySessionJwt>;
  try {
    session = verifySessionJwt(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });
  }

  try {
    const tokenHash = hashSessionToken(token);
    const sessionResult = await pool.query(
      `
      select id
      from sessions
      where user_id = $1
        and token_hash = $2
        and expires_at > now()
      limit 1
      `,
      [session.userId, tokenHash]
    );

    if (sessionResult.rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Session not found or expired" },
        { status: 401 }
      );
    }

    await pool.query(
      `
      insert into relay_user_presence (user_id, installation_id, platform, app_version, last_seen_at, updated_at)
      values ($1, $2, $3, $4, now(), now())
      on conflict (user_id, installation_id)
      do update set platform = excluded.platform, app_version = excluded.app_version, last_seen_at = now(), updated_at = now()
      `,
      [session.userId, payload.installationId, payload.platform, payload.appVersion]
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to record heartbeat" }, { status: 500 });
  }
}
