import { NextRequest, NextResponse } from "next/server";
import { database } from "@/infrastructure/database";
import {
  getAgreementStatement,
  getPoolStatement,
  getFinancialPositionSummary,
  getActivityLedger,
} from "@/infrastructure/ledger";
import {
  exportAgreementStatementCsv,
  exportPoolStatementCsv,
  exportSummaryCsv,
  exportActivityCsv,
} from "@/application/reports";
import { validSession, unauthorized, PRIVATE_HEADERS } from "@/infrastructure/auth";

export const runtime = "nodejs";

export async function GET(r: NextRequest) {
  if (!validSession(r)) return unauthorized();
  try {
    const db = database();
    const searchParams = r.nextUrl.searchParams;
    const type = searchParams.get("type");

    let csvContent = "";
    let filename = `aure-ledger-export-${new Date().toISOString().slice(0, 10)}.csv`;

    if (type === "loan") {
      const id = searchParams.get("id");
      if (!id) {
        return NextResponse.json({ error: "Missing loan id parameter." }, { status: 400, headers: PRIVATE_HEADERS });
      }
      const statement = await getAgreementStatement(db, id, "LOAN");
      csvContent = exportAgreementStatementCsv(statement);
      filename = `loan-statement-${statement.counterpartyName.toLowerCase().replace(/\s+/g, "-")}-${statement.agreementId.slice(0, 8)}.csv`;
    } else if (type === "borrowing") {
      const id = searchParams.get("id");
      if (!id) {
        return NextResponse.json({ error: "Missing borrowing id parameter." }, { status: 400, headers: PRIVATE_HEADERS });
      }
      const statement = await getAgreementStatement(db, id, "BORROWING");
      csvContent = exportAgreementStatementCsv(statement);
      filename = `borrowing-statement-${statement.counterpartyName.toLowerCase().replace(/\s+/g, "-")}-${statement.agreementId.slice(0, 8)}.csv`;
    } else if (type === "pool") {
      const pool = await getPoolStatement(db);
      csvContent = exportPoolStatementCsv(pool);
      filename = `capital-pool-statement-${pool.asOfDate}.csv`;
    } else if (type === "summary" || type === "position") {
      const summary = await getFinancialPositionSummary(db);
      csvContent = exportSummaryCsv(summary);
      filename = `financial-position-summary-${summary.asOfDate}.csv`;
    } else if (type === "activity") {
      const from = searchParams.get("from") || undefined;
      const to = searchParams.get("to") || undefined;
      const search = searchParams.get("search") || undefined;
      const entityType = searchParams.get("entityType") || undefined;
      const direction = searchParams.get("direction") || undefined;
      const activities = await getActivityLedger(db, { from, to, search, entityType, direction });
      csvContent = exportActivityCsv(activities);
      filename = `activity-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      return NextResponse.json(
        { error: "Invalid type. Must be loan, borrowing, pool, summary, or activity." },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        ...PRIVATE_HEADERS,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to export CSV.";
    return NextResponse.json({ error: msg }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
