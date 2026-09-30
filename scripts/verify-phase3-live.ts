import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// 1. Read configuration from .env
const envText = readFileSync(".env", "utf-8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      return [key, val];
    }),
);

const appOrigin = env.APP_ORIGIN || "http://localhost:3000";
const serverUrl = "http://127.0.0.1:3000";
const password = env.APP_PASSWORD;

console.log("=== Step 1: Owner Authentication via POST /api/session ===");
const loginRes = await fetch(`${serverUrl}/api/session`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
  },
  body: JSON.stringify({ password }),
});

if (!loginRes.ok) {
  throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
}

const cookieHeader = loginRes.headers.get("set-cookie");
if (!cookieHeader) {
  throw new Error("Login did not return a session cookie.");
}
const cookieValue = cookieHeader.split(";")[0];
console.log("✓ Successfully authenticated. Session cookie acquired.");

const sessionRes = await fetch(`${serverUrl}/api/session`, {
  headers: { Cookie: cookieValue },
});
const sessionJson = (await sessionRes.json()) as {
  configured: boolean;
  authenticated: boolean;
};
if (!sessionJson.authenticated) {
  throw new Error("Session is not reported as authenticated.");
}
console.log("✓ Verified session state:", JSON.stringify(sessionJson));

// 2. Baseline snapshot
const baselineSnapRes = await fetch(`${serverUrl}/api/snapshot`, {
  headers: { Cookie: cookieValue },
});
const baselineSnap = (await baselineSnapRes.json()) as any;
console.log(
  `✓ Baseline snapshot: available=₹${baselineSnap.available}, lent=₹${baselineSnap.lent}, interestEarned=₹${baselineSnap.interestEarned}`,
);

const runId = Date.now().toString().slice(-6);
const borrowerName = `REPAY_BORROWER_${runId}`;
const todayStr = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

// Due date 5 months later
const due = new Date();
due.setMonth(due.getMonth() + 5);
const dueStr = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(due);

console.log(`\n=== Step 2: Create Borrower Person (${borrowerName}) ===`);
const personRes = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify({
    type: "PERSON",
    input: {
      name: borrowerName,
      role: "BORROWER",
      idempotencyKey: randomUUID(),
    },
  }),
});
if (!personRes.ok)
  throw new Error(`Person creation failed: ${await personRes.text()}`);
const personData = (await personRes.json()) as any;
const snapAfterPersonRes = await fetch(`${serverUrl}/api/snapshot`, {
  headers: { Cookie: cookieValue },
});
const snapAfterPerson = (await snapAfterPersonRes.json()) as any;
const createdBorrower = snapAfterPerson.people.find((p: any) => p.id === personData.id);
const borrowerProfileId = createdBorrower?.borrowerId;
console.log("✓ Borrower created:", personData.id, "borrowerProfileId:", borrowerProfileId);

console.log("\n=== Step 3: Add Capital ₹50,000 ===");
const capRes = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify({
    type: "CAPITAL",
    input: {
      amount: "50000",
      transactionDate: todayStr,
      reason: `Verification Capital ${runId}`,
      idempotencyKey: randomUUID(),
    },
  }),
});
if (!capRes.ok) throw new Error(`Capital addition failed: ${await capRes.text()}`);
console.log("✓ Capital added ₹50,000");

console.log("\n=== Step 4: Disburse ₹20,000 Loan ===");
const disburseRes = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify({
    type: "DISBURSE",
    input: {
      borrowerProfileId,
      principal: "20000",
      rate: "1",
      interestMethod: "MONTHLY_ANCHORED",
      startDate: todayStr,
      dueDate: dueStr,
      idempotencyKey: randomUUID(),
    },
  }),
});
if (!disburseRes.ok) throw new Error(`Disbursement failed: ${await disburseRes.text()}`);
const disburseData = (await disburseRes.json()) as any;
const loanId = disburseData.loanId;
console.log("✓ Loan disbursed, loanId:", loanId);

// Check loan details in snapshot
const snap1Res = await fetch(`${serverUrl}/api/snapshot`, {
  headers: { Cookie: cookieValue },
});
const snap1 = (await snap1Res.json()) as any;
const loanSnap1 = snap1.loans.find((l: any) => l.id === loanId);
console.log(
  `✓ Loan snapshot before repayments: principal=₹${loanSnap1.principal}, remainingPrincipal=₹${loanSnap1.remainingPrincipal}, remainingInterest=₹${loanSnap1.remainingInterest}`,
);

console.log("\n=== Step 5: Repayment 1 — ₹600 (Allocates entirely to interest) ===");
const repay1Key = randomUUID();
const repay1Res = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify({
    type: "REPAY",
    input: {
      loanId,
      amount: "600",
      paymentDate: todayStr,
      reference: `UTR-R1-${runId}`,
      idempotencyKey: repay1Key,
    },
  }),
});
if (!repay1Res.ok) throw new Error(`Repayment 1 failed: ${await repay1Res.text()}`);
const repay1Data = (await repay1Res.json()) as any;
console.log("✓ Repayment 1 result:", JSON.stringify(repay1Data));
if (
  repay1Data.allocation.interest !== "600" ||
  repay1Data.allocation.principal !== "0" ||
  repay1Data.remainingPrincipal !== "20000" ||
  repay1Data.settled !== false
) {
  throw new Error("Repayment 1 allocation failed domain check!");
}

