import "dotenv/config";
import { test, expect, Page } from "@playwright/test";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { disburseLoan } from "../../src/application/disburse";
import { receiveBorrowing } from "../../src/application/borrow";
import {
  addCapital,
  PrismaDisbursementGateway,
  PrismaBorrowingGateway,
} from "../../src/infrastructure/ledger";

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://lending:local_password@localhost:5432/lending_test";

let db: PrismaClient;
let borrowerLoanId: string;
let lenderBorrowingId: string;

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
    'TRUNCATE "PersonOperation", "PoolTransaction", "AuditLog", "InterestAdjustment", "Payment", "Loan", "Borrowing", "EquityEntry", "BorrowerProfile", "LenderProfile", "Person" CASCADE',
  );

  // Add pool capital: ₹150,000
  await addCapital(
    {
      amount: "150000",
      transactionDate: "2026-01-01",
      reason: "Initial browser test capital",
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    db,
  );

  // Create Borrower & Loan
  const borrowerPerson = await db.person.create({
    data: {
      name: "Browser Borrower",
      phone: "+919876543210",
      borrower: { create: {} },
    },
    include: { borrower: true },
  });

  const loanResult = await disburseLoan(
    {
      borrowerProfileId: borrowerPerson.borrower!.id,
      principal: "20000",
      rate: "12",
      interestMethod: "ANNUAL_ACTUAL_365",
      startDate: "2026-01-01",
      dueDate: "2026-04-01",
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    new PrismaDisbursementGateway(db),
  );
  borrowerLoanId = loanResult.loanId;

  // Create Lender & Borrowing
  const lenderPerson = await db.person.create({
    data: {
      name: "Browser Lender",
      phone: "+919876543211",
      lender: { create: {} },
    },
    include: { lender: true },
  });

  const borrowingResult = await receiveBorrowing(
    {
      lenderProfileId: lenderPerson.lender!.id,
      principal: "25000",
      rate: "10",
      interestMethod: "ANNUAL_ACTUAL_365",
      startDate: "2026-01-01",
      dueDate: "2026-07-01",
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

test("submits real borrower repayment and verifies persisted results and no hydration errors", async ({
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

  // Click on "Browser Borrower"
  await page.getByRole("button", { name: /Browser Borrower/ }).first().click();

  // Dialog opens showing loan details
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Browser Borrower");
  await expect(dialog).toContainText("Outstanding principal");
  await expect(dialog).toContainText("₹20,000");
  await expect(dialog).toContainText("Outstanding interest");
  await expect(dialog).toContainText("₹592");

  // Click "Record repayment"
  await dialog.getByRole("button", { name: "Record repayment" }).click();
  await expect(dialog).toContainText("LOAN REPAYMENT");

  // Enter payment amount ₹500
  await dialog.getByLabel("Amount (₹)", { exact: true }).fill("500");
  await dialog.getByLabel("Payment date").fill("2026-02-01");
  await dialog
    .getByPlaceholder("Bank UTR or cash receipt")
    .fill("UTR-BROWSER-BORROWER-1");

  // Verify preview
  await expect(dialog).toContainText("Interest: ₹500");
  await expect(dialog).toContainText("Principal: ₹0");

  // Submit repayment
  await dialog.getByRole("button", { name: "Confirm repayment" }).click();

  // Assert confirmation toast
  await expect(page.getByRole("status")).toContainText("Repayment recorded");

  // Verify dialog balances updated
  await expect(dialog).toContainText("Outstanding interest");
  await expect(dialog).toContainText("₹92");
  await expect(dialog).toContainText("Repayment history (1)");
  await expect(dialog).toContainText("UTR-BROWSER-BORROWER-1");

  // Verify persisted result in PostgreSQL lending_test database
  const payment = await db.payment.findFirst({
    where: { loanId: borrowerLoanId, reference: "UTR-BROWSER-BORROWER-1" },
    include: { movements: true },
  });
  expect(payment).not.toBeNull();
  expect(payment!.amount.toFixed(2)).toBe("500.00");
  expect(payment!.fees.toFixed(2)).toBe("0.00");
  expect(payment!.interest.toFixed(2)).toBe("500.00");
  expect(payment!.principal.toFixed(2)).toBe("0.00");
  expect(payment!.movements).toHaveLength(1);
  expect(payment!.movements[0].direction).toBe("IN");
  expect(payment!.movements[0].type).toBe("BORROWER_REPAYMENT_IN");
  expect(payment!.movements[0].amount.toFixed(2)).toBe("500.00");

  // Close dialog
  await dialog.getByRole("button", { name: "Close dialog" }).click();

  // Verify absence of hydration errors
  verifyNoHydrationErrors(errors);
});

test("submits real lender repayment and verifies persisted results and no hydration errors", async ({
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

  // Click on "Browser Lender"
  await page.getByRole("button", { name: /Browser Lender/ }).first().click();

  // Borrowing details dialog opens
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Browser Lender");
  await expect(dialog).toContainText("Outstanding principal");
  await expect(dialog).toContainText("₹25,000");
  await expect(dialog).toContainText("Outstanding interest");
  await expect(dialog).toContainText("₹1,240");

  // Click "Repay lender" button
  await dialog.getByRole("button", { name: "Repay lender" }).click();
  await expect(dialog).toContainText("LENDER REPAYMENT");
  await expect(dialog).toContainText("Record repayment for lender Browser Lender");

  // Enter partial payment ₹2,000
  await dialog.getByLabel("Amount (₹)", { exact: true }).fill("2000");
  await dialog.getByLabel("Payment date").fill("2026-02-01");
  await dialog
    .getByPlaceholder("Bank UTR or cash receipt")
    .fill("UTR-BROWSER-LENDER-1");

  // Verify preview: Interest ₹1,240, Principal ₹760
  await expect(dialog).toContainText("Allocation preview");
  await expect(dialog).toContainText("Interest: ₹1,240");
  await expect(dialog).toContainText("Principal: ₹760");

  // Confirm lender repayment
  await dialog.getByRole("button", { name: "Confirm lender repayment" }).click();

  // Assert confirmation toast
  await expect(page.getByRole("status")).toContainText(
    "Lender repayment recorded",
  );

  // Verify updated dialog metrics
  await expect(dialog).toContainText("Outstanding interest");
  await expect(dialog).toContainText("₹0");
  await expect(dialog).toContainText("Outstanding principal");
  await expect(dialog).toContainText("₹24,240");
  await expect(dialog).toContainText("Repayment history (1)");
  await expect(dialog).toContainText("UTR-BROWSER-LENDER-1");

  // Verify persisted result in PostgreSQL lending_test database
  const payment = await db.payment.findFirst({
    where: {
      borrowingId: lenderBorrowingId,
      reference: "UTR-BROWSER-LENDER-1",
    },
    include: { movements: true },
  });
  expect(payment).not.toBeNull();
  expect(payment!.amount.toFixed(2)).toBe("2000.00");
  expect(payment!.fees.toFixed(2)).toBe("0.00");
  expect(payment!.interest.toFixed(2)).toBe("1240.00");
  expect(payment!.principal.toFixed(2)).toBe("760.00");
  expect(payment!.movements).toHaveLength(1);
  expect(payment!.movements[0].direction).toBe("OUT");
  expect(payment!.movements[0].type).toBe("LENDER_REPAYMENT_OUT");
  expect(payment!.movements[0].amount.toFixed(2)).toBe("2000.00");

  // Verify absence of hydration errors
  verifyNoHydrationErrors(errors);
});

test("submits final lender settlement and verifies CLOSED status in database and UI", async ({
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

  // Click on "Browser Lender"
  await page.getByRole("button", { name: /Browser Lender/ }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Full settlement: total is principal ₹25,000 + interest ₹1,240 = ₹26,240
  await dialog.getByRole("button", { name: "Repay lender" }).click();
  await dialog.getByLabel("Amount (₹)", { exact: true }).fill("26240");
  await dialog.getByLabel("Payment date").fill("2026-02-05");
  await dialog
    .getByPlaceholder("Bank UTR or cash receipt")
    .fill("UTR-BROWSER-LENDER-FINAL");

  // Verify preview: Interest ₹1,240, Principal ₹25,000
  await expect(dialog).toContainText("Interest: ₹1,240");
  await expect(dialog).toContainText("Principal: ₹25,000");

  // Submit final settlement
  await dialog.getByRole("button", { name: "Confirm lender repayment" }).click();

  // Assert status toast
  await expect(page.getByRole("status")).toContainText(
    "Lender repayment recorded",
  );

  // Verify dialog reflects Settled note
  await expect(dialog).toContainText("This borrowing is fully settled");

  // Verify PostgreSQL database reflects status = CLOSED
  const borrowing = await db.borrowing.findUnique({
    where: { id: lenderBorrowingId },
  });
  expect(borrowing?.status).toBe("CLOSED");

  // Close dialog
  await dialog.getByRole("button", { name: "Close dialog" }).click();

  // Verify list also shows Settled badge
  await expect(page.getByText("Settled").first()).toBeVisible();

  // Verify absence of hydration errors
  verifyNoHydrationErrors(errors);
});
