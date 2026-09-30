import { NextRequest, NextResponse } from "next/server";
import { database } from "@/infrastructure/database";
import { snapshot } from "@/infrastructure/ledger";
import { validSession, unauthorized, PRIVATE_HEADERS } from "@/infrastructure/auth";
export const runtime = "nodejs";
export async function GET(r: NextRequest) {
  if (!validSession(r)) return unauthorized();
  try {
    return NextResponse.json(await snapshot(database()), {
      headers: PRIVATE_HEADERS,
    });
  } catch (err) {
    console.error("SNAPSHOT ERROR:", err);
    return NextResponse.json(
      {
        error:
          "The database is unavailable. No financial changes have been made.",
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
