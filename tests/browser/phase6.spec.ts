import "dotenv/config";
import { test, expect, Page } from "@playwright/test";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { disburseLoan } from "../../src/application/disburse";
import { receiveBorrowing } from "../../src/application/borrow";
import { repayLoan } from "../../src/application/repay";
import { repayLender } from "../../src/application/repay-lender";
import {
  addCapital,
  PrismaDisbursementGateway,
  PrismaBorrowingGateway,
  PrismaRepaymentGateway,
  PrismaLenderRepaymentGateway,
} from "../../src/infrastructure/ledger";
import { businessDate } from "../../src/domain/finance";

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://lending:local_password@localhost:5432/lending_test";

let db: PrismaClient;
let borrowerLoanId: string;
let lenderBorrowingId: string;

function shiftDays(baseDateStr: string, days: number): string {
  const [y, m, d] = baseDateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
    }),
  });
  await db.$connect();
});

test.afterAll(async () => {
  if (db) await db.$disconnect();
});

test.beforeEach(async () => {
  if (!new URL(testDbUrl).pathname.endsWith("_test")) {
    throw new Error("Refusing to seed non-test database: " + testDbUrl);
  }

  await db.$executeRawUnsafe(
    'TRUNCATE "PaymentReversal", "SettlementOperation", "PersonOperation", "PoolTransaction", "AuditLog", "InterestAdjustment", "Payment", "Loan", "Borrowing", "EquityEntry", "BorrowerProfile", "LenderProfile", "Person" CASCADE',
  );

  const todayStr = businessDate(new Date());
  const startDateStr = shiftDays(todayStr, -30);
  const dueDateStr = shiftDays(startDateStr, 90);

  // 1. Add pool capital: ₹200,000
  await addCapital(
    {
      amount: "200000",
      transactionDate: startDateStr,
      reason: "Initial browser test capital",
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    db,
  );

  // 2. Create Borrower & Loan (₹10,000, 36.5% over 90 days => ₹900 interest)
  const borrowerPerson = await db.person.create({
    data: {
      name: "Phase6 Borrower",
      phone: "+919876543110",
      borrower: { create: {} },
    },
    include: { borrower: true },
  });

  const loanResult = await disburseLoan(
    {
      borrowerProfileId: borrowerPerson.borrower!.id,
      principal: "10000",
      rate: "36.5",
      interestMethod: "ANNUAL_ACTUAL_365",
      startDate: startDateStr,
      dueDate: dueDateStr,
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    new PrismaDisbursementGateway(db),
  );
  borrowerLoanId = loanResult.loanId;

  // 3. Create Lender & Borrowing (₹15,000, 24.333% over 90 days => ₹900 interest)
  const lenderPerson = await db.person.create({
    data: {
      name: "Phase6 Lender",
      phone: "+919876543111",
      lender: { create: {} },
    },
    include: { lender: true },
  });

  const borrowingResult = await receiveBorrowing(
    {
      lenderProfileId: lenderPerson.lender!.id,
      principal: "15000",
      rate: "24.333",
      interestMethod: "ANNUAL_ACTUAL_365",
      startDate: startDateStr,
      dueDate: dueDateStr,
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    new PrismaBorrowingGateway(db),
  );
  lenderBorrowingId = borrowingResult.borrowingId;

  // 4. Make a repayment on borrower loan: ₹2,000 (day +5)
  await repayLoan(
    {
      loanId: borrowerLoanId,
      amount: "2000",
      paymentDate: shiftDays(startDateStr, 5),
      reference: "REPAY-BORROWER-1",
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    new PrismaRepaymentGateway(db),
  );

  // 5. Make a repayment to lender: ₹3,000 (day +10)
  await repayLender(
    {
      borrowingId: lenderBorrowingId,
      amount: "3000",
      paymentDate: shiftDays(startDateStr, 10),
      reference: "REPAY-LENDER-1",
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    new PrismaLenderRepaymentGateway(db),
  );
});

async function unlockWorkspace(page: Page) {
  await page.goto("/");

  const unlockBtn = page.getByRole("button", { name: "Unlock workspace" });
  const capitalHeading = page.getByText("Available capital").first();

  await Promise.race([
    unlockBtn.waitFor({ state: "visible", timeout: 15000 }),
    capitalHeading.waitFor({ state: "visible", timeout: 15000 }),
  ]);

  if (await unlockBtn.isVisible()) {
    await page.getByLabel("Owner password").fill(process.env.APP_PASSWORD || "");
    await unlockBtn.click();
  }

  await expect(capitalHeading).toBeVisible({ timeout: 15000 });
}

function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    errors.push(err.message);
  });
  return errors;
}

test.describe("Phase 6 Browser Verification", () => {
  test("Activity ledger, filters, position summary and CSV export", async ({
    page,
  }) => {
    const errors = captureErrors(page);
    await unlockWorkspace(page);

    // Navigate to Activity tab
    await page.getByRole("button", { name: "Activity" }).first().click();

    // Verify heading
    await expect(page.getByRole("heading", { name: "Dated Activity Ledger" })).toBeVisible();

    // Verify Financial Position cards
    await expect(page.getByText("Personal Capital Injected")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Principal Lent (Gross)")).toBeVisible();
    await expect(page.getByText("Principal Borrowed (Gross)")).toBeVisible();
    await expect(page.getByText("Borrower Interest Received")).toBeVisible();
    await expect(page.getByText("Lender Interest Paid")).toBeVisible();

    // Verify Activity Table rows exist
    const rows = page.locator(".ledger-table tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(4); // Capital, Disburse, Repay Loan, Borrow, Repay Lender

    // Test Search filter
    const searchInput = page.getByPlaceholder("Search name, ref, notes…");
    await searchInput.fill("REPAY-BORROWER-1");
    await page.waitForTimeout(400); // debounce / effect
    await expect(page.getByText("REPAY-BORROWER-1")).toBeVisible();

    // Test CSV export download event
    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    await page.getByRole("button", { name: "Export Activity CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("activity_ledger_");

    expect(errors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
  });

  test("Reconciliation screen displays healthy status and verified invariants", async ({
    page,
  }) => {
    const errors = captureErrors(page);
    await unlockWorkspace(page);

    // Navigate to Reconciliation tab
    await page.getByRole("button", { name: "Reconciliation" }).first().click();

    // Verify header
    await expect(
      page.getByRole("heading", { name: "Continuous Integrity Audit" }),
    ).toBeVisible();

    // Verify full agreement hero
    await expect(
      page.getByText("Ledger in Full Mathematical Agreement"),
    ).toBeVisible({ timeout: 10000 });

    // Verify metrics cards
    await expect(page.getByText("Audited Pool Balance")).toBeVisible();
    await expect(page.getByText("Audited Repayments")).toBeVisible();
    await expect(page.getByText("Audited Agreements")).toBeVisible();

    // Verify invariant list
    await expect(
      page.getByText("Capital Pool Non-Negative Cumulative Balance"),
    ).toBeVisible();
    await expect(
      page.getByText("Payment Allocation Conservation", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Cash Movement 1-to-1 Linking"),
    ).toBeVisible();

    // Click Run Integrity Audit button
    await page.getByRole("button", { name: "Run Integrity Audit" }).click();
    await expect(
      page.getByText("Ledger in Full Mathematical Agreement"),
    ).toBeVisible({ timeout: 10000 });

    expect(errors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
  });

  test("Statements modal: individual agreement statements and pool statement", async ({
    page,
  }) => {
    const errors = captureErrors(page);
    await unlockWorkspace(page);

    // 1. Check Pool Statement from Overview
    const poolStmtBtn = page.getByRole("button", { name: "View Full Pool Statement" });
    await expect(poolStmtBtn).toBeVisible();
    await poolStmtBtn.click();

    // Verify Pool Statement modal
    await expect(page.getByRole("heading", { name: "Capital Pool Statement" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Derived Available Balance")).toBeVisible();
    await expect(page.getByText("Total Inflows (IN)")).toBeVisible();
    await expect(page.getByText("Total Outflows (OUT)")).toBeVisible();

    // Verify pool statement rows
    const poolRows = page.locator(".statement-table tbody tr");
    await expect(poolRows.first()).toBeVisible();

    // Close dialog
    await page.getByRole("button", { name: "Close dialog" }).click();

    // 2. Check Individual Loan Statement
    await page.getByRole("button", { name: "Loans" }).first().click();
    await page.getByText("Phase6 Borrower").first().click();

    // Drawer opens
    const loanStmtBtn = page.getByRole("button", { name: "Individual Loan Statement" });
    await expect(loanStmtBtn).toBeVisible();
    await loanStmtBtn.click();

    // Verify Loan Statement modal
    await expect(page.getByRole("heading", { name: "Phase6 Borrower Statement" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Original Principal")).toBeVisible();
    await expect(page.getByText("Running Total")).toBeVisible();

    // Close dialog
    await page.getByRole("button", { name: "Close dialog" }).click();

    // 3. Check Individual Borrowing Statement
    await page.getByRole("button", { name: "Borrowings" }).first().click();
    await page.getByText("Phase6 Lender").first().click();

    // Drawer opens
    const borrowingStmtBtn = page.getByRole("button", { name: "Individual Borrowing Statement" });
    await expect(borrowingStmtBtn).toBeVisible();
    await borrowingStmtBtn.click();

    // Verify Borrowing Statement modal
    await expect(page.getByRole("heading", { name: "Phase6 Lender Statement" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Total Payoff")).toBeVisible();

    // Close dialog
    await page.getByRole("button", { name: "Close dialog" }).click();

    expect(errors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
  });

  test("Safe repayment reversal workflow restores balances and updates audit", async ({
    page,
  }) => {
    const errors = captureErrors(page);
    await unlockWorkspace(page);

    // Open Loans tab
    await page.getByRole("button", { name: "Loans" }).first().click();
    await page.getByText("Phase6 Borrower").first().click();

    // Find the Reverse button on the latest payment
    const reverseBtn = page.locator(".reversal-trigger-btn").first();
    await expect(reverseBtn).toBeVisible();
    await reverseBtn.click();

    // Safe Financial Reversal modal opens
    await expect(
      page.getByText("Append-Only Financial Correction"),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reverse Payment · Phase6 Borrower" })).toBeVisible();

    // Fill in required reason
    const reasonInput = page.getByPlaceholder(
      "Required: explain reason for reversal",
      { exact: false },
    );
    await reasonInput.fill("Reversal due to duplicate entry check");

    // Check confirmation checkbox
    await page.getByRole("checkbox").check();

    // Submit reversal
    const confirmBtn = page.getByRole("button", { name: "Confirm & Reverse" });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Toast notice should appear
    await expect(page.getByText("reversed successfully")).toBeVisible({
      timeout: 10000,
    });

    // Re-inspect the loan drawer
    await page.getByText("Phase6 Borrower").first().click();

    // Verify payment shows REVERSED badge and reversal reason
    await expect(page.locator(".badge.overdue").filter({ hasText: "REVERSED" })).toBeVisible();
    await expect(page.getByText("Reversed: Reversal due to duplicate entry check")).toBeVisible();

    // Verify in PostgreSQL database
    const reversals = await db.paymentReversal.findMany();
    expect(reversals).toHaveLength(1);
    expect(reversals[0].reason).toBe("Reversal due to duplicate entry check");

    // Compensating pool movement created
    const compMovement = await db.poolTransaction.findFirst({
      where: { type: "BORROWER_REPAYMENT_REVERSAL_OUT" },
    });
    expect(compMovement).not.toBeNull();
    expect(compMovement?.amount.toString()).toBe("2000");

    expect(errors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
  });
});
