import { Decimal } from "decimal.js";

const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });

export interface ReconciliationDiscrepancy {
  code: string;
  severity: "CRITICAL" | "WARNING";
  entityType: "POOL" | "PAYMENT" | "LOAN" | "BORROWING" | "SETTLEMENT" | "REVERSAL";
  entityId: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ReconciliationResult {
  healthy: boolean;
  generatedAt: string;
  metrics: {
    poolBalance: string;
    totalPoolTransactions: number;
    totalPayments: number;
    totalLoans: number;
    totalBorrowings: number;
    totalAdjustments: number;
    totalReversals: number;
    totalDiscrepancies: number;
    criticalDiscrepancies: number;
    warningDiscrepancies: number;
  };
  discrepancies: ReconciliationDiscrepancy[];
}

export interface ReconciliationPoolTx {
  id: string;
  direction: string;
  type: string;
  amount: string;
  transactionDate: string;
  loanId: string | null;
  borrowingId: string | null;
  equityEntryId: string | null;
  paymentId: string | null;
  paymentReversalId: string | null;
  reference: string | null;
}

export interface ReconciliationPayment {
  id: string;
  loanId: string | null;
  borrowingId: string | null;
  amount: string;
  principal: string;
  interest: string;
  fees: string;
  transactionDate: string;
  reference: string | null;
  reversal?: {
    id: string;
    reversalDate: string;
    reason: string;
  } | null;
}

export interface ReconciliationLoan {
  id: string;
  principal: string;
  originalInterest: string;
  status: string;
  startDate: string;
  dueDate: string;
  payments: ReconciliationPayment[];
  adjustments: { id: string; amount: string; reason: string }[];
  settlements: { id: string; payoffAmount: string; finalTotalInterest: string }[];
}

export interface ReconciliationBorrowing {
  id: string;
  principal: string;
  originalInterest: string;
  status: string;
  startDate: string;
  dueDate: string;
  payments: ReconciliationPayment[];
  adjustments: { id: string; amount: string; reason: string }[];
  settlements: { id: string; payoffAmount: string; finalTotalInterest: string }[];
}

export interface ReconciliationDataset {
  poolTransactions: ReconciliationPoolTx[];
  payments: ReconciliationPayment[];
  loans: ReconciliationLoan[];
  borrowings: ReconciliationBorrowing[];
  reversals: {
    id: string;
    paymentId: string;
    reversalDate: string;
    reason: string;
  }[];
}

/**
 * Pure domain reconciliation function. Inspects the ledger dataset for financial discrepancies.
 */
export function checkReconciliation(data: ReconciliationDataset): ReconciliationResult {
  const discrepancies: ReconciliationDiscrepancy[] = [];

  // 1. Reconcile Pool Transactions
  let runningPool = new D(0);
  let totalIn = new D(0);
  let totalOut = new D(0);

  // Sort pool transactions by date, then id for cumulative check
  const sortedPool = [...data.poolTransactions].sort((a, b) =>
    a.transactionDate.localeCompare(b.transactionDate),
  );

  for (const tx of sortedPool) {
    const amt = new D(tx.amount);
    if (amt.lte(0)) {
      discrepancies.push({
        code: "POOL_NON_POSITIVE_AMOUNT",
        severity: "CRITICAL",
        entityType: "POOL",
        entityId: tx.id,
        message: `Pool transaction has non-positive amount: ₹${tx.amount}`,
      });
    }

    if (tx.direction === "IN") {
      runningPool = runningPool.plus(amt);
      totalIn = totalIn.plus(amt);
    } else if (tx.direction === "OUT") {
      runningPool = runningPool.minus(amt);
      totalOut = totalOut.plus(amt);
    } else {
      discrepancies.push({
        code: "POOL_INVALID_DIRECTION",
        severity: "CRITICAL",
        entityType: "POOL",
        entityId: tx.id,
        message: `Pool transaction has invalid direction: ${tx.direction}`,
      });
    }

    // Cumulative solvency check
    if (runningPool.lt(0)) {
      discrepancies.push({
        code: "POOL_CUMULATIVE_NEGATIVE",
        severity: "CRITICAL",
        entityType: "POOL",
        entityId: tx.id,
        message: `Historical pool cash fell below zero (₹${runningPool.toFixed(0)}) on ${tx.transactionDate}`,
        details: { runningBalance: runningPool.toFixed(0), transactionDate: tx.transactionDate },
      });
    }
  }

  // 2. Reconcile Payments with Pool Transactions
  const poolTxByPaymentId = new Map<string, ReconciliationPoolTx>();
  for (const pt of data.poolTransactions) {
    if (pt.paymentId) {
      if (poolTxByPaymentId.has(pt.paymentId)) {
        discrepancies.push({
          code: "MULTIPLE_POOL_TX_FOR_PAYMENT",
          severity: "CRITICAL",
          entityType: "PAYMENT",
          entityId: pt.paymentId,
          message: `Multiple pool transactions linked to payment ${pt.paymentId}`,
        });
      }
      poolTxByPaymentId.set(pt.paymentId, pt);
    }
  }

  for (const payment of data.payments) {
    // 2a. Payment allocation sum
    const pAmt = new D(payment.amount);
    const fees = new D(payment.fees);
    const int = new D(payment.interest);
    const prin = new D(payment.principal);

    if (pAmt.lte(0)) {
      discrepancies.push({
        code: "PAYMENT_NON_POSITIVE",
        severity: "CRITICAL",
        entityType: "PAYMENT",
        entityId: payment.id,
        message: `Payment amount is non-positive: ₹${payment.amount}`,
      });
    }

    if (!pAmt.equals(fees.plus(int).plus(prin))) {
      discrepancies.push({
        code: "PAYMENT_ALLOCATION_MISMATCH",
        severity: "CRITICAL",
        entityType: "PAYMENT",
        entityId: payment.id,
        message: `Payment amount (₹${payment.amount}) does not equal sum of fees (₹${payment.fees}) + interest (₹${payment.interest}) + principal (₹${payment.principal})`,
      });
    }

    // 2b. Matching pool transaction linkage
    const matchingPool = poolTxByPaymentId.get(payment.id);
    if (!matchingPool) {
      discrepancies.push({
        code: "PAYMENT_MISSING_POOL_TX",
        severity: "CRITICAL",
        entityType: "PAYMENT",
        entityId: payment.id,
        message: `Payment ${payment.id} has no matching PoolTransaction record`,
      });
    } else {
      if (!pAmt.equals(matchingPool.amount)) {
        discrepancies.push({
          code: "PAYMENT_POOL_AMOUNT_MISMATCH",
          severity: "CRITICAL",
          entityType: "PAYMENT",
          entityId: payment.id,
          message: `Payment amount (₹${payment.amount}) does not match pool transaction amount (₹${matchingPool.amount})`,
        });
      }

      if (payment.transactionDate !== matchingPool.transactionDate) {
        discrepancies.push({
          code: "PAYMENT_POOL_DATE_MISMATCH",
          severity: "WARNING",
          entityType: "PAYMENT",
          entityId: payment.id,
          message: `Payment date (${payment.transactionDate}) differs from pool transaction date (${matchingPool.transactionDate})`,
        });
      }

      const expectedDirection = payment.loanId ? "IN" : "OUT";
      if (matchingPool.direction !== expectedDirection) {
        discrepancies.push({
          code: "PAYMENT_POOL_DIRECTION_MISMATCH",
          severity: "CRITICAL",
          entityType: "PAYMENT",
          entityId: payment.id,
          message: `Payment pool direction is ${matchingPool.direction}, expected ${expectedDirection}`,
        });
      }
    }
  }

  // 3. Reconcile Reversals
  const poolTxByReversalId = new Map<string, ReconciliationPoolTx>();
  for (const pt of data.poolTransactions) {
    if (pt.paymentReversalId) {
      poolTxByReversalId.set(pt.paymentReversalId, pt);
    }
  }

  for (const rev of data.reversals) {
    const originalPayment = data.payments.find((p) => p.id === rev.paymentId);
    if (!originalPayment) {
      discrepancies.push({
        code: "REVERSAL_ORPHAN_PAYMENT",
        severity: "CRITICAL",
        entityType: "REVERSAL",
        entityId: rev.id,
        message: `Payment reversal ${rev.id} references nonexistent payment ${rev.paymentId}`,
      });
      continue;
    }

    const matchingPool = poolTxByReversalId.get(rev.id);
    if (!matchingPool) {
      discrepancies.push({
        code: "REVERSAL_MISSING_POOL_TX",
        severity: "CRITICAL",
        entityType: "REVERSAL",
        entityId: rev.id,
        message: `Payment reversal ${rev.id} has no matching compensating PoolTransaction`,
      });
    } else {
      if (!new D(matchingPool.amount).equals(originalPayment.amount)) {
        discrepancies.push({
          code: "REVERSAL_POOL_AMOUNT_MISMATCH",
          severity: "CRITICAL",
          entityType: "REVERSAL",
          entityId: rev.id,
          message: `Compensating pool transaction amount (₹${matchingPool.amount}) does not match reversed payment amount (₹${originalPayment.amount})`,
        });
      }

      const expectedDirection = originalPayment.loanId ? "OUT" : "IN";
      if (matchingPool.direction !== expectedDirection) {
        discrepancies.push({
          code: "REVERSAL_POOL_DIRECTION_MISMATCH",
          severity: "CRITICAL",
          entityType: "REVERSAL",
          entityId: rev.id,
          message: `Compensating pool direction is ${matchingPool.direction}, expected ${expectedDirection}`,
        });
      }

      if (matchingPool.transactionDate !== rev.reversalDate) {
        discrepancies.push({
          code: "REVERSAL_POOL_DATE_MISMATCH",
          severity: "WARNING",
          entityType: "REVERSAL",
          entityId: rev.id,
          message: `Reversal date (${rev.reversalDate}) differs from compensating pool transaction date (${matchingPool.transactionDate})`,
        });
      }
    }
  }

  // 4. Reconcile Loans
  for (const loan of data.loans) {
    const loanPrincipal = new D(loan.principal);
    const loanOriginalInterest = new D(loan.originalInterest);

    // Initial disbursement check
    const disbTx = data.poolTransactions.find(
      (p) => p.loanId === loan.id && p.type === "LOAN_DISBURSEMENT_OUT",
    );
    if (!disbTx) {
      discrepancies.push({
        code: "LOAN_MISSING_DISBURSEMENT_POOL_TX",
        severity: "CRITICAL",
        entityType: "LOAN",
        entityId: loan.id,
        message: `Loan ${loan.id} has no initial LOAN_DISBURSEMENT_OUT pool transaction`,
      });
    } else if (!new D(disbTx.amount).equals(loanPrincipal)) {
      discrepancies.push({
        code: "LOAN_DISBURSEMENT_AMOUNT_MISMATCH",
        severity: "CRITICAL",
        entityType: "LOAN",
        entityId: loan.id,
        message: `Disbursement movement amount (₹${disbTx.amount}) does not match loan principal (₹${loan.principal})`,
      });
    }

    // Derived active payments (excluding reversed payments)
    let totalPrincipalPaid = new D(0);
    let totalInterestPaid = new D(0);

    for (const p of loan.payments) {
      if (!p.reversal) {
        totalPrincipalPaid = totalPrincipalPaid.plus(p.principal);
        totalInterestPaid = totalInterestPaid.plus(p.interest);
      }
    }

    const totalAdjustments = loan.adjustments.reduce(
      (sum, a) => sum.plus(a.amount),
      new D(0),
    );
    const totalAdjustedInterest = loanOriginalInterest.plus(totalAdjustments);

    const remainingPrincipal = loanPrincipal.minus(totalPrincipalPaid);
    const remainingInterest = totalAdjustedInterest.minus(totalInterestPaid);

    if (remainingPrincipal.lt(0)) {
      discrepancies.push({
        code: "LOAN_PRINCIPAL_OVERPAID",
        severity: "CRITICAL",
        entityType: "LOAN",
        entityId: loan.id,
        message: `Loan principal overpaid by ₹${remainingPrincipal.abs().toFixed(0)} (Principal: ₹${loan.principal}, Paid: ₹${totalPrincipalPaid.toFixed(0)})`,
      });
    }

    if (remainingInterest.lt(0)) {
      discrepancies.push({
        code: "LOAN_INTEREST_OVERPAID",
        severity: "CRITICAL",
        entityType: "LOAN",
        entityId: loan.id,
        message: `Loan interest overpaid by ₹${remainingInterest.abs().toFixed(0)} (Adjusted interest: ₹${totalAdjustedInterest.toFixed(0)}, Paid: ₹${totalInterestPaid.toFixed(0)})`,
      });
    }

    // Status vs balances consistency
    if (loan.status === "CLOSED") {
      if (remainingPrincipal.gt(0)) {
        discrepancies.push({
          code: "LOAN_CLOSED_WITH_OUTSTANDING_PRINCIPAL",
          severity: "CRITICAL",
          entityType: "LOAN",
          entityId: loan.id,
          message: `Loan ${loan.id} is CLOSED but has ₹${remainingPrincipal.toFixed(0)} outstanding principal`,
        });
      }
      if (remainingInterest.gt(0) && loan.settlements.length === 0) {
        discrepancies.push({
          code: "LOAN_CLOSED_WITH_OUTSTANDING_INTEREST",
          severity: "WARNING",
          entityType: "LOAN",
          entityId: loan.id,
          message: `Loan ${loan.id} is CLOSED without settlement operation but has ₹${remainingInterest.toFixed(0)} outstanding interest`,
        });
      }
    } else if (loan.status === "ACTIVE") {
      if (remainingPrincipal.isZero() && remainingInterest.isZero()) {
        discrepancies.push({
          code: "LOAN_ACTIVE_WITH_ZERO_BALANCE",
          severity: "WARNING",
          entityType: "LOAN",
          entityId: loan.id,
          message: `Loan ${loan.id} is ACTIVE but has 0 remaining principal and interest`,
        });
      }
    }
  }

  // 5. Reconcile Borrowings
  for (const borrowing of data.borrowings) {
    const borrowingPrincipal = new D(borrowing.principal);
    const borrowingOriginalInterest = new D(borrowing.originalInterest);

    // Initial receipt check
    const recTx = data.poolTransactions.find(
      (p) => p.borrowingId === borrowing.id && p.type === "BORROWING_RECEIVED_IN",
    );
    if (!recTx) {
      discrepancies.push({
        code: "BORROWING_MISSING_RECEIPT_POOL_TX",
        severity: "CRITICAL",
        entityType: "BORROWING",
        entityId: borrowing.id,
        message: `Borrowing ${borrowing.id} has no initial BORROWING_RECEIVED_IN pool transaction`,
      });
    } else if (!new D(recTx.amount).equals(borrowingPrincipal)) {
      discrepancies.push({
        code: "BORROWING_RECEIPT_AMOUNT_MISMATCH",
        severity: "CRITICAL",
        entityType: "BORROWING",
        entityId: borrowing.id,
        message: `Receipt movement amount (₹${recTx.amount}) does not match borrowing principal (₹${borrowing.principal})`,
      });
    }

    let totalPrincipalPaid = new D(0);
    let totalInterestPaid = new D(0);

    for (const p of borrowing.payments) {
      if (!p.reversal) {
        totalPrincipalPaid = totalPrincipalPaid.plus(p.principal);
        totalInterestPaid = totalInterestPaid.plus(p.interest);
      }
    }

    const totalAdjustments = borrowing.adjustments.reduce(
      (sum, a) => sum.plus(a.amount),
      new D(0),
    );
    const totalAdjustedInterest = borrowingOriginalInterest.plus(totalAdjustments);

    const remainingPrincipal = borrowingPrincipal.minus(totalPrincipalPaid);
    const remainingInterest = totalAdjustedInterest.minus(totalInterestPaid);

    if (remainingPrincipal.lt(0)) {
      discrepancies.push({
        code: "BORROWING_PRINCIPAL_OVERPAID",
        severity: "CRITICAL",
        entityType: "BORROWING",
        entityId: borrowing.id,
        message: `Borrowing principal overpaid by ₹${remainingPrincipal.abs().toFixed(0)} (Principal: ₹${borrowing.principal}, Paid: ₹${totalPrincipalPaid.toFixed(0)})`,
      });
    }

    if (remainingInterest.lt(0)) {
      discrepancies.push({
        code: "BORROWING_INTEREST_OVERPAID",
        severity: "CRITICAL",
        entityType: "BORROWING",
        entityId: borrowing.id,
        message: `Borrowing interest overpaid by ₹${remainingInterest.abs().toFixed(0)} (Adjusted interest: ₹${totalAdjustedInterest.toFixed(0)}, Paid: ₹${totalInterestPaid.toFixed(0)})`,
      });
    }

    if (borrowing.status === "CLOSED") {
      if (remainingPrincipal.gt(0)) {
        discrepancies.push({
          code: "BORROWING_CLOSED_WITH_OUTSTANDING_PRINCIPAL",
          severity: "CRITICAL",
          entityType: "BORROWING",
          entityId: borrowing.id,
          message: `Borrowing ${borrowing.id} is CLOSED but has ₹${remainingPrincipal.toFixed(0)} outstanding principal`,
        });
      }
      if (remainingInterest.gt(0) && borrowing.settlements.length === 0) {
        discrepancies.push({
          code: "BORROWING_CLOSED_WITH_OUTSTANDING_INTEREST",
          severity: "WARNING",
          entityType: "BORROWING",
          entityId: borrowing.id,
          message: `Borrowing ${borrowing.id} is CLOSED without settlement operation but has ₹${remainingInterest.toFixed(0)} outstanding interest`,
        });
      }
    } else if (borrowing.status === "ACTIVE") {
      if (remainingPrincipal.isZero() && remainingInterest.isZero()) {
        discrepancies.push({
          code: "BORROWING_ACTIVE_WITH_ZERO_BALANCE",
          severity: "WARNING",
          entityType: "BORROWING",
          entityId: borrowing.id,
          message: `Borrowing ${borrowing.id} is ACTIVE but has 0 remaining principal and interest`,
        });
      }
    }
  }

  const criticalCount = discrepancies.filter((d) => d.severity === "CRITICAL").length;
  const warningCount = discrepancies.filter((d) => d.severity === "WARNING").length;

  return {
    healthy: discrepancies.length === 0,
    generatedAt: new Date().toISOString(),
    metrics: {
      poolBalance: runningPool.toFixed(0),
      totalPoolTransactions: data.poolTransactions.length,
      totalPayments: data.payments.length,
      totalLoans: data.loans.length,
      totalBorrowings: data.borrowings.length,
      totalAdjustments: data.loans.reduce((s, l) => s + l.adjustments.length, 0) +
        data.borrowings.reduce((s, b) => s + b.adjustments.length, 0),
      totalReversals: data.reversals.length,
      totalDiscrepancies: discrepancies.length,
      criticalDiscrepancies: criticalCount,
      warningDiscrepancies: warningCount,
    },
    discrepancies,
  };
}

/**
 * Sanitizes a single CSV cell against formula injection (CWE-1236).
 * If a cell begins with '=', '+', '-', '@', '\t', '\r', it prefixes a single quote `'`.
 * Also properly escapes quotes and wraps in double quotes if commas or newlines are present.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  let str = String(value);

  // Strip formula injection triggers
  const formulaChars = ["=", "+", "-", "@", "\t", "\r"];
  if (formulaChars.some((char) => str.startsWith(char))) {
    // If it's a signed or plain numeric literal (e.g. -500, +500), it's safe as numbers
    if (/^[+-]?\d+(\.\d+)?$/.test(str.trim())) {
      return str;
    }
    // Prefix single quote to disable formula execution in Excel/Calc/Sheets
    str = `'${str}`;
  }

  // Escape inner double quotes
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Converts headers and row arrays into a safe CSV string.
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const headerRow = headers.map(sanitizeCsvCell).join(",");
  const dataRows = rows.map((row) => row.map(sanitizeCsvCell).join(","));
  return [headerRow, ...dataRows].join("\r\n");
}
