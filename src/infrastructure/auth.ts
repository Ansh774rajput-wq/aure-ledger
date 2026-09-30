import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
export const COOKIE = "lending_session";
export function authConfigured() {
  return (
    !!process.env.APP_PASSWORD &&
    (process.env.SESSION_SECRET?.length ?? 0) >= 32
  );
}
function sign(value: string) {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(value)
    .digest("hex");
}
export function validSession(request: NextRequest) {
  if (!authConfigured()) return false;
  const token = request.cookies.get(COOKIE)?.value ?? "";
  const [expires, nonce, signature] = token.split(".");
  if (
    !/^\d+$/.test(expires ?? "") ||
    !nonce ||
    !signature ||
    Number(expires) < Date.now()
  )
    return false;
  const expected = sign(`${expires}.${nonce}`);
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}
export function issueSession() {
  const value = `${Date.now() + 8 * 3600 * 1000}.${randomBytes(24).toString("hex")}`;
  return `${value}.${sign(value)}`;
}
export function checkPassword(password: string) {
  if (!authConfigured()) return false;
  return timingSafeEqual(
    scryptSync(password, "lending-login", 32),
    scryptSync(process.env.APP_PASSWORD!, "lending-login", 32),
  );
}
export const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

export function sameOrigin(request: NextRequest) {
  const expected = process.env.APP_ORIGIN ?? "http://localhost:3000";
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const eUrl = new URL(expected);
    // In production, require the configured HTTPS origin; local loopback convenience must not expand production trust.
    if (eUrl.protocol === "https:") {
      return origin === expected;
    }

    if (
      process.env.NODE_ENV === "production" &&
      !expected.includes("127.0.0.1") &&
      !expected.includes("localhost")
    ) {
      return false;
    }

    // Development / test environment convenience
    if (origin === expected) return true;
    const oUrl = new URL(origin);
    const isLoopback = (h: string) => h === "localhost" || h === "127.0.0.1";
    if (
      isLoopback(oUrl.hostname) &&
      isLoopback(eUrl.hostname) &&
      oUrl.port === eUrl.port &&
      oUrl.protocol === eUrl.protocol
    ) {
      return true;
    }
  } catch {}
  return false;
}

export function unauthorized() {
  return NextResponse.json(
    { error: "Sign in to access your ledger." },
    { status: 401, headers: PRIVATE_HEADERS },
  );
}
