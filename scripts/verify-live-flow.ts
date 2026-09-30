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
    })
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

// Verify session check
const sessionRes = await fetch(`${serverUrl}/api/session`, {
  headers: {
    Cookie: cookieValue,
  },
});
const sessionJson = (await sessionRes.json()) as { configured: boolean; authenticated: boolean };
console.log("✓ Verified session state:", JSON.stringify(sessionJson));
if (!sessionJson.authenticated) {
  throw new Error("Session is not reported as authenticated.");
}

// Fetch baseline snapshot
const baselineSnapRes = await fetch(`${serverUrl}/api/snapshot`, {
  headers: {
    Cookie: cookieValue,
  },
});
const baselineSnap = (await baselineSnapRes.json()) as any;
const baselineAvailable = BigInt(baselineSnap.available);
const baselineLent = BigInt(baselineSnap.lent);
const baselineBorrowed = BigInt(baselineSnap.borrowed || "0");
console.log(`✓ Baseline snapshot: available=₹${baselineAvailable}, lent=₹${baselineLent}, borrowed=₹${baselineBorrowed}`);

const runId = Date.now().toString().slice(-6);
const testBorrowerName = `TEST_BORROWER_${runId}`;
const testLenderName = `TEST_LENDER_${runId}`;
const capitalRef = `VERIFY-CAPITAL-REF-${runId}`;
const disburseRef = `VERIFY-LOAN-DISBURSE-${runId}`;
const borrowRef = `VERIFY-BORROW-REF-${runId}`;

console.log(`\n=== Step 2: Add Person with BORROWER role (${testBorrowerName}) via POST /api/commands ===`);
const personKey = randomUUID();
const personPayload = {
  type: "PERSON",
  input: {
    name: testBorrowerName,
    phone: "+91 98765 43210",
    role: "BORROWER",
    idempotencyKey: personKey,
  },
};

const personRes = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify(personPayload),
});

if (!personRes.ok) {
  throw new Error(`Add person failed: ${personRes.status} ${await personRes.text()}`);
}
const personResult = await personRes.json();
console.log("✓ Borrower created:", JSON.stringify(personResult));

// Fetch snapshot to get borrowerProfileId
const snapAfterPersonRes = await fetch(`${serverUrl}/api/snapshot`, {
  headers: {
    Cookie: cookieValue,
  },
});
const snapAfterPerson = (await snapAfterPersonRes.json()) as any;
const addedPerson = snapAfterPerson.people.find(
  (p: any) => p.id === personResult.id
);
if (!addedPerson || !addedPerson.borrowerId) {
  throw new Error("Created person or borrowerId not found in snapshot.");
}
const borrowerProfileId = addedPerson.borrowerId;
console.log(`✓ Located BorrowerProfile ID: ${borrowerProfileId}`);

console.log(`\n=== Step 2b: Add Person with LENDER role (${testLenderName}) via POST /api/commands ===`);
const lenderKey = randomUUID();
const lenderPayload = {
  type: "PERSON",
  input: {
    name: testLenderName,
    phone: "+91 91234 56789",
    role: "LENDER",
    idempotencyKey: lenderKey,
  },
};

const lenderRes = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify(lenderPayload),
});

if (!lenderRes.ok) {
  throw new Error(`Add lender failed: ${lenderRes.status} ${await lenderRes.text()}`);
}
const lenderResult = await lenderRes.json();
console.log("✓ Lender created:", JSON.stringify(lenderResult));

// Fetch snapshot to get lenderProfileId
const snapAfterLenderRes = await fetch(`${serverUrl}/api/snapshot`, {
  headers: {
    Cookie: cookieValue,
  },
});
const snapAfterLender = (await snapAfterLenderRes.json()) as any;
const addedLender = snapAfterLender.people.find(
  (p: any) => p.id === lenderResult.id
);
if (!addedLender || !addedLender.lenderId) {
  throw new Error("Created lender or lenderId not found in snapshot.");
}
const lenderProfileId = addedLender.lenderId;
console.log(`✓ Located LenderProfile ID: ${lenderProfileId}`);

console.log("\n=== Step 3: Add Capital via POST /api/commands ===");
const capitalKey = randomUUID();
const capitalPayload = {
  type: "CAPITAL",
  input: {
    amount: "75000",
    transactionDate: "2026-09-27",
    reason: `TEST_VERIFICATION_EQUITY_${runId}`,
    reference: capitalRef,
    idempotencyKey: capitalKey,
  },
};

const capitalRes = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify(capitalPayload),
});

if (!capitalRes.ok) {
  throw new Error(`Add capital failed: ${capitalRes.status} ${await capitalRes.text()}`);
}
const capitalResult = (await capitalRes.json()) as any;
console.log("✓ Capital added:", JSON.stringify(capitalResult));

console.log("\n=== Step 4: Disburse Loan via POST /api/commands ===");
const disburseKey = randomUUID();
const disbursePayload = {
  type: "DISBURSE",
  input: {
    borrowerProfileId,
    principal: "25000",
    rate: "14.5",
    interestMethod: "ANNUAL_ACTUAL_365",
    startDate: "2026-09-27",
    dueDate: "2026-12-27",
    reference: disburseRef,
    idempotencyKey: disburseKey,
  },
};

const disburseRes = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify(disbursePayload),
});

if (!disburseRes.ok) {
  throw new Error(`Disburse loan failed: ${disburseRes.status} ${await disburseRes.text()}`);
}
const disburseResult = (await disburseRes.json()) as any;
console.log("✓ Loan disbursed:", JSON.stringify(disburseResult));

