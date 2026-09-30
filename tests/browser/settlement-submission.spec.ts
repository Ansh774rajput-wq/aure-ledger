import "dotenv/config";
import { test, expect, Page } from "@playwright/test";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { disburseLoan } from "../../src/application/disburse";
import { receiveBorrowing } from "../../src/application/borrow";
import { repayLoan } from "../../src/application/repay";
import {
  addCapital,
  PrismaDisbursementGateway,
  PrismaBorrowingGateway,
  PrismaRepaymentGateway,
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
    'TRUNCATE "SettlementOperation", "PersonOperation", "PoolTransaction", "AuditLog", "InterestAdjustment", "Payment", "Loan", "Borrowing", "EquityEntry", "BorrowerProfile", "LenderProfile", "Person" CASCADE',
  );

  const todayStr = businessDate(new Date());
  const startDateStr = shiftDays(todayStr, -40);
  const dueDateStr = shiftDays(startDateStr, 100);

  // Add pool capital: ₹150,000
  await addCapital(
    {
      amount: "150000",
      transactionDate: startDateStr,
      reason: "Initial browser test capital",
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    db,
  );

  // Create Borrower & Loan:
  // Principal: ₹8,000, Rate: 45.625% over 100 days => ₹1,000 agreed interest
  const borrowerPerson = await db.person.create({
    data: {
      name: "Settlement Borrower",
      phone: "+919876543220",
      borrower: { create: {} },
    },
    include: { borrower: true },
  });

  const loanResult = await disburseLoan(
    {
      borrowerProfileId: borrowerPerson.borrower!.id,
      principal: "8000",
      rate: "45.625",
      interestMethod: "ANNUAL_ACTUAL_365",
      startDate: startDateStr,
      dueDate: dueDateStr,
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    new PrismaDisbursementGateway(db),
  );
  borrowerLoanId = loanResult.loanId;

  // Make prior payment of ₹100 on the loan (allocates to interest)
  await repayLoan(
    {
      loanId: borrowerLoanId,
      amount: "100",
      paymentDate: startDateStr,
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    new PrismaRepaymentGateway(db),
  );

  // Create Lender & Borrowing:
  // Principal: ₹10,000, Rate: 36.5% over 100 days => ₹1,000 agreed interest
  const lenderPerson = await db.person.create({
    data: {
      name: "Settlement Lender",
      phone: "+919876543221",
      lender: { create: {} },
    },
    include: { lender: true },
  });

  const borrowingResult = await receiveBorrowing(
    {
      lenderProfileId: lenderPerson.lender!.id,
      principal: "10000",
      rate: "36.5",
      interestMethod: "ANNUAL_ACTUAL_365",
      startDate: startDateStr,
      dueDate: dueDateStr,
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    new PrismaBorrowingGateway(db),
  );
  lenderBorrowingId = borrowingResult.borrowingId;
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

function verifyNoHydrationErrors(errors: string[]) {
  const hydration = errors.filter(
    (e) =>
      e.toLowerCase().includes("hydration") ||
      e.toLowerCase().includes("minified react error") ||
      e.toLowerCase().includes("did not match"),
  );
  expect(hydration).toEqual([]);
}

test("executes borrower loan early settlement with suggested proration and verifies real DB records", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await unlockWorkspace(page);

  // Navigate to Loans tab
  const loansNav = page
    .getByRole("navigation")
    .getByRole("button", { name: /Loans/i })
    .first();
  await loansNav.click();

  // Click on "Settlement Borrower"
  await page.getByRole("button", { name: /Settlement Borrower/ }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Settlement Borrower");
  await expect(dialog).toContainText("₹8,000"); // Outstanding principal

  // Click "Early settlement"
  const earlySettleBtn = dialog.getByRole("button", { name: /Early settlement/i });
  await expect(earlySettleBtn).toBeVisible();
  await earlySettleBtn.click();

  // Dialog heading changes to EARLY SETTLEMENT REVIEW
  await expect(dialog).toContainText("EARLY SETTLEMENT REVIEW");
  await expect(dialog).toContainText("Early settlement · Settlement Borrower");

  // Verify server calculation values:
  // 40 of 100 elapsed actual days
  await expect(dialog).toContainText("40 of 100 elapsed actual days");
  await expect(dialog).toContainText("Original agreed interest");
  await expect(dialog).toContainText("₹1,000");
  await expect(dialog).toContainText("Interest already paid");
  await expect(dialog).toContainText("₹100");
  await expect(dialog).toContainText("Suggested total interest");
  await expect(dialog).toContainText("₹400");

  // Cash direction: Cash Inflow
  await expect(dialog).toContainText("Cash Inflow · Receipt from borrower");

  // Exact settlement payoff: ₹8,300 (8000 principal + 400 suggested total - 100 paid)
  await expect(dialog).toContainText("Exact settlement payoff");
  await expect(dialog).toContainText("₹8,300");

  // Signed adjustment: −₹600
  await expect(dialog).toContainText("−₹600");

  // Enter explanatory reason
  await dialog
    .getByPlaceholder(/explain reason for early settlement/i)
    .fill("Owner approved early closure on day 40 with prorated interest ₹400");

  // Confirm terms
  await dialog
    .getByLabel(/I confirm the early settlement terms/i)
    .check();

  // Submit settlement
  const confirmBtn = dialog.getByRole("button", {
    name: "Confirm & settle agreement",
  });
  await expect(confirmBtn).toBeEnabled();
  await confirmBtn.click();

  // Toast confirmation
  await expect(page.getByRole("status")).toContainText(
    "Loan settled early and closed!",
  );

  // Assert in real PostgreSQL lending_test
  const loanInDb = await db.loan.findUniqueOrThrow({
    where: { id: borrowerLoanId },
    include: {
      adjustments: true,
      payments: true,
      settlements: true,
    },
  });

  expect(loanInDb.status).toBe("CLOSED");
  expect(loanInDb.principal.toFixed(0)).toBe("8000"); // Original terms immutable
  expect(loanInDb.originalInterest.toFixed(0)).toBe("1000"); // Original terms immutable

  // Signed adjustment recorded: -600
  expect(loanInDb.adjustments.length).toBe(1);
  expect(loanInDb.adjustments[0].amount.toFixed(0)).toBe("-600");
  expect(loanInDb.adjustments[0].performedBy).toBe("owner");
  expect(loanInDb.adjustments[0].reason).toContain("Owner approved early closure");

  // Final payment: ₹8,300 (₹300 interest, ₹8,000 principal)
  expect(loanInDb.payments.length).toBe(2); // 1 prior + 1 settlement
  const settlePayment = loanInDb.payments.find((p) => p.amount.toFixed(0) === "8300");
  expect(settlePayment).toBeDefined();
  expect(settlePayment!.interest.toFixed(0)).toBe("300");
  expect(settlePayment!.principal.toFixed(0)).toBe("8000");

  // Settlement operation recorded
  expect(loanInDb.settlements.length).toBe(1);
  expect(loanInDb.settlements[0].finalTotalInterest.toFixed(0)).toBe("400");
  expect(loanInDb.settlements[0].adjustmentDelta.toFixed(0)).toBe("-600");
  expect(loanInDb.settlements[0].payoffAmount.toFixed(0)).toBe("8300");

  // Pool cash movement
  const poolTx = await db.poolTransaction.findFirst({
    where: {
      loanId: borrowerLoanId,
      paymentId: settlePayment!.id,
      type: "BORROWER_REPAYMENT_IN",
    },
  });
  expect(poolTx).not.toBeNull();
  expect(poolTx!.amount.toFixed(0)).toBe("8300");

  // Verify Audit Log
  const audit = await db.auditLog.findFirst({
    where: {
      action: "LOAN_EARLY_SETTLED",
      entityId: borrowerLoanId,
    },
  });
  expect(audit).not.toBeNull();

  verifyNoHydrationErrors(errors);
});

test("executes lender borrowing early settlement with manual owner decision and verifies DB records", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await unlockWorkspace(page);

  // Navigate to Borrowings tab
  const borrowingsNav = page
    .getByRole("navigation")
    .getByRole("button", { name: /Borrowings/i })
    .first();
  await borrowingsNav.click();

  // Click on "Settlement Lender"
  await page.getByRole("button", { name: /Settlement Lender/ }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Settlement Lender");
  await expect(dialog).toContainText("₹10,000"); // Outstanding principal

  // Click "Early settlement"
  const earlySettleBtn = dialog.getByRole("button", { name: /Early settlement/i });
  await expect(earlySettleBtn).toBeVisible();
  await earlySettleBtn.click();

  await expect(dialog).toContainText("EARLY SETTLEMENT REVIEW");
  await expect(dialog).toContainText("Early settlement · Settlement Lender");

  // Cash direction: Cash Outflow · Payment to lender
  await expect(dialog).toContainText("Cash Outflow · Payment to lender");

  // Select MANUAL decision
  await dialog
    .getByRole("radio", { name: /Enter manual final total interest/i })
    .click();

  // Enter manual interest: ₹500
  await dialog.getByLabel("Manual final total interest (₹)").fill("500");

  // Verify signed adjustment: −₹500 and payoff: ₹10,500
  await expect(dialog).toContainText("−₹500");
  await expect(dialog).toContainText("₹10,500");

  // Enter reason
  await dialog
    .getByPlaceholder(/explain reason for early settlement/i)
    .fill("Manual owner decision: agreed flat ₹500 interest for early repayment");

  // Confirm terms
  await dialog
    .getByLabel(/I confirm the early settlement terms/i)
    .check();

  // Submit settlement
  const confirmBtn = dialog.getByRole("button", {
    name: "Confirm & settle agreement",
  });
  await expect(confirmBtn).toBeEnabled();
  await confirmBtn.click();

  await expect(page.getByRole("status")).toContainText(
    "Borrowing settled early and closed!",
  );

  // Assert in real PostgreSQL
  const borrowingInDb = await db.borrowing.findUniqueOrThrow({
    where: { id: lenderBorrowingId },
    include: {
      adjustments: true,
      payments: true,
      settlements: true,
    },
  });

  expect(borrowingInDb.status).toBe("CLOSED");
  expect(borrowingInDb.principal.toFixed(0)).toBe("10000"); // Original terms immutable
  expect(borrowingInDb.originalInterest.toFixed(0)).toBe("1000"); // Original terms immutable
  expect(borrowingInDb.adjustments.length).toBe(1);
  expect(borrowingInDb.adjustments[0].amount.toFixed(0)).toBe("-500");
  expect(borrowingInDb.payments.length).toBe(1);
  expect(borrowingInDb.payments[0].amount.toFixed(0)).toBe("10500");
  expect(borrowingInDb.settlements.length).toBe(1);
  expect(borrowingInDb.settlements[0].finalTotalInterest.toFixed(0)).toBe("500");

  // Verify pool debited ₹10,500
  const poolTx = await db.poolTransaction.findFirst({
    where: {
      borrowingId: lenderBorrowingId,
      type: "LENDER_REPAYMENT_OUT",
    },
  });
  expect(poolTx).not.toBeNull();
  expect(poolTx!.amount.toFixed(0)).toBe("10500");

  verifyNoHydrationErrors(errors);
});

test("displays interest adjustment history and settled badge after early settlement", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await unlockWorkspace(page);

  // Settle the borrower loan first
  const loansNav = page
    .getByRole("navigation")
    .getByRole("button", { name: /Loans/i })
    .first();
  await loansNav.click();

  await page.getByRole("button", { name: /Settlement Borrower/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Early settlement/i }).click();

  await dialog
    .getByPlaceholder(/explain reason for early settlement/i)
    .fill("Owner closing loan early");
  await dialog.getByLabel(/I confirm the early settlement terms/i).check();
  await dialog.getByRole("button", { name: "Confirm & settle agreement" }).click();

  await expect(page.getByRole("status")).toContainText("Loan settled early and closed!");

  // Verify dialog immediately transitions to settled details
  await expect(dialog).toContainText("Settled");
  await expect(dialog).toContainText("This loan is fully settled. All contractual obligations have been fulfilled.");

  // Verify Interest adjustments section
  await expect(dialog).toContainText("Interest adjustments (1)");
  await expect(dialog).toContainText("−₹600");
  await expect(dialog).toContainText("Discount");
  await expect(dialog).toContainText("Owner closing loan early");
  await expect(dialog).toContainText("by owner");

  // Verify original terms remain visible and unchanged
  await expect(dialog).toContainText("Original principal");
  await expect(dialog).toContainText("₹8,000");
  await expect(dialog).toContainText("Original agreed interest");
  await expect(dialog).toContainText("₹1,000");

  // Verify action buttons are hidden
  await expect(dialog.getByRole("button", { name: "Record repayment" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Early settlement" })).toHaveCount(0);

  // Close dialog, filter by Settled, and re-open to verify persistence
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).not.toBeVisible();

  await page.getByLabel("Filter loans").selectOption("Settled");
  await page.getByRole("button", { name: /Settlement Borrower/ }).first().click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Settled");
  await expect(dialog).toContainText("Interest adjustments (1)");

  verifyNoHydrationErrors(errors);
});
