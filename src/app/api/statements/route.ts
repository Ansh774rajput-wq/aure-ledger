import { NextRequest, NextResponse } from "next/server";
import { database } from "@/infrastructure/database";
import {
  getAgreementStatement,
  getPoolStatement,
  getFinancialPositionSummary,
  getActivityLedger,
} from "@/infrastructure/ledger";
import { validSession, unauthorized, PRIVATE_HEADERS } from "@/infrastructure/auth";

export const runtime = "nodejs";

export async function GET(r: NextRequest) {
  if (!validSession(r)) return unauthorized();
  try {
    const db = database();
    const searchParams = r.nextUrl.searchParams;
    const type = searchParams.get("type");

    if (type === "loan") {
      const id = searchParams.get("id");
      if (!id) {
        return NextResponse.json({ error: "Missing loan id parameter." }, { status: 400, headers: PRIVATE_HEADERS });
      }
      const statement = await getAgreementStatement(db, id, "LOAN");
      return NextResponse.json(statement, { headers: PRIVATE_HEADERS });
    }

    if (type === "borrowing") {
      const id = searchParams.get("id");
      if (!id) {
        return NextResponse.json({ error: "Missing borrowing id parameter." }, { status: 400, headers: PRIVATE_HEADERS });
      }
      const statement = await getAgreementStatement(db, id, "BORROWING");
      return NextResponse.json(statement, { headers: PRIVATE_HEADERS });
    }

    if (type === "pool") {
      const pool = await getPoolStatement(db);
      return NextResponse.json(pool, { headers: PRIVATE_HEADERS });
    }

    if (type === "summary" || type === "position") {
      const summary = await getFinancialPositionSummary(db);
      return NextResponse.json(summary, { headers: PRIVATE_HEADERS });
    }

    if (type === "activity") {
      const from = searchParams.get("from") || undefined;
      const to = searchParams.get("to") || undefined;
      const search = searchParams.get("search") || undefined;
      const entityType = searchParams.get("entityType") || undefined;
      const direction = searchParams.get("direction") || undefined;
      const activities = await getActivityLedger(db, { from, to, search, entityType, direction });
      return NextResponse.json(activities, { headers: PRIVATE_HEADERS });
    }

    return NextResponse.json(
      { error: "Invalid type. Must be loan, borrowing, pool, summary, or activity." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load statement.";
    return NextResponse.json({ error: msg }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