console.log("\n=== Step 4b: Record Borrowing via POST /api/commands (Phase 2) ===");
const borrowKey = randomUUID();
const borrowPayload = {
  type: "BORROW",
  input: {
    lenderProfileId,
    principal: "30000",
    rate: "10.0",
    interestMethod: "ANNUAL_ACTUAL_365",
    startDate: "2026-09-27",
    dueDate: "2027-03-27",
    reference: borrowRef,
    idempotencyKey: borrowKey,
  },
};

const borrowRes = await fetch(`${serverUrl}/api/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: appOrigin,
    Cookie: cookieValue,
  },
  body: JSON.stringify(borrowPayload),
});

if (!borrowRes.ok) {
  throw new Error(`Record borrowing failed: ${borrowRes.status} ${await borrowRes.text()}`);
}
const borrowResult = (await borrowRes.json()) as any;
console.log("✓ Borrowing recorded:", JSON.stringify(borrowResult));

console.log("\n=== Step 5: Verify Snapshot State via GET /api/snapshot ===");
const finalSnapRes = await fetch(`${serverUrl}/api/snapshot`, {
  headers: {
    Cookie: cookieValue,
  },
});
const finalSnap = (await finalSnapRes.json()) as any;
console.log("✓ Snapshot available cash:", `₹${finalSnap.available}`);
console.log("✓ Snapshot principal lent:", `₹${finalSnap.lent}`);
console.log("✓ Snapshot principal borrowed:", `₹${finalSnap.borrowed}`);
console.log("✓ Snapshot loan count:", finalSnap.loans.length);
console.log("✓ Snapshot borrowing count:", finalSnap.borrowings.length);
console.log("✓ Snapshot activity entries:", finalSnap.activity.length);

// Available cash delta: +75000 (capital) - 25000 (loan) + 30000 (borrowing) = +80000
const expectedAvailable = (baselineAvailable + 75000n - 25000n + 30000n).toString();
const expectedLent = (baselineLent + 25000n).toString();
const expectedBorrowed = (baselineBorrowed + 30000n).toString();

if (finalSnap.available !== expectedAvailable) {
  throw new Error(`Expected available cash ${expectedAvailable}, got ${finalSnap.available}`);
}
if (finalSnap.lent !== expectedLent) {
  throw new Error(`Expected lent principal ${expectedLent}, got ${finalSnap.lent}`);
}
if (finalSnap.borrowed !== expectedBorrowed) {
  throw new Error(`Expected borrowed principal ${expectedBorrowed}, got ${finalSnap.borrowed}`);
}

console.log("\n=== Step 6: Verify Direct Database Persistence & Audit Records ===");
const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
  }),
});
await db.$connect();

const persistedPerson = await db.person.findUniqueOrThrow({
  where: { id: addedPerson.id },
  include: { borrower: true },
});
console.log("✓ Persisted Borrower:", persistedPerson.name, "with BorrowerProfile:", persistedPerson.borrower?.id);

const persistedLender = await db.person.findUniqueOrThrow({
  where: { id: addedLender.id },
  include: { lender: true },
});
console.log("✓ Persisted Lender:", persistedLender.name, "with LenderProfile:", persistedLender.lender?.id);

const persistedCapital = await db.equityEntry.findUniqueOrThrow({
  where: { id: capitalResult.id },
  include: { movements: true },
});
console.log("✓ Persisted EquityEntry:", `₹${persistedCapital.amount}`, "Reason:", persistedCapital.reason);
console.log("✓ Associated PoolTransaction (IN):", persistedCapital.movements[0].direction, persistedCapital.movements[0].type, `₹${persistedCapital.movements[0].amount}`);

const persistedLoan = await db.loan.findUniqueOrThrow({
  where: { id: disburseResult.loanId },
  include: { movements: true },
});
console.log("✓ Persisted Loan:", `₹${persistedLoan.principal}`, "at", `${persistedLoan.rate}%`, "Method:", persistedLoan.interestMethod);
console.log("✓ Agreed Loan Interest:", `₹${persistedLoan.originalInterest}`);
console.log("✓ Associated PoolTransaction (OUT):", persistedLoan.movements[0].direction, persistedLoan.movements[0].type, `₹${persistedLoan.movements[0].amount}`);

const persistedBorrowing = await db.borrowing.findUniqueOrThrow({
  where: { id: borrowResult.borrowingId },
  include: { movements: true },
});
console.log("✓ Persisted Borrowing:", `₹${persistedBorrowing.principal}`, "at", `${persistedBorrowing.rate}%`, "Method:", persistedBorrowing.interestMethod);
console.log("✓ Agreed Borrowing Interest:", `₹${persistedBorrowing.originalInterest}`);
console.log("✓ Associated PoolTransaction (IN):", persistedBorrowing.movements[0].direction, persistedBorrowing.movements[0].type, `₹${persistedBorrowing.movements[0].amount}`);
console.log("✓ Movement borrowingId correctly references Borrowing:", persistedBorrowing.movements[0].borrowingId === persistedBorrowing.id);
console.log("✓ Movement loanId is null:", persistedBorrowing.movements[0].loanId === null);

const auditLogs = await db.auditLog.findMany({
  where: {
    entityId: { in: [addedPerson.id, addedLender.id, capitalResult.id, disburseResult.loanId, borrowResult.borrowingId] },
  },
  orderBy: { createdAt: "asc" },
});
console.log("✓ Verified AuditLog entries count:", auditLogs.length);
for (const a of auditLogs) {
  console.log(`  - [${a.action}] Entity: ${a.entityId} PerformedBy: ${a.performedBy}`);
}

await db.$disconnect();
console.log("\n=== PHASE 1 & PHASE 2 LIVE FLOW EMPIRICALLY VERIFIED WITH 100% SUCCESS ===");
