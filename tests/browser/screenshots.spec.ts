import "dotenv/config";
import { test, expect } from "@playwright/test";
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
import path from "node:path";

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://lending:local_password@localhost:5432/lending_test";

let db: PrismaClient;

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

async function seedData() {
  if (!new URL(testDbUrl).pathname.endsWith("_test")) {
    throw new Error("Refusing to seed non-test database: " + testDbUrl);
  }

  await db.$executeRawUnsafe(
    'TRUNCATE "PaymentReversal", "SettlementOperation", "PersonOperation", "PoolTransaction", "AuditLog", "InterestAdjustment", "Payment", "Loan", "Borrowing", "EquityEntry", "BorrowerProfile", "LenderProfile", "Person" CASCADE',
  );

  // Add pool capital: ₹150,000
  await addCapital(
    {
      amount: "150000",
      transactionDate: "2026-01-01",
      reason: "Initial pool capital",
      performedBy: "browser-test",
      idempotencyKey: randomUUID(),
    },
    db,
  );

  // Create Borrower & Loan
  const borrowerPerson = await db.person.create({
    data: {
      name: "Priya Sharma",
      phone: "+919876543210",
      borrower: { create: {} },
    },
    include: { borrower: true },
  });

  await disburseLoan(
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

  // Create Lender & Borrowing
  const lenderPerson = await db.person.create({
    data: {
      name: "Vikas Gupta",
      phone: "+919876543211",
      lender: { create: {} },
    },
    include: { lender: true },
  });

  await receiveBorrowing(
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
}

async function unlockWorkspace(page: any) {
  await page.goto("/");
  const unlockBtn = page.getByRole("button", { name: "Unlock workspace" });
  const capitalHeading = page.getByText("Available capital").first();

  await Promise.race([
    unlockBtn.waitFor({ state: "visible", timeout: 15000 }).catch(() => {}),
    capitalHeading.waitFor({ state: "visible", timeout: 15000 }).catch(() => {}),
  ]);

  if (await unlockBtn.isVisible()) {
    await page.getByLabel("Owner password").fill(process.env.APP_PASSWORD || "");
    await unlockBtn.click();
  }
  await expect(capitalHeading).toBeVisible({ timeout: 15000 });
}

test.describe("UI redesign screenshots", () => {
  test.beforeEach(async () => {
    await seedData();
  });

  test("capture mobile screenshots (390x844)", async ({ page }, testInfo) => {
    // Only run this test on the mobile project
    if (testInfo.project.name !== "mobile") return;

    await page.setViewportSize({ width: 390, height: 844 });
    await unlockWorkspace(page);

    // 1. Dashboard (Mobile)
    await page.waitForTimeout(500);
    const dashboardPath = path.resolve("docs/screenshots/mobile-dashboard.png");
    await page.screenshot({ path: dashboardPath, fullPage: false });

    // 2. Loan details (Mobile)
    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await mobileNav.getByRole("button", { name: "Loans" }).click();
    await page.getByRole("button", { name: /Priya Sharma/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Outstanding principal")).toBeVisible();
    await page.waitForTimeout(400);
    const loanDetailsPath = path.resolve("docs/screenshots/mobile-loan-details.png");
    await page.screenshot({ path: loanDetailsPath, fullPage: false });

    // 3. Borrower repayment form (Mobile)
    await dialog.getByRole("button", { name: "Record repayment" }).click();
    await expect(dialog.getByText("LOAN REPAYMENT")).toBeVisible();
    await dialog.getByLabel("Amount (₹)", { exact: true }).fill("600");
    await expect(dialog.getByText("Allocation preview")).toBeVisible();
    await page.waitForTimeout(400);
    const repaymentPath = path.resolve("docs/screenshots/mobile-borrower-repayment.png");
    await page.screenshot({ path: repaymentPath, fullPage: false });

    // Close repayment dialog
    await dialog.getByRole("button", { name: "Close dialog" }).click();

    // 4. Borrowing details (Mobile)
    await mobileNav.getByRole("button", { name: "Borrowings" }).click();
    await page.getByRole("button", { name: /Vikas Gupta/ }).first().click();
    await expect(dialog.getByText(/BORROWING (RECORD|DETAILS)/)).toBeVisible();
    await page.waitForTimeout(400);
    const borrowingDetailsPath = path.resolve("docs/screenshots/mobile-borrowing-details.png");
    await page.screenshot({ path: borrowingDetailsPath, fullPage: false });

    // Close borrowing dialog
    await dialog.getByRole("button", { name: "Close dialog" }).click();

    // 5. More screen with adonis's creation (Mobile)
    await mobileNav.getByRole("button", { name: "More" }).click();
    await expect(page.getByText("adonis's creation", { exact: true })).toBeVisible();
    await page.waitForTimeout(400);
    const morePath = path.resolve("docs/screenshots/mobile-more.png");
    await page.screenshot({ path: morePath, fullPage: false });
  });

  test("capture desktop dashboard screenshot (1440x900)", async ({ page }, testInfo) => {
    // Only run this test on the desktop project
    if (testInfo.project.name !== "desktop") return;

    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockWorkspace(page);
    await page.waitForTimeout(500);

    const desktopPath = path.resolve("docs/screenshots/desktop-dashboard.png");
    await page.screenshot({ path: desktopPath, fullPage: false });
  });
});
