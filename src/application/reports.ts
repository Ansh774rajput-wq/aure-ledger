import { Decimal } from "decimal.js";
import { toCsv } from "../domain/reconciliation";

const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });

export interface ActivityEntry {
  id: string;
  date: string;
  type: string;
  direction: "IN" | "OUT" | "NONE";
  amount: string;
  counterparty: string;
  entityType: "LOAN" | "BORROWING" | "EQUITY" | "POOL";
  entityId: string;
  reference: string | null;
  notes: string;
}

export interface StatementEntry {
  date: string;
  eventType: string;
  description: string;
  reference: string | null;
  cashAmount: string | null;
  cashDirection: "IN" | "OUT" | null;
  principalAllocation: string;
  interestAllocation: string;
  feesAllocation: string;
  adjustmentDelta: string | null;
  runningPrincipal: string;
  runningInterest: string;
  runningTotalOwed: string;
}

export interface AgreementStatement {
  agreementId: string;
  agreementType: "LOAN" | "BORROWING";
  counterpartyName: string;
  counterpartyPhone: string | null;
  principal: string;
  rate: string;
  interestMethod: string;
  originalInterest: string;
  currentAdjustedInterest: string;
  startDate: string;
  dueDate: string;
  status: string;
  asOfDate?: string;
  openingBalance?: {
    date: string;
    principal: string;
    interest: string;
    totalOwed: string;
  };
  totalPaidPrincipal: string;
  totalPaidInterest: string;
  remainingPrincipal: string;
  remainingInterest: string;
  totalRemainingPayoff: string;
  entries: StatementEntry[];
}

export interface PoolStatementEntry {
  id: string;
  date: string;
  type: string;
  direction: "IN" | "OUT";
  amount: string;
  counterparty: string;
  reference: string | null;
  runningBalance: string;
}

export interface PoolStatement {
  generatedAt: string;
  asOfDate: string;
  openingBalance?: string;
  totalInflow: string;
  totalOutflow: string;
  currentBalance: string;
  entries: PoolStatementEntry[];
}

export interface FinancialPositionSummary {
  asOfDate: string;
  ownCapitalInjected: string;
  principalLent: {
    grossDisbursed: string;
    principalRecovered: string;
    outstandingPrincipal: string;
    activeLoanCount: number;
    closedLoanCount: number;
  };
  principalBorrowed: {
    grossBorrowed: string;
    principalRepaid: string;
    outstandingLiability: string;
    activeBorrowingCount: number;
    closedBorrowingCount: number;
  };
  interest: {
    borrowerInterestReceived: string;
    lenderInterestPaid: string;
    netInterestSpread: string;
  };
  poolCash: {
    totalInflow: string;
    totalOutflow: string;
    availableBalance: string;
  };
}

/**
 * Generates safe CSV for Activity Ledger.
 */
export function exportActivityCsv(entries: ActivityEntry[]): string {
  const headers = [
    "Date",
    "Type",
    "Direction",
    "Amount",
    "Counterparty",
    "Entity Type",
    "Entity ID",
    "Reference",
    "Notes",
  ];
  const rows = entries.map((e) => [
    e.date,
    e.type,
    e.direction,
    e.amount,
    e.counterparty,
    e.entityType,
    e.entityId,
    e.reference || "",
    e.notes,
  ]);
  return toCsv(headers, rows);
}

/**
 * Generates safe CSV for an Individual Agreement Statement.
 */
