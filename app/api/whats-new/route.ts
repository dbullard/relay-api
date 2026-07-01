import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBearerToken } from "@/lib/auth";

type WhatsNewFeature = {
  icon: string;
  iconColor: string;
  title: string;
  description: string;
};

const HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}$/;

function isValidFeature(value: unknown): value is WhatsNewFeature {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.icon === "string" &&
    f.icon.length > 0 &&
    typeof f.iconColor === "string" &&
    HEX_COLOR_RE.test(f.iconColor) &&
    typeof f.title === "string" &&
    f.title.length > 0 &&
    typeof f.description === "string" &&
    f.description.length > 0
  );
}

export async function GET(req: NextRequest) {
  try {
    const channel = req.nextUrl.searchParams.get("channel") || "release";

    const result = await pool.query(
      `
      select version, release_date, features
      from whats_new_releases
      where channel = $1
      order by created_at desc
      `,
      [channel]
    );

    return NextResponse.json({
      releases: result.rows.map((row) => ({
        version: row.version,
        date: row.release_date,
        features: row.features,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load What's New feed",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const adminSecret = process.env.WHATS_NEW_ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json(
      { error: "WHATS_NEW_ADMIN_SECRET is not configured" },
      { status: 500 }
    );
  }

  const token = getBearerToken(req.headers.get("authorization"));
  if (token !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { version, date, channel, features } = body || {};

    if (typeof version !== "string" || !version) {
      return NextResponse.json({ error: "Missing version" }, { status: 400 });
    }
    if (typeof date !== "string" || !date) {
      return NextResponse.json({ error: "Missing date" }, { status: 400 });
    }
    if (!Array.isArray(features) || !features.every(isValidFeature)) {
      return NextResponse.json(
        { error: "features must be an array of { icon, iconColor, title, description }" },
        { status: 400 }
      );
    }

    const resolvedChannel = typeof channel === "string" && channel ? channel : "release";

    await pool.query(
      `
      insert into whats_new_releases (version, channel, release_date, features)
      values ($1, $2, $3, $4::jsonb)
      on conflict (version, channel)
      do update set
        release_date = excluded.release_date,
        features = excluded.features,
        updated_at = now()
      `,
      [version, resolvedChannel, date, JSON.stringify(features)]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save release",
      },
      { status: 500 }
    );
  }
}
