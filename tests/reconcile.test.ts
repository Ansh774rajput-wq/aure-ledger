import { describe, expect, it } from "vitest";
import {
  checkReconciliation,
  ReconciliationDataset,
} from "../src/domain/reconciliation";

describe("Ledger Reconciliation & Integrity Engine", () => {
  function createHealthyDataset(): ReconciliationDataset {
    return {
      poolTransactions: [
        {
          id: "pt-equity",
          direction: "IN",
          type: "OWN_CAPITAL_IN",
          amount: "50000",
          transactionDate: "2026-01-01",
          loanId: null,
          borrowingId: null,
          equityEntryId: "eq-1",
          paymentId: null,
          paymentReversalId: null,
          reference: null,
        },
        {
          id: "pt-disburse-1",
          direction: "OUT",
          type: "LOAN_DISBURSEMENT_OUT",
          amount: "10000",
          transactionDate: "2026-01-05",
          loanId: "loan-1",
          borrowingId: null,
          equityEntryId: null,
          paymentId: null,
          paymentReversalId: null,
          reference: null,
        },
        {
          id: "pt-repay-1",
          direction: "IN",
          type: "BORROWER_REPAYMENT_IN",
          amount: "3000",
          transactionDate: "2026-01-20",
          loanId: "loan-1",
          borrowingId: null,
          equityEntryId: null,
          paymentId: "pay-1",
          paymentReversalId: null,
          reference: "UPI/123",
        },
        {
          id: "pt-borrow-1",
          direction: "IN",
          type: "BORROWING_RECEIVED_IN",
          amount: "20000",
          transactionDate: "2026-01-10",
          loanId: null,
          borrowingId: "borrow-1",
          equityEntryId: null,
          paymentId: null,
          paymentReversalId: null,
          reference: null,
        },
        {
          id: "pt-repay-lender-1",
          direction: "OUT",
          type: "LENDER_REPAYMENT_OUT",
          amount: "5000",
          transactionDate: "2026-01-25",
          loanId: null,
          borrowingId: "borrow-1",
          equityEntryId: null,
          paymentId: "pay-2",
          paymentReversalId: null,
          reference: null,
        },
      ],
      payments: [
        {
          id: "pay-1",
          loanId: "loan-1",
          borrowingId: null,
          amount: "3000",
          principal: "2500",
          interest: "500",
          fees: "0",
          transactionDate: "2026-01-20",
          reference: "UPI/123",
          reversal: null,
        },
        {
          id: "pay-2",
          loanId: null,
          borrowingId: "borrow-1",
          amount: "5000",
          principal: "4500",
          interest: "500",
          fees: "0",
          transactionDate: "2026-01-25",
          reference: null,
          reversal: null,
        },
      ],
      loans: [
        {
          id: "loan-1",
          principal: "10000",
          originalInterest: "1000",
          status: "ACTIVE",
          startDate: "2026-01-05",
          dueDate: "2026-04-05",
          payments: [
            {
              id: "pay-1",
              loanId: "loan-1",
              borrowingId: null,
              amount: "3000",
              principal: "2500",
              interest: "500",
              fees: "0",
              transactionDate: "2026-01-20",
              reference: "UPI/123",
              reversal: null,
            },
          ],
          adjustments: [],
          settlements: [],
        },
      ],
      borrowings: [
        {
          id: "borrow-1",
          principal: "20000",
          originalInterest: "2000",
          status: "ACTIVE",
          startDate: "2026-01-10",
          dueDate: "2026-05-10",
          payments: [
            {
              id: "pay-2",
              loanId: null,
              borrowingId: "borrow-1",
              amount: "5000",
              principal: "4500",
              interest: "500",
              fees: "0",
              transactionDate: "2026-01-25",
              reference: null,
              reversal: null,
            },
          ],
          adjustments: [],
          settlements: [],
        },
      ],
      reversals: [],
    };
  }

  it("reports healthy=true when ledger dataset is fully balanced and coherent", () => {
    const data = createHealthyDataset();
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
    // Pool balance = 50000 - 10000 + 3000 + 20000 - 5000 = 58000
    expect(result.metrics.poolBalance).toBe("58000");
    expect(result.metrics.criticalDiscrepancies).toBe(0);
    expect(result.metrics.warningDiscrepancies).toBe(0);
  });

  it("detects historical cumulative negative pool balance", () => {
    const data = createHealthyDataset();
    // Invert initial capital so pool starts negative
    data.poolTransactions[0].amount = "5000"; // only ₹5k capital, but ₹10k disbursed on 2026-01-05
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "POOL_CUMULATIVE_NEGATIVE");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("CRITICAL");
    expect(issue?.message).toContain("Historical pool cash fell below zero");
  });

  it("detects payment allocation mismatch (fees + interest + principal != amount)", () => {
    const data = createHealthyDataset();
    data.payments[0].principal = "2000"; // 2000 + 500 = 2500 != 3000
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "PAYMENT_ALLOCATION_MISMATCH");
    expect(issue).toBeDefined();
    expect(issue?.entityId).toBe("pay-1");
  });

  it("detects payment missing matching pool transaction", () => {
    const data = createHealthyDataset();
    // Remove the pool transaction for pay-1
    data.poolTransactions = data.poolTransactions.filter((p) => p.paymentId !== "pay-1");
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "PAYMENT_MISSING_POOL_TX");
    expect(issue).toBeDefined();
    expect(issue?.entityId).toBe("pay-1");
  });

  it("detects payment and pool transaction amount mismatch", () => {
    const data = createHealthyDataset();
    const pt = data.poolTransactions.find((p) => p.paymentId === "pay-1")!;
    pt.amount = "3500"; // Payment is 3000
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "PAYMENT_POOL_AMOUNT_MISMATCH");
    expect(issue).toBeDefined();
  });

  it("detects payment and pool transaction direction mismatch", () => {
    const data = createHealthyDataset();
    const pt = data.poolTransactions.find((p) => p.paymentId === "pay-1")!;
    pt.direction = "OUT"; // Loan repayment must be IN
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "PAYMENT_POOL_DIRECTION_MISMATCH");
    expect(issue).toBeDefined();
  });

  it("detects loan missing initial disbursement movement", () => {
    const data = createHealthyDataset();
    data.poolTransactions = data.poolTransactions.filter((p) => p.type !== "LOAN_DISBURSEMENT_OUT");
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "LOAN_MISSING_DISBURSEMENT_POOL_TX");
    expect(issue).toBeDefined();
  });

  it("detects loan principal overpayment", () => {
    const data = createHealthyDataset();
    // Loan principal is 10000, pay principal 12000
    data.loans[0].payments[0].principal = "12000";
    data.loans[0].payments[0].amount = "12500";
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "LOAN_PRINCIPAL_OVERPAID");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("Loan principal overpaid");
  });

  it("detects loan interest overpayment beyond agreed and adjustments", () => {
    const data = createHealthyDataset();
    // Original interest is 1000, pay interest 1500
    data.loans[0].payments[0].interest = "1500";
    data.loans[0].payments[0].amount = "4000";
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "LOAN_INTEREST_OVERPAID");
    expect(issue).toBeDefined();
  });

  it("detects closed loan with outstanding principal remaining", () => {
    const data = createHealthyDataset();
    data.loans[0].status = "CLOSED"; // Only paid 2500 principal of 10000
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "LOAN_CLOSED_WITH_OUTSTANDING_PRINCIPAL");
    expect(issue).toBeDefined();
  });

  it("detects active loan with zero outstanding balance", () => {
    const data = createHealthyDataset();
    // Fully pay off loan
    data.loans[0].payments[0].principal = "10000";
    data.loans[0].payments[0].interest = "1000";
    data.loans[0].payments[0].amount = "11000";
    data.loans[0].status = "ACTIVE"; // Should be CLOSED
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "LOAN_ACTIVE_WITH_ZERO_BALANCE");
    expect(issue).toBeDefined();
  });

  it("detects borrowing receipt amount mismatch", () => {
    const data = createHealthyDataset();
    const pt = data.poolTransactions.find((p) => p.type === "BORROWING_RECEIVED_IN")!;
    pt.amount = "25000"; // Borrowing principal is 20000
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "BORROWING_RECEIPT_AMOUNT_MISMATCH");
    expect(issue).toBeDefined();
  });

  it("detects payment reversal missing compensating pool transaction", () => {
    const data = createHealthyDataset();
    data.reversals.push({
      id: "rev-1",
      paymentId: "pay-1",
      reversalDate: "2026-01-22",
      reason: "Bounced cheque correction",
    });
    // Do not add compensating pool transaction
    const result = checkReconciliation(data);

    expect(result.healthy).toBe(false);
    const issue = result.discrepancies.find((d) => d.code === "REVERSAL_MISSING_POOL_TX");
    expect(issue).toBeDefined();
  });
});
