import { NextRequest, NextResponse } from "next/server";
import {
  authConfigured,
  checkPassword,
  COOKIE,
  issueSession,
  PRIVATE_HEADERS,
  sameOrigin,
  validSession,
} from "@/infrastructure/auth";

export const runtime = "nodejs";

import {
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
} from "@/infrastructure/rate-limiter";
import { database } from "@/infrastructure/database";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "127.0.0.1";
}

export async function GET(r: NextRequest) {
  return NextResponse.json(
    { configured: authConfigured(), authenticated: validSession(r) },
    { headers: PRIVATE_HEADERS },
  );
}

export async function POST(r: NextRequest) {
  if (!sameOrigin(r)) {
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403, headers: PRIVATE_HEADERS },
    );
  }

  if (!authConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set APP_PASSWORD and SESSION_SECRET to enable your private ledger.",
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }

  const clientIp = getClientIp(r);
  let db;
  try {
    db = database();
  } catch {
    // Database unconfigured or starting up
  }

  const rateLimit = await checkRateLimit(clientIp, db);
  if (!rateLimit.allowed) {
    const retryAfter = (rateLimit.retryAfterSeconds ?? 900).toString();
    return NextResponse.json(
      { error: "Too many failed login attempts. Try again in 15 minutes." },
      {
        status: 429,
        headers: {
          ...PRIVATE_HEADERS,
          "Retry-After": retryAfter,
        },
      },
    );
  }

  try {
    const body = await r.json();
    const isValid =
      typeof body.password === "string" &&
      body.password.length <= 256 &&
      checkPassword(body.password);

    if (!isValid) {
      await recordFailedAttempt(clientIp, db);
      return NextResponse.json(
        { error: "Incorrect password." },
        { status: 401, headers: PRIVATE_HEADERS },
      );
    }

    // Success: clear rate limiting state for this IP
    await clearRateLimit(clientIp, db);

    const isSecure =
      r.nextUrl.protocol === "https:" ||
      (process.env.APP_ORIGIN?.startsWith("https:") &&
        !r.nextUrl.hostname.includes("127.0.0.1") &&
        !r.nextUrl.hostname.includes("localhost"));

    const response = NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
    response.cookies.set(COOKIE, issueSession(), {
      httpOnly: true,
      secure: isSecure,
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 3600,
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: "Invalid login request." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
}

export async function DELETE(r: NextRequest) {
  if (!sameOrigin(r)) {
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403, headers: PRIVATE_HEADERS },
    );
  }

  const isSecure =
    process.env.NODE_ENV === "production" ||
    new URL(process.env.APP_ORIGIN ?? "http://localhost:3000").protocol === "https:";

  const response = NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  response.cookies.set(COOKIE, "", {
    httpOnly: true,
    secure: isSecure,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
