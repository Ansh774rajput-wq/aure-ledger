import "dotenv/config";
import { test, expect, Page } from "@playwright/test";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { disburseLoan } from "../../src/application/disburse";
import { repayLoan } from "../../src/application/repay";
import {
  addCapital,
  PrismaDisbursementGateway,
  PrismaRepaymentGateway,
} from "../../src/infrastructure/ledger";

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://lending:local_password@localhost:5432/lending_test";

let db: PrismaClient;
let borrowerLoanId: string;
let borrowerPersonId: string;

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

  // Add pool capital: ₹200,000
  await addCapital(
    {
      amount: "200000",
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
      name: "Phase 7 Offline Borrower",
      borrower: { create: {} },
    },
    include: { borrower: true },
  });
  borrowerPersonId = borrowerPerson.id;

  const now = new Date();
  const startDateStr = "2026-01-01";
  const dueDate = new Date(now.getTime() + 60 * 86400000);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  const loanResult = await disburseLoan(
    {
      borrowerProfileId: borrowerPerson.borrower!.id,
      principal: "20000",
      rate: "12",
      interestMethod: "ANNUAL_ACTUAL_365",
      startDate: startDateStr,
      dueDate: dueDateStr,
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    new PrismaDisbursementGateway(db),
  );
  borrowerLoanId = loanResult.loanId;
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

test.describe("Phase 7: Offline and Uncertain Submissions Verification", () => {
  test("offline financial submissions are blocked without queuing writes", async ({
    page,
    context,
  }) => {
    await unlockWorkspace(page);

    // Navigate to Loans tab
    const loansNav = page
      .getByRole("navigation")
      .getByRole("button", { name: /Loans/i })
      .first();
    await loansNav.click();

    // Click on Borrower
    await page.getByRole("button", { name: /Phase 7 Offline Borrower/ }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Open Repayment inside drawer
    await dialog.getByRole("button", { name: "Record repayment" }).click();
    await expect(dialog).toContainText("LOAN REPAYMENT");

    // Enter repayment amount
    await dialog.getByLabel("Amount (₹)", { exact: true }).fill("1000");

    // Simulate going OFFLINE
    await context.setOffline(true);

    let networkCommandAttempted = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/commands")) {
        networkCommandAttempted = true;
      }
    });

    // Attempt to submit while offline
    await dialog.getByRole("button", { name: "Confirm repayment" }).click();

    // Verify offline error is displayed immediately
    const errorAlert = dialog.locator(".message.error");
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText("You are offline. A live connection is required");

    // Verify no network command was fired
    expect(networkCommandAttempted).toBe(false);

    // Verify database has 0 payments recorded
    const paymentsCount = await db.payment.count();
    expect(paymentsCount).toBe(0);

    // Verify no write was queued in browser storage
    const storageAudit = await page.evaluate(async () => {
      return {
        localStorageKeys: Object.keys(localStorage),
        sessionStorageKeys: Object.keys(sessionStorage),
      };
    });
    expect(storageAudit.localStorageKeys.some((k) => k.includes("queue") || k.includes("pending"))).toBe(false);

    // Restore online
    await context.setOffline(false);
  });

  test("when server commits repayment but response is lost, retry reuses idempotency key and creates no duplicate", async ({
    page,
  }) => {
    await unlockWorkspace(page);

    const loansNav = page
      .getByRole("navigation")
      .getByRole("button", { name: /Loans/i })
      .first();
    await loansNav.click();

    await page.getByRole("button", { name: /Phase 7 Offline Borrower/ }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Record repayment" }).click();
    await expect(dialog).toContainText("LOAN REPAYMENT");

    await dialog.getByLabel("Amount (₹)", { exact: true }).fill("2000");

    let callCount = 0;
    let firstIdempotencyKey = "";
    let secondIdempotencyKey = "";

    await page.route("**/api/commands", async (route) => {
      const postData = route.request().postDataJSON();
      if (postData?.type === "REPAY") {
        callCount++;
        if (callCount === 1) {
          firstIdempotencyKey = postData.input.idempotencyKey;
          // Forward to real server to commit into PostgreSQL
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          // Drop connection after commit
          await route.abort("failed");
          return;
        } else if (callCount === 2) {
          secondIdempotencyKey = postData.input.idempotencyKey;
          await route.continue();
          return;
        }
      }
      await route.continue();
    });

    // First submission: server commits, but response dropped
    await dialog.getByRole("button", { name: "Confirm repayment" }).click();

    // Verify uncertain state
    const uncertainNote = dialog.locator(".info-note");
    await expect(uncertainNote).toBeVisible({ timeout: 10000 });
    await expect(uncertainNote).toContainText("The result is unconfirmed");

    const retryBtn = dialog.getByRole("button", { name: "Check the same submission" });
    await expect(retryBtn).toBeVisible();

    // Verify amount input is disabled during uncertainty
    await expect(dialog.getByLabel("Amount (₹)", { exact: true })).toBeDisabled();

    // Retry the submission
    await retryBtn.click();

    // Toast appears
    await expect(page.getByText("Repayment recorded")).toBeVisible({ timeout: 10000 });

    // Verify both calls used identical idempotency key
    expect(callCount).toBe(2);
    expect(firstIdempotencyKey).toBeTruthy();
    expect(secondIdempotencyKey).toBe(firstIdempotencyKey);

    // Verify in PostgreSQL: exactly 1 payment and 1 pool transaction exist
    const payments = await db.payment.findMany({ where: { loanId: borrowerLoanId } });
    expect(payments).toHaveLength(1);
    expect(payments[0].idempotencyKey).toBe(firstIdempotencyKey);

    const poolTxs = await db.poolTransaction.findMany({
      where: { loanId: borrowerLoanId, type: "BORROWER_REPAYMENT_IN" },
    });
    expect(poolTxs).toHaveLength(1);
  });

  test("when server commits early settlement but response is lost, retry reuses idempotency key and creates no duplicate", async ({
    page,
  }) => {
    await unlockWorkspace(page);

    // Open Loans tab
    const loansNav = page
      .getByRole("navigation")
      .getByRole("button", { name: /Loans/i })
      .first();
    await loansNav.click();

    await page.getByRole("button", { name: /Phase 7 Offline Borrower/ }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Click Settle Early button
    const earlySettleBtn = dialog.getByRole("button", { name: /Early settlement/i });
    await expect(earlySettleBtn).toBeVisible();
    await earlySettleBtn.click();
    await expect(dialog).toContainText("EARLY SETTLEMENT REVIEW");

    // Fill mandatory reason and confirm terms
    await dialog.getByPlaceholder(/explain reason for early settlement/i).fill("Early settlement full payoff");
    await dialog.getByLabel(/I confirm the early settlement terms/i).check();

    let settleCalls = 0;
    let firstSettleKey = "";
    let secondSettleKey = "";

    await page.route("**/api/commands", async (route) => {
      const postData = route.request().postDataJSON();
      if (postData?.type === "SETTLE") {
        settleCalls++;
        if (settleCalls === 1) {
          firstSettleKey = postData.input.idempotencyKey;
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          await route.abort("failed");
          return;
        } else if (settleCalls === 2) {
          secondSettleKey = postData.input.idempotencyKey;
          await route.continue();
          return;
        }
      }
      await route.continue();
    });

    // First attempt: commits on server, connection lost before response
    await dialog.getByRole("button", { name: "Confirm & settle agreement" }).click();

    // Verify uncertain state
    const uncertainNote = dialog.locator(".info-note");
    await expect(uncertainNote).toBeVisible({ timeout: 10000 });
    await expect(uncertainNote).toContainText("The result is unconfirmed");

    const retryBtn = dialog.getByRole("button", { name: "Check the same submission" });
    await expect(retryBtn).toBeVisible();

    // Click retry
    await retryBtn.click();

    // Modal closes and success toast appears
    await expect(page.getByText("settled early and closed")).toBeVisible({ timeout: 10000 });

    // Verify identical key was reused
    expect(settleCalls).toBe(2);
    expect(firstSettleKey).toBeTruthy();
    expect(secondSettleKey).toBe(firstSettleKey);

    // Verify in PostgreSQL: exactly 1 SettlementOperation and 1 InterestAdjustment
    const settlements = await db.settlementOperation.findMany({ where: { loanId: borrowerLoanId } });
    expect(settlements).toHaveLength(1);
    expect(settlements[0].idempotencyKey).toBe(firstSettleKey);

    const adjustments = await db.interestAdjustment.findMany({ where: { loanId: borrowerLoanId } });
    expect(adjustments).toHaveLength(1);

    const loan = await db.loan.findUnique({ where: { id: borrowerLoanId } });
    expect(loan?.status).toBe("CLOSED");
  });

  test("when server commits reversal but response is lost, retry reuses idempotency key and creates no duplicate", async ({
    page,
  }) => {
    // Make 1 payment on the loan first so there is a payment to reverse
    const payResult = await repayLoan(
      {
        loanId: borrowerLoanId,
        amount: "2000",
        paymentDate: "2026-01-10",
        performedBy: "browser-test",
        idempotencyKey: randomUUID(),
      },
      new PrismaRepaymentGateway(db),
    );

    await unlockWorkspace(page);

    // Open Loans tab and inspect the loan
    const loansNav = page
      .getByRole("navigation")
      .getByRole("button", { name: /Loans/i })
      .first();
    await loansNav.click();

    await page.getByRole("button", { name: /Phase 7 Offline Borrower/ }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Click Reverse on payment
    const reverseBtn = dialog.locator(".reversal-trigger-btn").first();
    await expect(reverseBtn).toBeVisible();
    await reverseBtn.click();

    // Reversal modal opens
    await expect(page.getByText("Append-Only Financial Correction")).toBeVisible();

    // Fill reason and confirm
    await dialog.getByPlaceholder("Required: explain reason for reversal").fill("Test lost response reversal retry");
    await dialog.getByRole("checkbox").check();

    let revCalls = 0;
    let firstRevKey = "";
    let secondRevKey = "";

    await page.route("**/api/commands", async (route) => {
      const postData = route.request().postDataJSON();
      if (postData?.type === "REVERSE_PAYMENT") {
        revCalls++;
        if (revCalls === 1) {
          firstRevKey = postData.input.idempotencyKey;
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          await route.abort("failed");
          return;
        } else if (revCalls === 2) {
          secondRevKey = postData.input.idempotencyKey;
          await route.continue();
          return;
        }
      }
      await route.continue();
    });

    // Submit reversal: commits on server, connection lost
    await dialog.getByRole("button", { name: "Confirm & Reverse" }).click();

    // Verify uncertain state
    const uncertainNote = dialog.locator(".info-note");
    await expect(uncertainNote).toBeVisible({ timeout: 10000 });
    await expect(uncertainNote).toContainText("The result is unconfirmed due to a network interruption");

    const retryBtn = dialog.getByRole("button", { name: "Retry Reversal" });
    await expect(retryBtn).toBeVisible();

    // Verify inputs disabled during uncertainty
    await expect(dialog.getByPlaceholder("Required: explain reason for reversal")).toBeDisabled();
    await expect(dialog.getByRole("checkbox")).toBeDisabled();

    // Click retry
    await retryBtn.click();

    // Modal closes and success toast appears
    await expect(page.getByText("reversed successfully")).toBeVisible({ timeout: 10000 });

    // Verify identical key reused
    expect(revCalls).toBe(2);
    expect(firstRevKey).toBeTruthy();
    expect(secondRevKey).toBe(firstRevKey);

    // Verify in PostgreSQL: exactly 1 PaymentReversal and 1 compensating PoolTransaction
    const reversals = await db.paymentReversal.findMany({ where: { paymentId: payResult.paymentId } });
    expect(reversals).toHaveLength(1);
    expect(reversals[0].idempotencyKey).toBe(firstRevKey);

    const compTxs = await db.poolTransaction.findMany({ where: { paymentReversalId: reversals[0].id } });
    expect(compTxs).toHaveLength(1);
  });

  test("private financial responses never enter service-worker caches", async ({
    page,
  }) => {
    await unlockWorkspace(page);

    await page.getByRole("button", { name: "Activity" }).first().click();
    await page.getByRole("button", { name: "Reconciliation" }).first().click();
    await page.getByRole("button", { name: /Overview|Home/ }).first().click();

    // Inspect all browser Cache Storage entries
    const cacheAudit = await page.evaluate(async () => {
      const cacheNames = await window.caches.keys();
      const entries: { cacheName: string; urls: string[] }[] = [];
      for (const name of cacheNames) {
        const cache = await window.caches.open(name);
        const requests = await cache.keys();
        entries.push({
          cacheName: name,
          urls: requests.map((r) => r.url),
        });
      }
      return entries;
    });

    for (const cache of cacheAudit) {
      for (const cachedUrl of cache.urls) {
        // Assert: NO endpoint matching /api/ is in cache
        expect(cachedUrl).not.toContain("/api/");
        expect(cachedUrl).not.toContain("/snapshot");
        expect(cachedUrl).not.toContain("/statements");
        expect(cachedUrl).not.toContain("/commands");
        expect(cachedUrl).not.toContain("/reconciliation");
        expect(cachedUrl).not.toContain("/session");
        expect(cachedUrl).not.toContain("/export");
      }
    }
  });
});
