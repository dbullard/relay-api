import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifySessionJwt } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers.get("authorization"));

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing bearer token" },
        { status: 401 }
      );
    }

    const session = verifySessionJwt(token);

    return NextResponse.json({
      ok: true,
      user: {
        id: session.userId,
        email: session.email,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid session" },
      { status: 401 }
    );
  }
}
