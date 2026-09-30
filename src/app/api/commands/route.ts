import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { database } from "@/infrastructure/database";
import {
  addCapital,
  createPerson,
  PrismaDisbursementGateway,
  PrismaBorrowingGateway,
  PrismaRepaymentGateway,
  PrismaLenderRepaymentGateway,
  PrismaSettlementGateway,
  PrismaReversalGateway,
} from "@/infrastructure/ledger";
import { disburseLoan } from "@/application/disburse";
import { receiveBorrowing } from "@/application/borrow";
import { repayLoan } from "@/application/repay";
import { repayLender } from "@/application/repay-lender";
import { previewSettlement, executeSettlement } from "@/application/settle";
import { reversePayment } from "@/application/reverse";
import { RuleError } from "@/domain/finance";
import { sameOrigin, validSession, unauthorized, PRIVATE_HEADERS } from "@/infrastructure/auth";
export const runtime = "nodejs";
export async function POST(r: NextRequest) {
  if (!sameOrigin(r))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403, headers: PRIVATE_HEADERS },
    );
  if (!validSession(r)) return unauthorized();
  try {
    const raw = await r.text();
    if (raw.length > 10000)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const body = JSON.parse(raw);
    const opType = body.type || body.action;
    const rawInput = body.input || body;
    const input = { ...rawInput, performedBy: "owner" };
    const db = database();
    let result;
    if (opType === "DISBURSE")
      result = await disburseLoan(input, new PrismaDisbursementGateway(db));
    else if (opType === "BORROW")
      result = await receiveBorrowing(input, new PrismaBorrowingGateway(db));
    else if (opType === "REPAY")
      result = await repayLoan(input, new PrismaRepaymentGateway(db));
    else if (opType === "REPAY_LENDER")
      result = await repayLender(input, new PrismaLenderRepaymentGateway(db));
    else if (opType === "PREVIEW_SETTLE")
      result = await previewSettlement(input, new PrismaSettlementGateway(db));
    else if (opType === "SETTLE")
      result = await executeSettlement(input, new PrismaSettlementGateway(db));
    else if (opType === "REVERSE_PAYMENT")
      result = await reversePayment(input, new PrismaReversalGateway(db));
    else if (opType === "CAPITAL") result = await addCapital(input, db);
    else if (opType === "PERSON") result = await createPerson(input, db);
    else
      return NextResponse.json(
        { error: "Unknown operation." },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    return NextResponse.json(result, { headers: PRIVATE_HEADERS });
  } catch (e) {
    if (e instanceof ZodError)
      return NextResponse.json(
        {
          error: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    if (e instanceof RuleError)
      return NextResponse.json({ error: e.message }, { status: 422, headers: PRIVATE_HEADERS });
    if (e instanceof SyntaxError)
      return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: PRIVATE_HEADERS });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003")
      return NextResponse.json(
        {
          error: "The selected person no longer exists. Reload and try again.",
        },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    console.error(
      "Financial command failed",
      e instanceof Error ? e.name : "Unknown error",
    );
    return NextResponse.json(
      {
        error:
          "Unable to confirm this operation. Retry the same submission to check its result safely.",
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
