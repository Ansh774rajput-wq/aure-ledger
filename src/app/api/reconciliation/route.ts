import { NextRequest, NextResponse } from "next/server";
import { database } from "@/infrastructure/database";
import { PrismaReconciliationGateway } from "@/infrastructure/ledger";
import { runReconciliation } from "@/application/reconcile";
import { validSession, unauthorized, PRIVATE_HEADERS } from "@/infrastructure/auth";

export const runtime = "nodejs";

export async function GET(r: NextRequest) {
  if (!validSession(r)) return unauthorized();
  try {
    const db = database();
    const result = await runReconciliation(new PrismaReconciliationGateway(db));
    return NextResponse.json(result, {
      headers: PRIVATE_HEADERS,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Reconciliation check failed.";
    return NextResponse.json({ error: msg }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
