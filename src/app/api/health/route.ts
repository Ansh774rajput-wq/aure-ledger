import { NextResponse } from "next/server";
import { database } from "../../../infrastructure/database";

export const runtime = "nodejs";

/**
 * Minimal unauthenticated health check endpoint.
 * Suitable for container orchestrator liveness/readiness probes (e.g. Render, Railway, Fly.io, Kubernetes, Docker).
 * Strictly reveals no private information, credentials, database topology, or financial records.
 */
export async function GET() {
  try {
    const db = database();
    await db.$queryRawUnsafe("SELECT 1");
    return NextResponse.json(
      { status: "healthy" },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
          Pragma: "no-cache",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { status: "unhealthy" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
          Pragma: "no-cache",
        },
      },
    );
  }
}