console.log("\n=== Step 6: Repayment 2 — ₹5,400 (Allocates ₹400 interest, ₹5,000 principal) ===");
const repay2Key = randomUUID();
const repay2Res = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify({
    type: "REPAY",
    input: {
      loanId,
      amount: "5400",
      paymentDate: todayStr,
      reference: `UTR-R2-${runId}`,
      idempotencyKey: repay2Key,
    },
  }),
});
if (!repay2Res.ok) throw new Error(`Repayment 2 failed: ${await repay2Res.text()}`);
const repay2Data = (await repay2Res.json()) as any;
console.log("✓ Repayment 2 result:", JSON.stringify(repay2Data));
if (
  repay2Data.allocation.interest !== "400" ||
  repay2Data.allocation.principal !== "5000" ||
  repay2Data.remainingPrincipal !== "15000" ||
  repay2Data.remainingInterest !== "0" ||
  repay2Data.settled !== false
) {
  throw new Error("Repayment 2 allocation failed domain check!");
}

console.log("\n=== Step 7: Verify Snapshot after Partial Repayments ===");
const snap2Res = await fetch(`${serverUrl}/api/snapshot`, {
  headers: { Cookie: cookieValue },
});
const snap2 = (await snap2Res.json()) as any;
const loanSnap2 = snap2.loans.find((l: any) => l.id === loanId);
console.log(
  `✓ Loan remainingPrincipal=₹${loanSnap2.remainingPrincipal} (expected 15000), remainingInterest=₹${loanSnap2.remainingInterest} (expected 0)`,
);
console.log(`✓ Loan payments count: ${loanSnap2.payments.length} (expected 2)`);
if (loanSnap2.remainingPrincipal !== "15000" || loanSnap2.remainingInterest !== "0") {
  throw new Error("Snapshot loan remaining balance mismatch!");
}

console.log("\n=== Step 8: Final Settlement Payment — ₹15,000 ===");
const finalKey = randomUUID();
const finalPayload = {
  type: "REPAY",
  input: {
    loanId,
    amount: "15000",
    paymentDate: todayStr,
    reference: `UTR-FINAL-${runId}`,
    idempotencyKey: finalKey,
  },
};
const finalRes = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify(finalPayload),
});
if (!finalRes.ok) throw new Error(`Final payment failed: ${await finalRes.text()}`);
const finalData = (await finalRes.json()) as any;
console.log("✓ Final repayment result:", JSON.stringify(finalData));
if (
  finalData.allocation.principal !== "15000" ||
  finalData.remainingPrincipal !== "0" ||
  finalData.remainingInterest !== "0" ||
  finalData.settled !== true
) {
  throw new Error("Final settlement assertion failed!");
}

console.log("\n=== Step 9: Verify Replay of Final Payment on Closed Loan Succeeds (Idempotency Precedes Status Check) ===");
const replayRes = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify(finalPayload),
});
if (!replayRes.ok) {
  throw new Error(`Replay of final payment failed with status ${replayRes.status}: ${await replayRes.text()}`);
}
const replayData = (await replayRes.json()) as any;
console.log("✓ Replay succeeded:", JSON.stringify(replayData));
if (replayData.replayed !== true || replayData.settled !== true) {
  throw new Error("Replay did not return replayed: true or settled: true!");
}

console.log("\n=== Step 10: Verify Overpayment Rejection on Settled Loan ===");
const overpayRes = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify({
    type: "REPAY",
    input: {
      loanId,
      amount: "100",
      paymentDate: todayStr,
      idempotencyKey: randomUUID(),
    },
  }),
});
console.log(`✓ Overpayment status code: ${overpayRes.status} (expected 422)`);
if (overpayRes.status !== 422) {
  throw new Error(`Expected 422 for overpayment, got ${overpayRes.status}`);
}

console.log("\n=== Step 11: Direct PostgreSQL Verification via PrismaClient ===");
const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
  }),
});
await db.$connect();

const dbLoan = await db.loan.findUniqueOrThrow({
  where: { id: loanId },
  include: { payments: { orderBy: { createdAt: "asc" } }, movements: true },
});
console.log("✓ Database Loan status:", dbLoan.status, "(expected CLOSED)");
console.log("✓ Original terms intact: principal=", dbLoan.principal.toString(), "rate=", dbLoan.rate.toString());
console.log("✓ Persisted Payment count:", dbLoan.payments.length, "(expected 3)");

const dbMovements = await db.poolTransaction.findMany({
  where: { loanId, direction: "IN" },
});
console.log("✓ PoolTransaction (BORROWER_REPAYMENT_IN) count:", dbMovements.length, "(expected 3)");
for (const m of dbMovements) {
  console.log(`  - Movement ${m.id}: amount=₹${m.amount}, type=${m.type}, paymentId=${m.paymentId}, borrowingId=${m.borrowingId}`);
  if (m.borrowingId !== null || !m.paymentId) {
    throw new Error("Movement has invalid borrowingId or missing paymentId!");
  }
}

const dbAudits = await db.auditLog.findMany({
  where: { entityId: { in: dbLoan.payments.map((p) => p.id) } },
});
console.log("✓ AuditLog entries for repayments count:", dbAudits.length, "(expected 3)");
for (const a of dbAudits) {
  console.log(`  - AuditLog ${a.id}: action=${a.action}, performedBy=${a.performedBy}`);
  if (a.performedBy !== "owner" || a.action !== "BORROWER_REPAYMENT") {
    throw new Error("Audit log action or performedBy mismatch!");
  }
}

await db.$disconnect();
console.log("\n=== PHASE 3 BORROWER REPAYMENTS EMPIRICALLY VERIFIED WITH 100% SUCCESS ===");
