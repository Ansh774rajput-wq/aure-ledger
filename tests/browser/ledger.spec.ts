import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore the sample ledger", exact: true })
    .click();
});
test("sample balances, read-only actions and mobile fit", async ({
  page,
}, testInfo) => {
  await expect(
    page.getByText("₹75,000", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Disburse loan", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("read-only");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-overview.png`,
    fullPage: true,
  });
});
test("loan search, detail and overdue filter", async ({ page }) => {
  await page.getByRole("button", { name: "All loans", exact: true }).click();
  await page.getByRole("textbox", { name: "Search borrowers" }).fill("Priya");
  await page.getByRole("button", { name: /Priya Sharma/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Original agreed interest",
  );
  await expect(page.getByRole("dialog")).toContainText("₹1,184");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("textbox", { name: "Search borrowers" }).fill("");
  await page.getByLabel("Filter loans").selectOption("Overdue");
  await expect(
    page.getByRole("button", { name: /Priya Sharma/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Arjun Mehta/ })).toHaveCount(
    0,
  );
});
test("creator signature and truthful feature scope", async ({ page }) => {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(
    page.getByText("adonis's creation", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Borrowings", exact: true }).click();
  await expect(
    page.getByText(/Your lender ledger/),
  ).toBeVisible();
});
test("private API rejects unsigned access", async ({ request }) => {
  const response = await request.get("/api/snapshot");
  expect(response.status()).toBe(401);
});
test("loan form quotes interest and sends an explicit disbursement command (mocked API)", async ({
  page,
}) => {
  await page.route("**/api/session", (r) =>
    r.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/snapshot", (r) =>
    r.fulfill({
      json: {
        available: "50000",
        lent: "0",
        borrowed: "0",
        interestEarned: "0",
        people: [
          {
            id: "p1",
            name: "Test borrower",
            phone: null,
            borrowerId: "b1",
            lenderId: null,
          },
        ],
        loans: [],
        activity: [],
      },
    }),
  );
  let submitted: Record<string, any> | undefined;
  await page.route("**/api/commands", (r) => {
    submitted = r.request().postDataJSON();
    return r.fulfill({ json: { loanId: "mocked-result", warnings: [] } });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Disburse loan", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Borrower", exact: true })
    .selectOption("b1");
  await page.getByLabel("Principal (₹)", { exact: true }).fill("20000");
  await page.getByLabel("Disbursement date").fill("2026-01-01");
  await page.getByLabel("Agreed due date").fill("2026-04-01");
  await expect(page.getByRole("dialog")).toContainText("₹592");
  await page.getByRole("button", { name: "Confirm disbursement" }).click();
  await expect(page.getByRole("status")).toContainText("Loan disbursed");
  expect(submitted?.type).toBe("DISBURSE");
  expect(submitted?.input.principal).toBe("20000");
  expect(submitted?.input.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
});
test("an unconfirmed capital submission retries its original key and payload (mocked API)", async ({
  page,
}) => {
  await page.route("**/api/session", (r) =>
    r.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/snapshot", (r) =>
    r.fulfill({
      json: {
        available: "0",
        lent: "0",
        borrowed: "0",
        interestEarned: "0",
        people: [],
        loans: [],
        activity: [],
      },
    }),
  );
  const requests: unknown[] = [];
  await page.route("**/api/commands", (r) => {
    requests.push(r.request().postDataJSON());
    return r.fulfill(
      requests.length === 1
        ? { status: 503, json: { error: "Unconfirmed result" } }
        : { json: { id: "mocked-result", warnings: [] } },
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Add capital", exact: true }).click();
  await page.getByLabel("Amount (₹)", { exact: true }).fill("50000");
  await page.getByLabel("Reason", { exact: true }).fill("Opening capital");
  await page.getByRole("button", { name: "Record capital addition" }).click();
  await expect(page.getByLabel("Amount (₹)", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check the same submission" }).click();
  await expect(page.getByRole("status")).toContainText("Capital added");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});
test("borrowing form quotes interest and sends an explicit borrowing command (mocked API)", async ({
  page,
}) => {
  await page.route("**/api/session", (r) =>
    r.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/snapshot", (r) =>
    r.fulfill({
      json: {
        available: "50000",
        lent: "0",
        borrowed: "0",
        interestEarned: "0",
        people: [
          {
            id: "p1",
            name: "Test lender",
            phone: null,
            borrowerId: null,
            lenderId: "len1",
          },
        ],
        loans: [],
        borrowings: [],
        activity: [],
      },
    }),
  );
  let submitted: Record<string, any> | undefined;
  await page.route("**/api/commands", (r) => {
    submitted = r.request().postDataJSON();
    return r.fulfill({
      json: { borrowingId: "mocked-borrowing", warnings: [] },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Borrowings", exact: true }).click();
  await page
    .getByRole("button", { name: "Record borrowing", exact: true })
    .first()
    .click();
  await page
    .getByRole("combobox", { name: "Lender", exact: true })
    .selectOption("len1");
  await page.getByLabel("Principal (₹)", { exact: true }).fill("25000");
  await page.getByLabel("Received date").fill("2026-01-01");
  await page.getByLabel("Agreed due date").fill("2026-07-01");
  await expect(page.getByRole("dialog")).toContainText("₹1,240");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Record borrowing" })
    .click();
  await expect(page.getByRole("status")).toContainText("Borrowing recorded");
  expect(submitted?.type).toBe("BORROW");
  expect(submitted?.input.principal).toBe("25000");
  expect(submitted?.input.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
});
test("repayment form previews allocation and sends repayment command (mocked API)", async ({
  page,
}) => {
  await page.route("**/api/session", (r) =>
    r.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/snapshot", (r) =>
    r.fulfill({
      json: {
        available: "50000",
        lent: "20000",
        borrowed: "0",
        interestEarned: "0",
        people: [
          {
            id: "p1",
            name: "Priya Sharma",
            phone: null,
            borrowerId: "b1",
            lenderId: null,
          },
        ],
        loans: [
          {
            id: "loan-1",
            name: "Priya Sharma",
            principal: "20000",
            rate: "12",
            method: "ANNUAL_ACTUAL_365",
            interest: "1000",
            start: "2026-01-01",
            due: "2026-05-01",
            status: "ACTIVE",
            remainingPrincipal: "20000",
            remainingInterest: "1000",
            payments: [
              {
                id: "pay-prev",
                amount: "200",
                fees: "0",
                interest: "200",
                principal: "0",
                date: "2026-01-15",
                reference: "UTR-001",
              },
            ],
          },
        ],
        borrowings: [],
        activity: [],
      },
    }),
  );
  let submitted: Record<string, any> | undefined;
  await page.route("**/api/commands", (r) => {
    submitted = r.request().postDataJSON();
    return r.fulfill({
      json: {
        paymentId: "pay-1",
        poolTransactionId: "pool-1",
        allocation: { fees: "0", interest: "600", principal: "0" },
        remainingPrincipal: "20000",
        remainingInterest: "400",
        settled: false,
        warnings: [],
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "All loans", exact: true }).click();
  await page.getByRole("button", { name: /Priya Sharma/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Outstanding principal");
  await expect(page.getByRole("dialog")).toContainText("Outstanding interest");
  await expect(page.getByRole("dialog")).toContainText("Repayment history (1)");
  await expect(page.getByRole("dialog")).toContainText("UTR-001");

  await page.getByRole("button", { name: "Record repayment" }).click();
  await expect(page.getByRole("dialog")).toContainText("LOAN REPAYMENT");
  await expect(page.getByRole("dialog")).toContainText(
    "Record repayment for Priya Sharma",
  );

  // Fill amount ₹600
  await page.getByLabel("Amount (₹)", { exact: true }).fill("600");
  await expect(page.getByRole("dialog")).toContainText("Allocation preview");
  await expect(page.getByRole("dialog")).toContainText("Interest: ₹600");
  await expect(page.getByRole("dialog")).toContainText("Principal: ₹0");

  // Test overpayment preview and disabling submit
  await page.getByLabel("Amount (₹)", { exact: true }).fill("25000");
  await expect(page.getByRole("dialog")).toContainText(
    "Payment exceeds outstanding balance",
  );
  await expect(
    page.getByRole("button", { name: "Confirm repayment" }),
  ).toBeDisabled();

  // Reset to valid amount ₹600 and confirm
  await page.getByLabel("Amount (₹)", { exact: true }).fill("600");
  await page.getByRole("button", { name: "Confirm repayment" }).click();
  await expect(page.getByRole("status")).toContainText("Repayment recorded");

  expect(submitted?.type).toBe("REPAY");
  expect(submitted?.input.loanId).toBe("loan-1");
  expect(submitted?.input.amount).toBe("600");
  expect(submitted?.input.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
});

