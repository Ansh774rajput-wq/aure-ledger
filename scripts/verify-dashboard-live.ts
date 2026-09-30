import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

// Load .env
const envText = readFileSync(".env", "utf-8");
const env: Record<string, string> = {};
envText.split("\n").forEach((line) => {
  const idx = line.indexOf("=");
  if (idx > 0 && !line.startsWith("#")) {
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = val;
  }
});

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("Navigating to http://localhost:3000 ...");
  await page.goto("http://localhost:3000");

  const unlockBtn = page.getByRole("button", { name: "Unlock workspace" });
  const capitalHeading = page.getByText("Available capital").first();

  await Promise.race([
    unlockBtn.waitFor({ state: "visible", timeout: 15000 }),
    capitalHeading.waitFor({ state: "visible", timeout: 15000 }),
  ]);

  if (await unlockBtn.isVisible()) {
    console.log("Unlocking workspace with owner password...");
    const snapshotPromise = page.waitForResponse(
      (r) => r.url().includes("/api/snapshot") && r.status() === 200,
    );
    await page.getByLabel("Owner password").fill(env.APP_PASSWORD);
    await unlockBtn.click();
    await snapshotPromise;
  }

  await capitalHeading.waitFor({ state: "visible", timeout: 15000 });
  console.log("Available capital header is visible!");

  // Check for error banner
  const errorBanner = page.locator(".message.error");
  if (await errorBanner.isVisible()) {
    console.error("ERROR BANNER DETECTED:", await errorBanner.textContent());
  } else {
    console.log("No error banner detected.");
  }

  // Check balances
  const capitalAmount = await page.locator(".capital-amount").textContent();
  console.log("Available capital amount:", capitalAmount?.trim());

  const statCards = await page.locator(".stat-card").allTextContents();
  statCards.forEach((s, idx) => {
    console.log(`Stat Card ${idx + 1}: ${s.replace(/\s+/g, " ").trim()}`);
  });

  const loanRows = await page.locator(".loan-row").allTextContents();
  console.log(`Rendered overview loan rows count: ${loanRows.length}`);
  if (loanRows.length > 0) {
    console.log("First overview loan row:", loanRows[0].replace(/\s+/g, " ").trim());
  }

  // Click Loans tab
  console.log("Navigating to Loans tab...");
  await page.getByRole("button", { name: "Loans" }).first().click();
  const allLoans = await page.locator(".loan-card, .loan-row").allTextContents();
  console.log(`Total loans displayed on Loans tab: ${allLoans.length}`);

  // Test failure state: intercept /api/snapshot with 503
  console.log("\nTesting loading failure fallback (simulating 503 on /api/snapshot)...");
  await page.route("**/api/snapshot", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "The database is unavailable. No financial changes have been made." }),
    }),
  );

  // Navigate back to overview and trigger refresh
  await page.getByRole("button", { name: "Overview" }).first().click();
  await page.reload();

  const failedError = page.locator(".message.error");
  await failedError.waitFor({ state: "visible", timeout: 10000 });
  console.log("Error banner on failure:", (await failedError.textContent())?.trim());

  const failedCapital = await page.locator(".capital-amount").textContent();
  console.log("Capital amount on failure:", failedCapital?.trim());

  const failedStats = await page.locator(".stat-card strong").allTextContents();
  console.log("Stats values on failure:", failedStats.map((s) => s.trim()));

  if (failedCapital?.trim() === "Unavailable" && failedStats.every((s) => s.trim() === "Unavailable")) {
    console.log("SUCCESS: All balances correctly display 'Unavailable' on failure instead of ₹0!");
  } else {
    throw new Error(`Expected 'Unavailable' on failure, but got: capital=${failedCapital}, stats=${JSON.stringify(failedStats)}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Dashboard verification error:", err);
  process.exit(1);
});