export function exportAgreementStatementCsv(statement: AgreementStatement): string {
  const metaHeaders = [
    "Agreement ID",
    "Type",
    "Counterparty",
    "Principal",
    "Rate %",
    "Interest Method",
    "Original Interest",
    "Adjusted Interest",
    "Start Date",
    "Due Date",
    "Status",
    "Remaining Principal",
    "Remaining Interest",
  ];
  const metaRows = [
    [
      statement.agreementId,
      statement.agreementType,
      statement.counterpartyName,
      statement.principal,
      statement.rate,
      statement.interestMethod,
      statement.originalInterest,
      statement.currentAdjustedInterest,
      statement.startDate,
      statement.dueDate,
      statement.status,
      statement.remainingPrincipal,
      statement.remainingInterest,
    ],
  ];

  const tableHeaders = [
    "Date",
    "Event",
    "Description",
    "Reference",
    "Cash Amount",
    "Cash Direction",
    "Principal Alloc",
    "Interest Alloc",
    "Fees Alloc",
    "Adjustment Delta",
    "Running Principal",
    "Running Interest",
    "Running Total Owed",
  ];

  const tableRows: (string | null)[][] = [];
  if (statement.openingBalance) {
    tableRows.push([
      statement.openingBalance.date,
      "OPENING_BALANCE",
      `Opening Balance as of ${statement.openingBalance.date}`,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      statement.openingBalance.principal,
      statement.openingBalance.interest,
      statement.openingBalance.totalOwed,
    ]);
  }
  for (const e of statement.entries) {
    tableRows.push([
      e.date,
      e.eventType,
      e.description,
      e.reference || "",
      e.cashAmount || "",
      e.cashDirection || "",
      e.principalAllocation,
      e.interestAllocation,
      e.feesAllocation,
      e.adjustmentDelta || "",
      e.runningPrincipal,
      e.runningInterest,
      e.runningTotalOwed,
    ]);
  }

  const metaCsv = toCsv(metaHeaders, metaRows);
  const tableCsv = toCsv(tableHeaders, tableRows);

  return `${metaCsv}\r\n\r\n${tableCsv}`;
}

/**
 * Generates safe CSV for Capital Pool Statement.
 */
export function exportPoolStatementCsv(pool: PoolStatement): string {
  const headers = [
    "Date",
    "Type",
    "Direction",
    "Amount",
    "Counterparty",
    "Reference",
    "Running Pool Balance",
  ];
  const rows: (string | null)[][] = [];
  if (pool.openingBalance !== undefined) {
    rows.push([
      pool.entries[0]?.date || pool.asOfDate,
      "OPENING_BALANCE",
      "NONE",
      "0",
      "Prior Ledger Movements",
      "",
      pool.openingBalance,
    ]);
  }
  for (const e of pool.entries) {
    rows.push([
      e.date,
      e.type,
      e.direction,
      e.amount,
      e.counterparty,
      e.reference || "",
      e.runningBalance,
    ]);
  }
  return toCsv(headers, rows);
}

/**
 * Generates safe CSV for Financial Position Summary.
 */
export function exportSummaryCsv(s: FinancialPositionSummary): string {
  const headers = ["Metric", "Value", "Notes"];
  const rows = [
    ["As Of Date", s.asOfDate, "Report generation date"],
    ["Own Capital Injected (Equity)", s.ownCapitalInjected, "Owner capital balance"],
    ["Gross Principal Lent", s.principalLent.grossDisbursed, "Total principal disbursed to borrowers"],
    ["Principal Recovered", s.principalLent.principalRecovered, "Principal returned by borrowers (Not income)"],
    ["Outstanding Principal Lent", s.principalLent.outstandingPrincipal, "Active capital currently with borrowers"],
    ["Active Loans Count", String(s.principalLent.activeLoanCount), ""],
    ["Gross Principal Borrowed", s.principalBorrowed.grossBorrowed, "Total capital borrowed from lenders"],
    ["Principal Repaid to Lenders", s.principalBorrowed.principalRepaid, "Principal repaid to lenders (Not expense)"],
    ["Outstanding Borrowing Liability", s.principalBorrowed.outstandingLiability, "Current debt owed to lenders"],
    ["Active Borrowings Count", String(s.principalBorrowed.activeBorrowingCount), ""],
    ["Borrower Interest Received", s.interest.borrowerInterestReceived, "Net actual interest cash received from borrowers"],
    ["Lender Interest Paid", s.interest.lenderInterestPaid, "Net actual interest cash paid out to lenders"],
    ["Net Interest Spread", s.interest.netInterestSpread, "Net earned interest (Received - Paid)"],
    ["Available Pool Cash", s.poolCash.availableBalance, "Derived from sum(IN) - sum(OUT)"],
    ["Total Pool Inflow", s.poolCash.totalInflow, "Total cash entering pool"],
    ["Total Pool Outflow", s.poolCash.totalOutflow, "Total cash leaving pool"],
  ];
  return toCsv(headers, rows);
}
