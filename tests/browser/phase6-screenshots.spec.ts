import "dotenv/config";
import { test, expect } from "@playwright/test";
import path from "node:path";

async function unlock(page: any) {
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

test.describe("Phase 6 Screenshots", () => {
  test("capture desktop Phase 6 views", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "desktop") return;
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlock(page);

    // 1. Activity Ledger
    await page.getByRole("button", { name: "Activity" }).first().click();
    await expect(page.getByRole("heading", { name: "Dated Activity Ledger" })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.resolve("docs/screenshots/desktop-activity.png") });

    // 2. Reconciliation Audit Screen
    await page.getByRole("button", { name: "Reconciliation" }).first().click();
    await expect(page.getByRole("heading", { name: "Continuous Integrity Audit" })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.resolve("docs/screenshots/desktop-reconciliation.png") });

    // 3. Pool Statement Modal
    await page.getByRole("button", { name: "Overview" }).first().click();
    await page.getByRole("button", { name: "View Full Pool Statement" }).click();
    await expect(page.getByRole("heading", { name: "Capital Pool Statement" })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.resolve("docs/screenshots/desktop-pool-statement.png") });
    await page.getByRole("button", { name: "Close dialog" }).click();

    // 4. Loan Statement Modal
    await page.getByRole("button", { name: "Loans" }).first().click();
    const loanBtn = page.locator(".picker-item, .person-row, .row-main, .table-row, button:has-text('Borrower')").first();
    if (await loanBtn.isVisible()) {
      await loanBtn.click();
      const stmtBtn = page.getByRole("button", { name: "Individual Loan Statement" });
      if (await stmtBtn.isVisible()) {
        await stmtBtn.click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.resolve("docs/screenshots/desktop-loan-statement.png") });
      }
    }
  });

  test("capture mobile Phase 6 views", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "mobile") return;
    await page.setViewportSize({ width: 390, height: 844 });
    await unlock(page);

    // 1. Mobile Activity
    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await mobileNav.getByRole("button", { name: "Activity" }).click();
    await expect(page.getByRole("heading", { name: "Dated Activity Ledger" })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.resolve("docs/screenshots/mobile-activity.png") });

    // 2. Mobile Reconciliation
    await mobileNav.getByRole("button", { name: "Reconciliation" }).click();
    await expect(page.getByRole("heading", { name: "Continuous Integrity Audit" })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.resolve("docs/screenshots/mobile-reconciliation.png") });
  });
});
