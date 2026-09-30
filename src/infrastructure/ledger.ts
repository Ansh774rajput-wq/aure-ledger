import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import type {
  DisbursementGateway,
  ValidatedLoan,
} from "../application/disburse";
import type {
  BorrowingGateway,
  ValidatedBorrowing,
} from "../application/borrow";
import type {
  RepaymentGateway,
  ValidatedRepayment,
  RepaymentResult,
} from "../application/repay";
import type {
  LenderRepaymentGateway,
  ValidatedLenderRepayment,
  LenderRepaymentResult,
} from "../application/repay-lender";
import type {
  SettlementGateway,
  ValidatedSettlementPreview,
  ValidatedSettlementExecution,
  SettlementPreviewResult,
  SettlementExecutionResult,
} from "../application/settle";
import type {
  PaymentReversalGateway,
  ValidatedPaymentReversal,
  PaymentReversalResult,
} from "../application/reverse";
import type { ReconciliationGateway } from "../application/reconcile";
import type {
  ActivityEntry,
  AgreementStatement,
  PoolStatement,
  FinancialPositionSummary,
  StatementEntry,
  PoolStatementEntry,
} from "../application/reports";
import {
  checkReconciliation,
  ReconciliationDataset,
  ReconciliationResult,
} from "../domain/reconciliation";
import {
  asDate,
  D,
  RuleError,
  date,
  money,
  businessDate,
  allocate,
  adjustedInterest,
  days,
  term,
  payable,
} from "../domain/finance";
import { z } from "zod";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
type Tx = Prisma.TransactionClient;
export interface AuditWriter {
  write(
    tx: Tx,
    action: string,
    entityId: string,
    actor: string,
    payload: Prisma.InputJsonValue,
  ): Promise<void>;
}
export const transactionalAudit: AuditWriter = {
  async write(tx, action, entityId, performedBy, payload) {
    await tx.auditLog.create({
      data: { action, entityId, performedBy, payload },
    });
  },
};
async function lock(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(67421901::bigint)`;
}
async function chronology(tx: Tx, transactionDate: string) {
  if (transactionDate > businessDate())
    throw new RuleError("Future cash movements cannot be posted.");
  const latest = await tx.poolTransaction.findFirst({
    orderBy: { transactionDate: "desc" },
    select: { transactionDate: true },
  });
  if (
    latest &&
    transactionDate < latest.transactionDate.toISOString().slice(0, 10)
  )
    throw new RuleError(
      "Date cannot precede the latest pool movement. Backdated reconciliation is not supported yet.",
    );
}
export async function poolBalance(tx: Tx) {
  const totals = await tx.poolTransaction.groupBy({
    by: ["direction"],
    _sum: { amount: true },
  });
  return totals.reduce(
    (v, r) =>
      r.direction === "IN"
        ? v.plus(r._sum.amount?.toString() ?? "0")
        : v.minus(r._sum.amount?.toString() ?? "0"),
    new D(0),
  );
}
async function warnings(tx: Tx, reference?: string) {
  return reference && (await tx.poolTransaction.count({ where: { reference } }))
    ? ["This reference already exists. Review it for a possible duplicate."]
    : [];
}
export class PrismaDisbursementGateway implements DisbursementGateway {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditWriter = transactionalAudit,
  ) {}
  async disburse(r: ValidatedLoan) {
    const requestHash = hash(r);
    return this.db.$transaction(
      async (tx) => {
        await lock(tx);
        const existing = await tx.loan.findUnique({
          where: { idempotencyKey: r.idempotencyKey },
          include: { movements: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new RuleError(
              "This submission key was already used for different details.",
            );
          return {
            loanId: existing.id,
            poolTransactionId: existing.movements[0].id,
            warnings: ["Already recorded. No second disbursement was made."],
            replayed: true,
          };
        }
        await chronology(tx, r.startDate);
        if ((await poolBalance(tx)).lt(r.principal))
          throw new RuleError(
            "Insufficient available capital. Add capital before disbursing this loan.",
          );
        const notices = await warnings(tx, r.reference);
        const loan = await tx.loan.create({
          data: {
            borrowerProfileId: r.borrowerProfileId,
            principal: r.principal,
            rate: r.rate,
            interestMethod: r.interestMethod,
            startDate: asDate(r.startDate),
            dueDate: asDate(r.dueDate),
            originalInterest: r.originalInterest,
            performedBy: r.performedBy,
            idempotencyKey: r.idempotencyKey,
            requestHash,
          },
        });
        const movement = await tx.poolTransaction.create({
          data: {
            direction: "OUT",
            type: "LOAN_DISBURSEMENT_OUT",
            amount: r.principal,
            loanId: loan.id,
            borrowingId: null,
            transactionDate: asDate(r.startDate),
            reference: r.reference,
            performedBy: r.performedBy,
          },
        });
        await this.audit.write(tx, "LOAN_DISBURSED", loan.id, r.performedBy, {
          ...r,
          poolTransactionId: movement.id,
        });
        return {
          loanId: loan.id,
          poolTransactionId: movement.id,
          warnings: notices,
          replayed: false,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10000,
        timeout: 15000,
      },
    );
  }
}
export class PrismaBorrowingGateway implements BorrowingGateway {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditWriter = transactionalAudit,
  ) {}
  async receive(r: ValidatedBorrowing) {
    const requestHash = hash(r);
    return this.db.$transaction(
      async (tx) => {
        await lock(tx);
        const existing = await tx.borrowing.findUnique({
          where: { idempotencyKey: r.idempotencyKey },
          include: { movements: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new RuleError(
              "This submission key was already used for different details.",
            );
          return {
            borrowingId: existing.id,
            poolTransactionId: existing.movements[0].id,
            warnings: ["Already recorded. No second borrowing was made."],
            replayed: true,
          };
        }
        await chronology(tx, r.startDate);
        const notices = await warnings(tx, r.reference);
        const borrowing = await tx.borrowing.create({
          data: {
            lenderProfileId: r.lenderProfileId,
            principal: r.principal,
            rate: r.rate,
            interestMethod: r.interestMethod,
            startDate: asDate(r.startDate),
            dueDate: asDate(r.dueDate),
            originalInterest: r.originalInterest,
            performedBy: r.performedBy,
            idempotencyKey: r.idempotencyKey,
            requestHash,
            status: "ACTIVE",
          },
        });
        const movement = await tx.poolTransaction.create({
          data: {
            direction: "IN",
            type: "BORROWING_RECEIVED_IN",
            amount: r.principal,
            borrowingId: borrowing.id,
            loanId: null,
            transactionDate: asDate(r.startDate),
            reference: r.reference,
            performedBy: r.performedBy,
          },
        });
        await this.audit.write(
          tx,
          "BORROWING_RECEIVED",
          borrowing.id,
          r.performedBy,
          {
            ...r,
            poolTransactionId: movement.id,
          },
        );
        return {
          borrowingId: borrowing.id,
          poolTransactionId: movement.id,
          warnings: notices,
          replayed: false,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10000,
        timeout: 15000,
      },
    );
  }
}
export class PrismaRepaymentGateway implements RepaymentGateway {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditWriter = transactionalAudit,
  ) {}
  async repay(r: ValidatedRepayment): Promise<RepaymentResult> {
    const requestHash = hash(r);
    return this.db.$transaction(
      async (tx) => {
        await lock(tx);
        // 1. Idempotency check FIRST
        const existing = await tx.payment.findUnique({
          where: { idempotencyKey: r.idempotencyKey },
          include: { movements: true },
        });
        if (existing) {
          if (
            existing.requestHash !== requestHash ||
            existing.loanId !== r.loanId
          ) {
            throw new RuleError(
              "This submission key was already used for different details.",
            );
          }
          const loan = await tx.loan.findUniqueOrThrow({
            where: { id: existing.loanId! },
            include: {
              payments: { include: { reversal: true } },
              adjustments: true,
            },
          });
          const activePayments = loan.payments.filter((p) => !p.reversal);
          const paidPrincipal = activePayments.reduce(
            (s, p) => s.plus(p.principal.toString()),
            new D(0),
          );
          const remainingPrincipal = D.max(
            new D(0),
            new D(loan.principal.toString()).minus(paidPrincipal),
          ).toFixed(0);
          const paidInterest = activePayments.reduce(
            (s, p) => s.plus(p.interest.toString()),
            new D(0),
          );
          const totalAgreedInterest = adjustedInterest(
            loan.originalInterest.toString(),
            loan.adjustments.map((a) => ({
              amount: a.amount.toString(),
              reason: a.reason,
            })),
            paidInterest.toString(),
          );
          const remainingInterest = D.max(
            new D(0),
            totalAgreedInterest.minus(paidInterest),
          ).toFixed(0);
          return {
            paymentId: existing.id,
            poolTransactionId: existing.movements[0]?.id ?? "",
            allocation: {
              fees: existing.fees.toFixed(0),
              interest: existing.interest.toFixed(0),
              principal: existing.principal.toFixed(0),
            },
            remainingPrincipal,
            remainingInterest,
            settled: loan.status === "CLOSED",
            warnings: ["Already recorded. No second repayment was made."],
            replayed: true,
          };
        }

        // 2. Fetch loan under lock
        const loan = await tx.loan.findUnique({
          where: { id: r.loanId },
          include: {
            payments: { include: { reversal: true } },
            adjustments: true,
          },
        });
        if (!loan) throw new RuleError("Loan not found.");
        if (loan.status !== "ACTIVE") {
          throw new RuleError("Loan is not active.");
        }

        // 3. Chronology
        const loanStartStr = loan.startDate.toISOString().slice(0, 10);
        if (r.paymentDate < loanStartStr) {
          throw new RuleError("Payment date cannot precede the loan start date.");
        }
        await chronology(tx, r.paymentDate);

        // 4. Calculate current outstanding obligations (excluding reversed payments)
        const activePayments = loan.payments.filter((p) => !p.reversal);
        const paidFees = activePayments.reduce(
          (s, p) => s.plus(p.fees.toString()),
          new D(0),
        );
        const paidInterest = activePayments.reduce(
          (s, p) => s.plus(p.interest.toString()),
          new D(0),
        );
        const paidPrincipal = activePayments.reduce(
          (s, p) => s.plus(p.principal.toString()),
          new D(0),
        );
        const outstandingPrincipal = new D(loan.principal.toString()).minus(
          paidPrincipal,
        );
        const totalAgreedInterest = adjustedInterest(
          loan.originalInterest.toString(),
          loan.adjustments.map((a) => ({
            amount: a.amount.toString(),
            reason: a.reason,
          })),
          paidInterest.toString(),
        );
        const outstandingInterest = totalAgreedInterest.minus(paidInterest);
        const totalOutstanding = outstandingInterest.plus(outstandingPrincipal);

        // 5. Check overpayment
        const paymentAmount = new D(r.amount);
        if (paymentAmount.gt(totalOutstanding)) {
          throw new RuleError("Payment exceeds outstanding amount.");
        }

        // 6. Allocate fees -> interest -> principal
        const allocation = allocate(
          r.amount,
          "0",
          outstandingInterest.toFixed(0),
          outstandingPrincipal.toFixed(0),
        );

        // 7. Duplicate reference warning
        const notices = await warnings(tx, r.reference);

        // 8. Create Payment
        const payment = await tx.payment.create({
          data: {
            loanId: loan.id,
            amount: paymentAmount,
            fees: new D(allocation.fees),
            interest: new D(allocation.interest),
            principal: new D(allocation.principal),
            transactionDate: new Date(`${r.paymentDate}T00:00:00.000Z`),
            reference: r.reference || null,
            performedBy: r.performedBy,
            idempotencyKey: r.idempotencyKey,
            requestHash,
          },
        });

        // 9. Create PoolTransaction (IN: BORROWER_REPAYMENT_IN)
        const poolTx = await tx.poolTransaction.create({
          data: {
            direction: "IN",
            type: "BORROWER_REPAYMENT_IN",
            amount: paymentAmount,
            transactionDate: new Date(`${r.paymentDate}T00:00:00.000Z`),
            loanId: loan.id,
            paymentId: payment.id,
            borrowingId: null,
            equityEntryId: null,
            reference: r.reference || null,
            performedBy: r.performedBy,
          },
        });

        // 10. Settlement check
        const newRemainingPrincipal = outstandingPrincipal.minus(
          allocation.principal,
        );
        const newRemainingInterest = outstandingInterest.minus(
          allocation.interest,
        );
        let settled = false;
        if (newRemainingPrincipal.isZero() && newRemainingInterest.isZero()) {
          await tx.loan.update({
            where: { id: loan.id },
            data: { status: "CLOSED" },
          });
          settled = true;
        }

        // 11. Transactional audit log
        await this.audit.write(
          tx,
          "BORROWER_REPAYMENT",
          payment.id,
          r.performedBy,
          {
            loanId: loan.id,
            paymentId: payment.id,
            amount: r.amount,
            fees: allocation.fees,
            interest: allocation.interest,
            principal: allocation.principal,
            remainingPrincipal: newRemainingPrincipal.toFixed(0),
            remainingInterest: newRemainingInterest.toFixed(0),
            settled,
            reference: r.reference || null,
          },
        );

        return {
          paymentId: payment.id,
          poolTransactionId: poolTx.id,
          allocation,
          remainingPrincipal: newRemainingPrincipal.toFixed(0),
          remainingInterest: newRemainingInterest.toFixed(0),
          settled,
          warnings: notices,
          replayed: false,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10000,
        timeout: 15000,
      },
    );
  }
}

export class PrismaLenderRepaymentGateway implements LenderRepaymentGateway {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditWriter = transactionalAudit,
  ) {}

  async repayLender(r: ValidatedLenderRepayment): Promise<LenderRepaymentResult> {
    const requestHash = hash(r);
    return this.db.$transaction(
      async (tx) => {
        await lock(tx);

        // 1. Idempotency check FIRST (precedes status/balance checks)
        const existing = await tx.payment.findUnique({
          where: { idempotencyKey: r.idempotencyKey },
          include: { movements: true },
        });
        if (existing) {
          if (
            existing.requestHash !== requestHash ||
            existing.borrowingId !== r.borrowingId
          ) {
            throw new RuleError(
              "This submission key was already used for different details.",
            );
          }
          const borrowing = await tx.borrowing.findUniqueOrThrow({
            where: { id: existing.borrowingId! },
            include: {
              payments: { include: { reversal: true } },
              adjustments: true,
            },
          });
          const activePayments = borrowing.payments.filter((p) => !p.reversal);
          const paidPrincipal = activePayments.reduce(
            (s, p) => s.plus(p.principal.toString()),
            new D(0),
          );
          const remainingPrincipal = D.max(
            new D(0),
            new D(borrowing.principal.toString()).minus(paidPrincipal),
          ).toFixed(0);
          const paidInterest = activePayments.reduce(
            (s, p) => s.plus(p.interest.toString()),
            new D(0),
          );
          const totalAgreedInterest = adjustedInterest(
            borrowing.originalInterest.toString(),
            borrowing.adjustments.map((a) => ({
              amount: a.amount.toString(),
              reason: a.reason,
            })),
            paidInterest.toString(),
          );
          const remainingInterest = D.max(
            new D(0),
            totalAgreedInterest.minus(paidInterest),
          ).toFixed(0);
          return {
            paymentId: existing.id,
            poolTransactionId: existing.movements[0]?.id ?? "",
            allocation: {
              fees: existing.fees.toFixed(0),
              interest: existing.interest.toFixed(0),
              principal: existing.principal.toFixed(0),
            },
            remainingPrincipal,
            remainingInterest,
            settled: borrowing.status === "CLOSED",
            warnings: ["Already recorded. No second repayment was made."],
            replayed: true,
          };
        }

        // 2. Fetch borrowing under lock
        const borrowing = await tx.borrowing.findUnique({
          where: { id: r.borrowingId },
          include: {
            payments: { include: { reversal: true } },
            adjustments: true,
          },
        });
        if (!borrowing) throw new RuleError("Borrowing not found.");
        if (borrowing.status !== "ACTIVE") {
          throw new RuleError("Borrowing is not active.");
        }

        // 3. Chronology
        const borrowingStartStr = borrowing.startDate.toISOString().slice(0, 10);
        if (r.paymentDate < borrowingStartStr) {
          throw new RuleError("Payment date cannot precede the borrowing start date.");
        }
        await chronology(tx, r.paymentDate);

        // 4. Calculate current outstanding obligations (excluding reversed payments)
        const activePayments = borrowing.payments.filter((p) => !p.reversal);
        const paidFees = activePayments.reduce(
          (s, p) => s.plus(p.fees.toString()),
          new D(0),
        );
        const paidInterest = activePayments.reduce(
          (s, p) => s.plus(p.interest.toString()),
          new D(0),
        );
        const paidPrincipal = activePayments.reduce(
          (s, p) => s.plus(p.principal.toString()),
          new D(0),
        );
        const outstandingPrincipal = new D(borrowing.principal.toString()).minus(
          paidPrincipal,
        );
        const totalAgreedInterest = adjustedInterest(
          borrowing.originalInterest.toString(),
          borrowing.adjustments.map((a) => ({
            amount: a.amount.toString(),
            reason: a.reason,
          })),
          paidInterest.toString(),
        );
        const outstandingInterest = totalAgreedInterest.minus(paidInterest);
        const totalOutstanding = outstandingInterest.plus(outstandingPrincipal);

        // 5. Check overpayment
        const paymentAmount = new D(r.amount);
        if (paymentAmount.gt(totalOutstanding)) {
          throw new RuleError("Payment exceeds outstanding amount.");
        }

        // 6. Check available pool cash under lock
        const poolCash = await poolBalance(tx);
        if (paymentAmount.gt(poolCash)) {
          throw new RuleError("Payment exceeds available pool cash.");
        }

        // 7. Allocate fees -> interest -> principal
        const allocation = allocate(
          r.amount,
          "0",
          outstandingInterest.toFixed(0),
          outstandingPrincipal.toFixed(0),
        );

        // 8. Duplicate reference warning
        const notices = await warnings(tx, r.reference);

        // 9. Create Payment (linked to borrowingId, loanId null)
        const payment = await tx.payment.create({
          data: {
            borrowingId: borrowing.id,
            loanId: null,
            amount: paymentAmount,
            fees: new D(allocation.fees),
            interest: new D(allocation.interest),
            principal: new D(allocation.principal),
            transactionDate: new Date(`${r.paymentDate}T00:00:00.000Z`),
            reference: r.reference || null,
            performedBy: r.performedBy,
            idempotencyKey: r.idempotencyKey,
            requestHash,
          },
        });

        // 10. Create PoolTransaction (OUT: LENDER_REPAYMENT_OUT)
        const poolTx = await tx.poolTransaction.create({
          data: {
            direction: "OUT",
            type: "LENDER_REPAYMENT_OUT",
            amount: paymentAmount,
            transactionDate: new Date(`${r.paymentDate}T00:00:00.000Z`),
            borrowingId: borrowing.id,
            paymentId: payment.id,
            loanId: null,
            equityEntryId: null,
            reference: r.reference || null,
            performedBy: r.performedBy,
          },
        });

        // 11. Settlement check
        const newRemainingPrincipal = outstandingPrincipal.minus(
          allocation.principal,
        );
        const newRemainingInterest = outstandingInterest.minus(
          allocation.interest,
        );
        let settled = false;
        if (newRemainingPrincipal.isZero() && newRemainingInterest.isZero()) {
          await tx.borrowing.update({
            where: { id: borrowing.id },
            data: { status: "CLOSED" },
          });
          settled = true;
        }

        // 12. Transactional audit log
        await this.audit.write(
          tx,
          "LENDER_REPAYMENT",
          payment.id,
          r.performedBy,
          {
            borrowingId: borrowing.id,
            paymentId: payment.id,
            amount: r.amount,
            fees: allocation.fees,
            interest: allocation.interest,
            principal: allocation.principal,
            remainingPrincipal: newRemainingPrincipal.toFixed(0),
            remainingInterest: newRemainingInterest.toFixed(0),
            settled,
            reference: r.reference || null,
          },
        );

        return {
          paymentId: payment.id,
          poolTransactionId: poolTx.id,
          allocation,
          remainingPrincipal: newRemainingPrincipal.toFixed(0),
          remainingInterest: newRemainingInterest.toFixed(0),
          settled,
          warnings: notices,
          replayed: false,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10000,
        timeout: 15000,
      },
    );
  }
}

export class PrismaSettlementGateway implements SettlementGateway {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditWriter = transactionalAudit,
  ) {}

  async preview(
    r: ValidatedSettlementPreview,
  ): Promise<SettlementPreviewResult> {
    return this.db.$transaction(
      async (tx) => {
        let counterpartyName = "";
        let agreement: {
          id: string;
          principal: InstanceType<typeof D> | Prisma.Decimal;
          originalInterest: InstanceType<typeof D> | Prisma.Decimal;
          startDate: Date;
          dueDate: Date;
          status: string;
          payments: {
            id: string;
            amount: Prisma.Decimal;
            principal: Prisma.Decimal;
            interest: Prisma.Decimal;
            fees: Prisma.Decimal;
            transactionDate: Date;
            reference: string | null;
            reversal: { id: string } | null;
          }[];
          adjustments: {
            id: string;
            amount: Prisma.Decimal;
            reason: string;
            createdAt: Date;
            performedBy: string;
          }[];
        };

        if (r.agreementType === "LOAN") {
          const loan = await tx.loan.findUnique({
            where: { id: r.agreementId },
            include: {
              payments: { include: { reversal: true } },
              adjustments: true,
              borrower: { include: { person: true } },
            },
          });
          if (!loan) throw new RuleError("Loan not found.");
          agreement = loan;
          counterpartyName = loan.borrower.person.name;
        } else {
          const borrowing = await tx.borrowing.findUnique({
            where: { id: r.agreementId },
            include: {
              payments: { include: { reversal: true } },
              adjustments: true,
              lender: { include: { person: true } },
            },
          });
          if (!borrowing) throw new RuleError("Borrowing not found.");
          agreement = borrowing;
          counterpartyName = borrowing.lender.person.name;
        }

        if (agreement.status !== "ACTIVE") {
          throw new RuleError(
            `Agreement is ${agreement.status.toLowerCase()} and cannot be settled.`,
          );
        }

        const startDateStr = agreement.startDate.toISOString().slice(0, 10);
        const dueDateStr = agreement.dueDate.toISOString().slice(0, 10);

        if (r.settlementDate < startDateStr) {
          throw new RuleError(
            "Settlement date cannot precede the agreement start date.",
          );
        }
        if (r.settlementDate >= dueDateStr) {
          throw new RuleError(
            "Early closure applies strictly before the due date. On or after due date, use standard contractual settlement without early closure discounts.",
          );
        }

        const latest = await tx.poolTransaction.findFirst({
          orderBy: { transactionDate: "desc" },
          select: { transactionDate: true },
        });
        if (
          latest &&
          r.settlementDate < latest.transactionDate.toISOString().slice(0, 10)
        ) {
          throw new RuleError(
            "Date cannot precede the latest pool movement. Backdated reconciliation is not supported yet.",
          );
        }

        const elapsedDays = days(startDateStr, r.settlementDate);
        const termDays = term(startDateStr, dueDateStr);
        const originalInterest = agreement.originalInterest.toString();
        const suggestedTotalInterest = payable(
          money(originalInterest).mul(elapsedDays).div(termDays),
        ).toFixed(0);

        const activePayments = agreement.payments.filter((p) => !p.reversal);
        const paidPrincipal = activePayments.reduce(
          (s, p) => s.plus(p.principal.toString()),
          new D(0),
        );
        const outstandingPrincipal = D.max(
          new D(0),
          new D(agreement.principal.toString()).minus(paidPrincipal),
        ).toFixed(0);

        const paidInterest = activePayments.reduce(
          (s, p) => s.plus(p.interest.toString()),
          new D(0),
        );
        const currentAdjustedInterest = adjustedInterest(
          originalInterest,
          agreement.adjustments.map((a) => ({
            amount: a.amount.toString(),
            reason: a.reason,
          })),
          paidInterest.toString(),
        ).toFixed(0);

        const suggestedPayoff = payable(
          new D(outstandingPrincipal)
            .plus(suggestedTotalInterest)
            .minus(paidInterest),
        ).toFixed(0);

        const currentPayoff = payable(
          new D(outstandingPrincipal)
            .plus(currentAdjustedInterest)
            .minus(paidInterest),
        ).toFixed(0);

        const poolCash = await poolBalance(tx);

        const quoteBalanceHash = hash({
          agreementId: r.agreementId,
          agreementType: r.agreementType,
          settlementDate: r.settlementDate,
          originalInterest,
          currentAdjustedInterest,
          outstandingPrincipal,
          paidInterest: paidInterest.toFixed(0),
          paymentsCount: activePayments.length,
          paymentFingerprint: activePayments.map((p) => p.id).join(","),
          adjustmentsCount: agreement.adjustments.length,
          startDate: startDateStr,
          dueDate: dueDateStr,
        });

        return {
          agreementId: r.agreementId,
          agreementType: r.agreementType,
          counterpartyName,
          startDate: startDateStr,
          dueDate: dueDateStr,
          settlementDate: r.settlementDate,
          originalPrincipal: agreement.principal.toFixed(0),
          originalInterest,
          elapsedDays,
          termDays,
          suggestedTotalInterest,
          currentAdjustedInterest,
          interestPaid: paidInterest.toFixed(0),
          principalPaid: paidPrincipal.toFixed(0),
          outstandingPrincipal,
          existingAdjustments: agreement.adjustments.map((a) => ({
            id: a.id,
            amount: a.amount.toFixed(0),
            reason: a.reason,
            createdAt: a.createdAt.toISOString(),
            performedBy: a.performedBy,
          })),
          suggestedPayoff,
          currentPayoff,
          availablePoolCash: poolCash.toFixed(0),
          quoteBalanceHash,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async settle(
    r: ValidatedSettlementExecution,
  ): Promise<SettlementExecutionResult> {
    const requestHash = hash(r);
    return this.db.$transaction(
      async (tx) => {
        await lock(tx);

        // 1. Idempotency check FIRST
        const existing = await tx.settlementOperation.findUnique({
          where: { idempotencyKey: r.idempotencyKey },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new RuleError(
              "This submission key was already used for different details.",
            );
          }
          let poolTxId: string | null = null;
          if (existing.paymentId) {
            const p = await tx.payment.findUnique({
              where: { id: existing.paymentId },
              include: { movements: true },
            });
            poolTxId = p?.movements[0]?.id ?? null;
          }
          return {
            settled: true,
            agreementId: (existing.loanId ?? existing.borrowingId)!,
            agreementType: r.agreementType,
            adjustmentId: existing.adjustmentId,
            paymentId: existing.paymentId,
            poolTransactionId: poolTxId,
            adjustmentDelta: existing.adjustmentDelta.toFixed(0),
            finalTotalInterest: existing.finalTotalInterest.toFixed(0),
            payoffAmount: existing.payoffAmount.toFixed(0),
            decision: r.decision,
            replayed: true,
            warnings: ["Already recorded. No second settlement was made."],
          };
        }

        // 2. Fetch agreement under lock
        let agreement: {
          id: string;
          principal: InstanceType<typeof D> | Prisma.Decimal;
          originalInterest: InstanceType<typeof D> | Prisma.Decimal;
          startDate: Date;
          dueDate: Date;
          status: string;
          payments: {
            id: string;
            amount: Prisma.Decimal;
            principal: Prisma.Decimal;
            interest: Prisma.Decimal;
            fees: Prisma.Decimal;
            transactionDate: Date;
            reference: string | null;
            reversal: { id: string } | null;
          }[];
          adjustments: {
            id: string;
            amount: Prisma.Decimal;
            reason: string;
            createdAt: Date;
            performedBy: string;
          }[];
        };

        if (r.agreementType === "LOAN") {
          const loan = await tx.loan.findUnique({
            where: { id: r.agreementId },
            include: {
              payments: { include: { reversal: true } },
              adjustments: true,
              borrower: { include: { person: true } },
            },
          });
          if (!loan) throw new RuleError("Loan not found.");
          agreement = loan;
        } else {
          const borrowing = await tx.borrowing.findUnique({
            where: { id: r.agreementId },
            include: {
              payments: { include: { reversal: true } },
              adjustments: true,
              lender: { include: { person: true } },
            },
          });
          if (!borrowing) throw new RuleError("Borrowing not found.");
          agreement = borrowing;
        }

        if (agreement.status !== "ACTIVE") {
          throw new RuleError(
            "Agreement is not active or has already been settled.",
          );
        }

        const startDateStr = agreement.startDate.toISOString().slice(0, 10);
        const dueDateStr = agreement.dueDate.toISOString().slice(0, 10);

        if (r.settlementDate < startDateStr) {
          throw new RuleError(
            "Settlement date cannot precede the agreement start date.",
          );
        }
        if (r.settlementDate >= dueDateStr) {
          throw new RuleError(
            "Early closure applies strictly before the due date. On or after due date, use standard contractual settlement without early closure discounts.",
          );
        }

        await chronology(tx, r.settlementDate);

        // 3. Stale quote check
        const elapsedDays = days(startDateStr, r.settlementDate);
        const termDays = term(startDateStr, dueDateStr);
        const originalInterest = agreement.originalInterest.toString();
        const suggestedTotalInterest = payable(
          money(originalInterest).mul(elapsedDays).div(termDays),
        ).toFixed(0);

        const activePayments = agreement.payments.filter((p) => !p.reversal);
        const paidPrincipal = activePayments.reduce(
          (s, p) => s.plus(p.principal.toString()),
          new D(0),
        );
        const outstandingPrincipal = D.max(
          new D(0),
          new D(agreement.principal.toString()).minus(paidPrincipal),
        );

        const paidInterest = activePayments.reduce(
          (s, p) => s.plus(p.interest.toString()),
          new D(0),
        );
        const currentAdjustedInterest = adjustedInterest(
          originalInterest,
          agreement.adjustments.map((a) => ({
            amount: a.amount.toString(),
            reason: a.reason,
          })),
          paidInterest.toString(),
        ).toFixed(0);

        const currentBalanceHash = hash({
          agreementId: r.agreementId,
          agreementType: r.agreementType,
          settlementDate: r.settlementDate,
          originalInterest,
          currentAdjustedInterest,
          outstandingPrincipal: outstandingPrincipal.toFixed(0),
          paidInterest: paidInterest.toFixed(0),
          paymentsCount: activePayments.length,
          paymentFingerprint: activePayments.map((p) => p.id).join(","),
          adjustmentsCount: agreement.adjustments.length,
          startDate: startDateStr,
          dueDate: dueDateStr,
        });

        if (currentBalanceHash !== r.quoteBalanceHash) {
          throw new RuleError(
            "Agreement balances or payments have changed since the preview quote was calculated. Please refresh the quote before confirming settlement.",
          );
        }

        // 4. Decision determination
        let finalTotalInterest: InstanceType<typeof D>;
        if (r.decision === "SUGGESTED") {
          finalTotalInterest = new D(suggestedTotalInterest);
        } else if (r.decision === "RETAIN_CURRENT") {
          finalTotalInterest = new D(currentAdjustedInterest);
        } else {
          finalTotalInterest = money(r.manualFinalTotalInterest!, {
            positive: false,
            whole: true,
          });
        }

        if (finalTotalInterest.lt(0)) {
          throw new RuleError("Final total interest cannot be negative.");
        }
        if (finalTotalInterest.lt(paidInterest)) {
          throw new RuleError(
            `Final total interest cannot be less than interest already paid (₹${paidInterest.toFixed(0)}). A valid owner-selected total must be at least ₹${paidInterest.toFixed(0)}.`,
          );
        }

        // 5. Signed delta
        const adjustmentDelta = finalTotalInterest.minus(currentAdjustedInterest);

        // 6. Remaining payoff
        const remainingInterestDue = finalTotalInterest.minus(paidInterest);
        const remainingPayoff = outstandingPrincipal.plus(remainingInterestDue);

        // 7. Lender pool cash check
        if (r.agreementType === "BORROWING" && remainingPayoff.gt(0)) {
          const poolCash = await poolBalance(tx);
          if (remainingPayoff.gt(poolCash)) {
            throw new RuleError(
              "Insufficient available pool funds to settle this borrowing.",
            );
          }
        }

        const notices = await warnings(tx, r.reference);

        // 8. Create InterestAdjustment when delta is nonzero
        let adjustmentRecord: Awaited<
          ReturnType<typeof tx.interestAdjustment.create>
        > | null = null;
        if (!adjustmentDelta.isZero()) {
          adjustmentRecord = await tx.interestAdjustment.create({
            data: {
              loanId: r.agreementType === "LOAN" ? agreement.id : null,
              borrowingId:
                r.agreementType === "BORROWING" ? agreement.id : null,
              amount: adjustmentDelta,
              reason: r.reason,
              performedBy: r.performedBy,
            },
          });
        }

        // 9. Create Payment and PoolTransaction when payoff is positive
        let paymentRecord: Awaited<
          ReturnType<typeof tx.payment.create>
        > | null = null;
        let poolTxRecord: Awaited<
          ReturnType<typeof tx.poolTransaction.create>
        > | null = null;

        if (remainingPayoff.gt(0)) {
          const paymentIdempotencyKey = `${r.idempotencyKey}:payment`;
          if (r.agreementType === "LOAN") {
            paymentRecord = await tx.payment.create({
              data: {
                loanId: agreement.id,
                borrowingId: null,
                amount: remainingPayoff,
                fees: new D(0),
                interest: remainingInterestDue,
                principal: outstandingPrincipal,
                transactionDate: asDate(r.settlementDate),
                reference: r.reference || null,
                performedBy: r.performedBy,
                idempotencyKey: paymentIdempotencyKey,
                requestHash,
              },
            });
            poolTxRecord = await tx.poolTransaction.create({
              data: {
                direction: "IN",
                type: "BORROWER_REPAYMENT_IN",
                amount: remainingPayoff,
                transactionDate: asDate(r.settlementDate),
                loanId: agreement.id,
                borrowingId: null,
                paymentId: paymentRecord.id,
                equityEntryId: null,
                reference: r.reference || null,
                performedBy: r.performedBy,
              },
            });
          } else {
            paymentRecord = await tx.payment.create({
              data: {
                borrowingId: agreement.id,
                loanId: null,
                amount: remainingPayoff,
                fees: new D(0),
                interest: remainingInterestDue,
                principal: outstandingPrincipal,
                transactionDate: asDate(r.settlementDate),
                reference: r.reference || null,
                performedBy: r.performedBy,
                idempotencyKey: paymentIdempotencyKey,
                requestHash,
              },
            });
            poolTxRecord = await tx.poolTransaction.create({
              data: {
                direction: "OUT",
                type: "LENDER_REPAYMENT_OUT",
                amount: remainingPayoff,
                transactionDate: asDate(r.settlementDate),
                borrowingId: agreement.id,
                loanId: null,
                paymentId: paymentRecord.id,
                equityEntryId: null,
                reference: r.reference || null,
                performedBy: r.performedBy,
              },
            });
          }
        }

        // 10. Update status to CLOSED
        if (r.agreementType === "LOAN") {
          await tx.loan.update({
            where: { id: agreement.id },
            data: { status: "CLOSED" },
          });
        } else {
          await tx.borrowing.update({
            where: { id: agreement.id },
            data: { status: "CLOSED" },
          });
        }

        // 11. Record SettlementOperation
        await tx.settlementOperation.create({
          data: {
            idempotencyKey: r.idempotencyKey,
            requestHash,
            loanId: r.agreementType === "LOAN" ? agreement.id : null,
            borrowingId:
              r.agreementType === "BORROWING" ? agreement.id : null,
            adjustmentId: adjustmentRecord?.id ?? null,
            paymentId: paymentRecord?.id ?? null,
            adjustmentDelta,
            payoffAmount: remainingPayoff,
            finalTotalInterest,
            settlementDate: asDate(r.settlementDate),
            performedBy: r.performedBy,
          },
        });

        // 12. Transactional audit log
        await this.audit.write(
          tx,
          r.agreementType === "LOAN"
            ? "LOAN_EARLY_SETTLED"
            : "BORROWING_EARLY_SETTLED",
          agreement.id,
          r.performedBy,
          {
            agreementId: agreement.id,
            agreementType: r.agreementType,
            decision: r.decision,
            reason: r.reason,
            settlementDate: r.settlementDate,
            originalInterest,
            suggestedTotalInterest,
            currentAdjustedInterest,
            finalTotalInterest: finalTotalInterest.toFixed(0),
            adjustmentDelta: adjustmentDelta.toFixed(0),
            adjustmentId: adjustmentRecord?.id ?? null,
            payoffAmount: remainingPayoff.toFixed(0),
            paymentId: paymentRecord?.id ?? null,
            poolTransactionId: poolTxRecord?.id ?? null,
            reference: r.reference || null,
          },
        );

        return {
          settled: true,
          agreementId: agreement.id,
          agreementType: r.agreementType,
          adjustmentId: adjustmentRecord?.id ?? null,
          paymentId: paymentRecord?.id ?? null,
          poolTransactionId: poolTxRecord?.id ?? null,
          adjustmentDelta: adjustmentDelta.toFixed(0),
          finalTotalInterest: finalTotalInterest.toFixed(0),
          payoffAmount: remainingPayoff.toFixed(0),
          decision: r.decision,
          replayed: false,
          warnings: notices,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10000,
        timeout: 15000,
      },
    );
  }
}

export async function addCapital(input: unknown, db: PrismaClient) {
  const r = z
    .object({
      amount: z.string(),
      transactionDate: z.string(),
      reason: z.string().trim().min(1).max(500),
      reference: z.string().trim().max(120).optional(),
      performedBy: z.string().trim().min(1).max(100),
      idempotencyKey: z.string().uuid(),
    })
    .strict()
    .parse(input);
  r.amount = money(r.amount, { positive: true, whole: true }).toFixed(0);
  date(r.transactionDate);
  const requestHash = hash(r);
  return db.$transaction(async (tx) => {
    await lock(tx);
    const existing = await tx.equityEntry.findUnique({
      where: { idempotencyKey: r.idempotencyKey },
    });
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new RuleError(
          "Submission key already used for different details.",
        );
      return {
        id: existing.id,
        warnings: ["Already recorded."],
        replayed: true,
      };
    }
    await chronology(tx, r.transactionDate);
    const notices = await warnings(tx, r.reference);
    const equity = await tx.equityEntry.create({
      data: {
        amount: r.amount,
        type: "ADDITION",
        transactionDate: asDate(r.transactionDate),
        reason: r.reason,
        performedBy: r.performedBy,
        idempotencyKey: r.idempotencyKey,
        requestHash,
      },
    });
    await tx.poolTransaction.create({
      data: {
        amount: r.amount,
        direction: "IN",
        type: "OWN_CAPITAL_IN",
        equityEntryId: equity.id,
        transactionDate: asDate(r.transactionDate),
        reference: r.reference || undefined,
        performedBy: r.performedBy,
      },
    });
    await transactionalAudit.write(
      tx,
      "CAPITAL_ADDED",
      equity.id,
      r.performedBy,
      { ...r },
    );
    return { id: equity.id, warnings: notices, replayed: false };
  });
}
export async function createPerson(input: unknown, db: PrismaClient) {
  const r = z
    .object({
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(30).optional(),
      role: z.enum(["BORROWER", "LENDER", "BOTH"]),
      personId: z.string().min(1).optional(),
      idempotencyKey: z.string().uuid(),
      performedBy: z.string().trim().min(1).max(100),
    })
    .strict()
    .parse(input);
  return db.$transaction(async (tx) => {
    await lock(tx);
    const requestHash = hash(r);
    const old = await tx.personOperation.findUnique({
      where: { idempotencyKey: r.idempotencyKey },
    });
    if (old) {
      if (old.requestHash !== requestHash)
        throw new RuleError(
          "Submission key already used for different details.",
        );
      return { id: old.personId, warnings: ["Already saved."] };
    }
    // Role assignment to an existing person preserves one human/one person record.
    const p = r.personId
      ? await tx.person.findUniqueOrThrow({ where: { id: r.personId } })
      : await tx.person.create({
          data: { name: r.name, phone: r.phone || null },
        });
    if (r.role !== "LENDER")
      await tx.borrowerProfile.upsert({
        where: { personId: p.id },
        create: { personId: p.id },
        update: {},
      });
    if (r.role !== "BORROWER")
      await tx.lenderProfile.upsert({
        where: { personId: p.id },
        create: { personId: p.id },
        update: {},
      });
    await tx.personOperation.create({
      data: { idempotencyKey: r.idempotencyKey, requestHash, personId: p.id },
    });
    await transactionalAudit.write(
      tx,
      "PERSON_ROLE_SAVED",
      p.id,
      r.performedBy,
      { role: r.role, name: p.name },
    );
    return { id: p.id, warnings: [] };
  });
}
export async function snapshot(db: PrismaClient) {
  return db.$transaction(async (tx) => {
    const balance = await poolBalance(tx);
    const people = await tx.person.findMany({
      include: { borrower: true, lender: true },
      orderBy: { name: "asc" },
    });
    const loans = await tx.loan.findMany({
      include: {
        borrower: { include: { person: true } },
        payments: {
          include: { reversal: true },
          orderBy: [
            { transactionDate: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
        },
        adjustments: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    const borrowings = await tx.borrowing.findMany({
      include: {
        lender: { include: { person: true } },
        payments: {
          include: { reversal: true },
          orderBy: [
            { transactionDate: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
        },
        adjustments: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    const activity = await tx.poolTransaction.findMany({
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

      const loansWithBalances = loans.map((l) => {
        const activePayments = l.payments.filter((p) => !p.reversal);
        const paidPrincipal = activePayments.reduce(
          (s, p) => s.plus(p.principal.toString()),
          new D(0),
        );
        const remainingPrincipal = D.max(
          new D(0),
          new D(l.principal.toString()).minus(paidPrincipal),
        ).toFixed(0);
        const paidInterest = activePayments.reduce(
          (s, p) => s.plus(p.interest.toString()),
          new D(0),
        );
        const totalAgreedInterest = adjustedInterest(
          l.originalInterest.toString(),
          l.adjustments.map((a) => ({
            amount: a.amount.toString(),
            reason: a.reason,
          })),
          paidInterest.toString(),
        );
        const remainingInterest = D.max(
          new D(0),
          totalAgreedInterest.minus(paidInterest),
        ).toFixed(0);

        const latestActivePaymentId = activePayments[0]?.id;

        return {
          id: l.id,
          name: l.borrower.person.name,
          principal: l.principal.toFixed(0),
          rate: l.rate.toString(),
          method: l.interestMethod,
          interest: l.originalInterest.toFixed(0),
          start: l.startDate.toISOString().slice(0, 10),
          due: l.dueDate.toISOString().slice(0, 10),
          status: l.status,
          remainingPrincipal,
          remainingInterest,
          payments: l.payments.map((p) => {
            const isLatest = p.id === latestActivePaymentId;
            let canReverse = false;
            let unsupportedReason: string | undefined;

            if (p.reversal) {
              unsupportedReason = "Payment has already been reversed.";
            } else if (l.status !== "ACTIVE") {
              unsupportedReason = "Closed agreements cannot be reopened; reversing settlement payments is unsupported.";
            } else if (!isLatest) {
              unsupportedReason = "Only the latest repayment on an active agreement can be safely reversed without corrupting allocation chronology.";
            } else {
              canReverse = true;
            }

            return {
              id: p.id,
              amount: p.amount.toFixed(0),
              fees: p.fees.toFixed(0),
              interest: p.interest.toFixed(0),
              principal: p.principal.toFixed(0),
              date: p.transactionDate.toISOString().slice(0, 10),
              reference: p.reference,
              reversed: Boolean(p.reversal),
              reversalDate: p.reversal ? p.reversal.reversalDate.toISOString().slice(0, 10) : null,
              reversalReason: p.reversal ? p.reversal.reason : null,
              canReverse,
              unsupportedReason,
            };
          }),
          adjustments: l.adjustments.map((a) => ({
            id: a.id,
            amount: a.amount.toFixed(0),
            reason: a.reason,
            createdAt: a.createdAt.toISOString(),
            performedBy: a.performedBy,
          })),
        };
      });

      const borrowingsWithBalances = borrowings.map((b) => {
        const activePayments = b.payments.filter((p) => !p.reversal);
        const paidPrincipal = activePayments.reduce(
          (s, p) => s.plus(p.principal.toString()),
          new D(0),
        );
        const remainingPrincipal = D.max(
          new D(0),
          new D(b.principal.toString()).minus(paidPrincipal),
        ).toFixed(0);
        const paidInterest = activePayments.reduce(
          (s, p) => s.plus(p.interest.toString()),
          new D(0),
        );
        const totalAgreedInterest = adjustedInterest(
          b.originalInterest.toString(),
          b.adjustments.map((a) => ({
            amount: a.amount.toString(),
            reason: a.reason,
          })),
          paidInterest.toString(),
        );
        const remainingInterest = D.max(
          new D(0),
          totalAgreedInterest.minus(paidInterest),
        ).toFixed(0);

        const latestActivePaymentId = activePayments[0]?.id;

        return {
          id: b.id,
          name: b.lender.person.name,
          principal: b.principal.toFixed(0),
          rate: b.rate.toString(),
          method: b.interestMethod,
          interest: b.originalInterest.toFixed(0),
          start: b.startDate.toISOString().slice(0, 10),
          due: b.dueDate.toISOString().slice(0, 10),
          status: b.status,
          remainingPrincipal,
          remainingInterest,
          payments: b.payments.map((p) => {
            const isLatest = p.id === latestActivePaymentId;
            let canReverse = false;
            let unsupportedReason: string | undefined;

            if (p.reversal) {
              unsupportedReason = "Payment has already been reversed.";
            } else if (b.status !== "ACTIVE") {
              unsupportedReason = "Closed agreements cannot be reopened; reversing settlement payments is unsupported.";
            } else if (!isLatest) {
              unsupportedReason = "Only the latest repayment on an active agreement can be safely reversed without corrupting allocation chronology.";
            } else {
              canReverse = true;
            }

            return {
              id: p.id,
              amount: p.amount.toFixed(0),
              fees: p.fees.toFixed(0),
              interest: p.interest.toFixed(0),
              principal: p.principal.toFixed(0),
              date: p.transactionDate.toISOString().slice(0, 10),
              reference: p.reference,
              reversed: Boolean(p.reversal),
              reversalDate: p.reversal ? p.reversal.reversalDate.toISOString().slice(0, 10) : null,
              reversalReason: p.reversal ? p.reversal.reason : null,
              canReverse,
              unsupportedReason,
            };
          }),
          adjustments: b.adjustments.map((a) => ({
            id: a.id,
            amount: a.amount.toFixed(0),
            reason: a.reason,
            createdAt: a.createdAt.toISOString(),
            performedBy: a.performedBy,
          })),
        };
      });

      const totalLent = loansWithBalances
        .filter((x) => x.status === "ACTIVE")
        .reduce((s, l) => s.plus(l.remainingPrincipal), new D(0))
        .toFixed(0);

      const totalBorrowed = borrowingsWithBalances
        .filter((x) => x.status === "ACTIVE")
        .reduce((s, b) => s.plus(b.remainingPrincipal), new D(0))
        .toFixed(0);

      const totalInterestEarned = loans
        .flatMap((l) => l.payments.filter((p) => !p.reversal))
        .reduce((s, p) => s.plus(p.interest.toString()), new D(0))
        .toFixed(0);

      const totalLenderInterestPaid = borrowings
        .flatMap((b) => b.payments.filter((p) => !p.reversal))
        .reduce((s, p) => s.plus(p.interest.toString()), new D(0))
        .toFixed(0);

      return {
        available: balance.toFixed(0),
        lent: totalLent,
        borrowed: totalBorrowed,
        interestEarned: totalInterestEarned,
        lenderInterestPaid: totalLenderInterestPaid,
        people: people.map((p) => ({
          id: p.id,
          name: p.name,
          phone: p.phone,
          borrowerId: p.borrower?.id ?? null,
          lenderId: p.lender?.id ?? null,
        })),
        loans: loansWithBalances,
        borrowings: borrowingsWithBalances,
        activity: activity.map((a) => ({
          id: a.id,
          type: a.type,
          direction: a.direction,
          amount: a.amount.toFixed(0),
          date: a.transactionDate.toISOString().slice(0, 10),
          reference: a.reference,
          entityId: a.loanId ?? a.borrowingId ?? a.equityEntryId ?? a.paymentId,
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export class PrismaReversalGateway implements PaymentReversalGateway {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditWriter = transactionalAudit,
  ) {}

  async reversePayment(
    r: ValidatedPaymentReversal,
  ): Promise<PaymentReversalResult> {
    const requestHash = hash(r);
    return this.db.$transaction(
      async (tx) => {
        await lock(tx);

        // 1. Idempotency check FIRST
        const existing = await tx.paymentReversal.findUnique({
          where: { idempotencyKey: r.idempotencyKey },
          include: { payment: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new RuleError(
              "This submission key was already used for different details.",
            );
          }
          return {
            reversalId: existing.id,
            paymentId: existing.paymentId,
            agreementId: (existing.payment.loanId ?? existing.payment.borrowingId)!,
            agreementType: existing.payment.loanId ? "LOAN" : "BORROWING",
            amountReversed: existing.payment.amount.toFixed(0),
            reinstatedPrincipal: existing.payment.principal.toFixed(0),
            reinstatedInterest: existing.payment.interest.toFixed(0),
            reversalDate: existing.reversalDate.toISOString().slice(0, 10),
            replayed: true,
            warnings: ["Already recorded. No second reversal was made."],
          };
        }

        // 2. Fetch payment with agreement
        const payment = await tx.payment.findUnique({
          where: { id: r.paymentId },
          include: {
            reversal: true,
            loan: true,
            borrowing: true,
          },
        });
        if (!payment) {
          throw new RuleError("Payment not found.");
        }
        if (payment.reversal) {
          throw new RuleError("This payment has already been reversed.");
        }

        const agreement = payment.loan ?? payment.borrowing;
        if (!agreement) {
          throw new RuleError("Payment is not linked to an agreement.");
        }
        const agreementType: "LOAN" | "BORROWING" = payment.loan
          ? "LOAN"
          : "BORROWING";

        // 3. Agreement status check: must be ACTIVE
        if (agreement.status !== "ACTIVE") {
          throw new RuleError(
            `Payments on ${agreement.status.toLowerCase()} agreements cannot be reversed. Closed agreements cannot be reopened under database integrity rules.`,
          );
        }

        // 4. Downstream dependency check: Must be the LATEST non-reversed payment on agreement
        // Deterministic ordering: transactionDate DESC, createdAt DESC, id DESC
        const activePayments = await tx.payment.findMany({
          where: {
            ...(agreementType === "LOAN"
              ? { loanId: agreement.id }
              : { borrowingId: agreement.id }),
            reversal: null,
          },
          orderBy: [
            { transactionDate: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
        });
        if (activePayments.length === 0 || activePayments[0].id !== payment.id) {
          throw new RuleError(
            "Only the latest repayment on an active agreement can be safely reversed. Reversing an earlier payment while subsequent payments exist would corrupt chronological interest/principal allocation history.",
          );
        }

        // 5. Date validation
        const paymentDateStr = payment.transactionDate
          .toISOString()
          .slice(0, 10);
        if (r.reversalDate < paymentDateStr) {
          throw new RuleError(
            "Reversal date cannot precede the original payment date.",
          );
        }
        await chronology(tx, r.reversalDate);

        // 6. Solvency check for borrower payment reversal (cash leaves pool)
        if (agreementType === "LOAN") {
          const cash = await poolBalance(tx);
          if (new D(payment.amount.toString()).gt(cash)) {
            throw new RuleError(
              "Insufficient available pool funds to reverse this borrower payment. The pool cash has already been disbursed or paid out.",
            );
          }
        }

        // 7. Atomic writes:
        // 7a. PaymentReversal
        const reversal = await tx.paymentReversal.create({
          data: {
            paymentId: payment.id,
            reversalDate: asDate(r.reversalDate),
            reason: r.reason,
            performedBy: r.performedBy,
            idempotencyKey: r.idempotencyKey,
            requestHash,
          },
        });

        // 7b. Matching compensating PoolTransaction
        if (agreementType === "LOAN") {
          await tx.poolTransaction.create({
            data: {
              direction: "OUT",
              type: "BORROWER_REPAYMENT_REVERSAL_OUT",
              amount: payment.amount,
              transactionDate: asDate(r.reversalDate),
              loanId: agreement.id,
              borrowingId: null,
              paymentId: null,
              paymentReversalId: reversal.id,
              equityEntryId: null,
              reference: `REVERSAL of ${payment.reference || payment.id}`,
              performedBy: r.performedBy,
            },
          });
        } else {
          await tx.poolTransaction.create({
            data: {
              direction: "IN",
              type: "LENDER_REPAYMENT_REVERSAL_IN",
              amount: payment.amount,
              transactionDate: asDate(r.reversalDate),
              borrowingId: agreement.id,
              loanId: null,
              paymentId: null,
              paymentReversalId: reversal.id,
              equityEntryId: null,
              reference: `REVERSAL of ${payment.reference || payment.id}`,
              performedBy: r.performedBy,
            },
          });
        }

        // 7c. AuditLog
        await this.audit.write(
          tx,
          agreementType === "LOAN"
            ? "BORROWER_REPAYMENT_REVERSED"
            : "LENDER_REPAYMENT_REVERSED",
          agreement.id,
          r.performedBy,
          {
            reversalId: reversal.id,
            paymentId: payment.id,
            agreementId: agreement.id,
            agreementType,
            amount: payment.amount.toFixed(0),
            principalReinstated: payment.principal.toFixed(0),
            interestReinstated: payment.interest.toFixed(0),
            reason: r.reason,
            reversalDate: r.reversalDate,
          },
        );

        return {
          reversalId: reversal.id,
          paymentId: payment.id,
          agreementId: agreement.id,
          agreementType,
          amountReversed: payment.amount.toFixed(0),
          reinstatedPrincipal: payment.principal.toFixed(0),
          reinstatedInterest: payment.interest.toFixed(0),
          reversalDate: r.reversalDate,
          replayed: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}

export class PrismaReconciliationGateway implements ReconciliationGateway {
  constructor(private readonly db: PrismaClient) {}

  async reconcile(): Promise<ReconciliationResult> {
    return this.db.$transaction(
      async (tx) => {
        const poolTxs = await tx.poolTransaction.findMany({
          orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
        });
        const payments = await tx.payment.findMany({
          include: { reversal: true },
          orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
        });
        const loans = await tx.loan.findMany({
          include: {
            payments: { include: { reversal: true } },
            adjustments: true,
            settlements: true,
          },
        });
        const borrowings = await tx.borrowing.findMany({
          include: {
            payments: { include: { reversal: true } },
            adjustments: true,
            settlements: true,
          },
        });
        const reversals = await tx.paymentReversal.findMany();

        const dataset: ReconciliationDataset = {
          poolTransactions: poolTxs.map((pt) => ({
            id: pt.id,
            direction: pt.direction,
            type: pt.type,
            amount: pt.amount.toFixed(0),
            transactionDate: pt.transactionDate.toISOString().slice(0, 10),
            loanId: pt.loanId,
            borrowingId: pt.borrowingId,
            equityEntryId: pt.equityEntryId,
            paymentId: pt.paymentId,
            paymentReversalId: pt.paymentReversalId,
            reference: pt.reference,
          })),
          payments: payments.map((p) => ({
            id: p.id,
            loanId: p.loanId,
            borrowingId: p.borrowingId,
            amount: p.amount.toFixed(0),
            principal: p.principal.toFixed(0),
            interest: p.interest.toFixed(0),
            fees: p.fees.toFixed(0),
            transactionDate: p.transactionDate.toISOString().slice(0, 10),
            reference: p.reference,
            reversal: p.reversal
              ? {
                  id: p.reversal.id,
                  reversalDate: p.reversal.reversalDate
                    .toISOString()
                    .slice(0, 10),
                  reason: p.reversal.reason,
                }
              : null,
          })),
          loans: loans.map((l) => ({
            id: l.id,
            principal: l.principal.toFixed(0),
            originalInterest: l.originalInterest.toFixed(0),
            status: l.status,
            startDate: l.startDate.toISOString().slice(0, 10),
            dueDate: l.dueDate.toISOString().slice(0, 10),
            payments: l.payments.map((p) => ({
              id: p.id,
              loanId: p.loanId,
              borrowingId: p.borrowingId,
              amount: p.amount.toFixed(0),
              principal: p.principal.toFixed(0),
              interest: p.interest.toFixed(0),
              fees: p.fees.toFixed(0),
              transactionDate: p.transactionDate.toISOString().slice(0, 10),
              reference: p.reference,
              reversal: p.reversal
                ? {
                    id: p.reversal.id,
                    reversalDate: p.reversal.reversalDate
                      .toISOString()
                      .slice(0, 10),
                    reason: p.reversal.reason,
                  }
                : null,
            })),
            adjustments: l.adjustments.map((a) => ({
              id: a.id,
              amount: a.amount.toFixed(0),
              reason: a.reason,
            })),
            settlements: l.settlements.map((s) => ({
              id: s.idempotencyKey,
              payoffAmount: s.payoffAmount.toFixed(0),
              finalTotalInterest: s.finalTotalInterest.toFixed(0),
            })),
          })),
          borrowings: borrowings.map((b) => ({
            id: b.id,
            principal: b.principal.toFixed(0),
            originalInterest: b.originalInterest.toFixed(0),
            status: b.status,
            startDate: b.startDate.toISOString().slice(0, 10),
            dueDate: b.dueDate.toISOString().slice(0, 10),
            payments: b.payments.map((p) => ({
              id: p.id,
              loanId: p.loanId,
              borrowingId: p.borrowingId,
              amount: p.amount.toFixed(0),
              principal: p.principal.toFixed(0),
              interest: p.interest.toFixed(0),
              fees: p.fees.toFixed(0),
              transactionDate: p.transactionDate.toISOString().slice(0, 10),
              reference: p.reference,
              reversal: p.reversal
                ? {
                    id: p.reversal.id,
                    reversalDate: p.reversal.reversalDate
                      .toISOString()
                      .slice(0, 10),
                    reason: p.reversal.reason,
                  }
                : null,
            })),
            adjustments: b.adjustments.map((a) => ({
              id: a.id,
              amount: a.amount.toFixed(0),
              reason: a.reason,
            })),
            settlements: b.settlements.map((s) => ({
              id: s.idempotencyKey,
              payoffAmount: s.payoffAmount.toFixed(0),
              finalTotalInterest: s.finalTotalInterest.toFixed(0),
            })),
          })),
          reversals: reversals.map((r) => ({
            id: r.id,
            paymentId: r.paymentId,
            reversalDate: r.reversalDate.toISOString().slice(0, 10),
            reason: r.reason,
          })),
        };

        return checkReconciliation(dataset);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

export async function getAgreementStatement(
  db: PrismaClient,
  agreementId: string,
  agreementType: "LOAN" | "BORROWING",
  filter?: { fromDate?: string; toDate?: string; asOfDate?: string },
): Promise<AgreementStatement> {
  return db.$transaction(
    async (tx) => {
      const asOf = filter?.asOfDate || businessDate();
      const fromDate = filter?.fromDate;
      const toDate = filter?.toDate;

      if (agreementType === "LOAN") {
        const loan = await tx.loan.findUnique({
          where: { id: agreementId },
          include: {
            borrower: { include: { person: true } },
            payments: {
              include: { reversal: true },
              orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            },
            adjustments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
            settlements: { orderBy: [{ createdAt: "asc" }] },
          },
        });
        if (!loan) throw new RuleError("Loan not found.");

        const initialPrincipal = new D(loan.principal.toString());
        const initialAgreedInterest = new D(loan.originalInterest.toString());

        type TimelineItem =
          | { kind: "DISBURSEMENT"; date: string; createdAt: Date; amount: string }
          | { kind: "PAYMENT"; date: string; createdAt: Date; payment: typeof loan.payments[0] }
          | { kind: "ADJUSTMENT"; date: string; createdAt: Date; adj: typeof loan.adjustments[0] }
          | { kind: "REVERSAL"; date: string; createdAt: Date; rev: NonNullable<typeof loan.payments[0]["reversal"]>; p: typeof loan.payments[0] }
          | { kind: "SETTLEMENT"; date: string; createdAt: Date; settle: typeof loan.settlements[0] };

        const items: TimelineItem[] = [
          {
            kind: "DISBURSEMENT",
            date: loan.startDate.toISOString().slice(0, 10),
            createdAt: loan.createdAt,
            amount: loan.principal.toFixed(0),
          },
        ];

        for (const p of loan.payments) {
          const pDate = p.transactionDate.toISOString().slice(0, 10);
          if (pDate <= asOf) {
            items.push({
              kind: "PAYMENT",
              date: pDate,
              createdAt: p.createdAt,
              payment: p,
            });
          }
          if (p.reversal) {
            const revDate = p.reversal.reversalDate.toISOString().slice(0, 10);
            if (revDate <= asOf) {
              items.push({
                kind: "REVERSAL",
                date: revDate,
                createdAt: p.reversal.createdAt,
                rev: p.reversal,
                p,
              });
            }
          }
        }

        for (const a of loan.adjustments) {
          const aDate = a.createdAt.toISOString().slice(0, 10);
          if (aDate <= asOf) {
            items.push({
              kind: "ADJUSTMENT",
              date: aDate,
              createdAt: a.createdAt,
              adj: a,
            });
          }
        }

        for (const s of loan.settlements) {
          const sDate = s.settlementDate.toISOString().slice(0, 10);
          if (sDate <= asOf) {
            items.push({
              kind: "SETTLEMENT",
              date: sDate,
              createdAt: s.createdAt,
              settle: s,
            });
          }
        }

        items.sort((a, b) => {
          const dc = a.date.localeCompare(b.date);
          return dc !== 0 ? dc : a.createdAt.getTime() - b.createdAt.getTime();
        });

        const entries: StatementEntry[] = [];
        let openingBalance: { date: string; principal: string; interest: string; totalOwed: string } | undefined;
        let runningP = initialPrincipal;
        let runningI = initialAgreedInterest;

        for (const item of items) {
          const isBeforeFrom = fromDate && item.date < fromDate;
          const isAfterTo = toDate && item.date > toDate;

          let entry: StatementEntry | null = null;

          if (item.kind === "DISBURSEMENT") {
            runningP = initialPrincipal;
            runningI = initialAgreedInterest;
            entry = {
              date: item.date,
              eventType: "LOAN_DISBURSED",
              description: "Initial loan disbursement",
              reference: null,
              cashAmount: loan.principal.toFixed(0),
              cashDirection: "OUT",
              principalAllocation: loan.principal.toFixed(0),
              interestAllocation: "0",
              feesAllocation: "0",
              adjustmentDelta: null,
              runningPrincipal: runningP.toFixed(0),
              runningInterest: runningI.toFixed(0),
              runningTotalOwed: runningP.plus(runningI).toFixed(0),
            };
          } else if (item.kind === "PAYMENT") {
            const p = item.payment;
            runningP = D.max(new D(0), runningP.minus(p.principal.toString()));
            runningI = D.max(new D(0), runningI.minus(p.interest.toString()));
            const isReversedAsOf = p.reversal && p.reversal.reversalDate.toISOString().slice(0, 10) <= asOf;
            entry = {
              date: item.date,
              eventType: "BORROWER_REPAYMENT",
              description: isReversedAsOf
                ? `Borrower repayment of ₹${p.amount.toFixed(0)} (Later Reversed)`
                : `Borrower repayment of ₹${p.amount.toFixed(0)}`,
              reference: p.reference,
              cashAmount: p.amount.toFixed(0),
              cashDirection: "IN",
              principalAllocation: p.principal.toFixed(0),
              interestAllocation: p.interest.toFixed(0),
              feesAllocation: p.fees.toFixed(0),
              adjustmentDelta: null,
              runningPrincipal: runningP.toFixed(0),
              runningInterest: runningI.toFixed(0),
              runningTotalOwed: runningP.plus(runningI).toFixed(0),
            };
          } else if (item.kind === "REVERSAL") {
            const p = item.p;
            runningP = runningP.plus(p.principal.toString());
            runningI = runningI.plus(p.interest.toString());
            entry = {
              date: item.date,
              eventType: "PAYMENT_REVERSAL",
              description: `Reversal of payment (${item.rev.reason})`,
              reference: `REVERSAL of ${p.reference || p.id}`,
              cashAmount: p.amount.toFixed(0),
              cashDirection: "OUT",
              principalAllocation: `-${p.principal.toFixed(0)}`,
              interestAllocation: `-${p.interest.toFixed(0)}`,
              feesAllocation: "0",
              adjustmentDelta: null,
              runningPrincipal: runningP.toFixed(0),
              runningInterest: runningI.toFixed(0),
              runningTotalOwed: runningP.plus(runningI).toFixed(0),
            };
          } else if (item.kind === "ADJUSTMENT") {
            const a = item.adj;
            runningI = runningI.plus(a.amount.toString());
            entry = {
              date: item.date,
              eventType: "INTEREST_ADJUSTMENT",
              description: `Interest adjustment: ${a.reason}`,
              reference: null,
              cashAmount: null,
              cashDirection: null,
              principalAllocation: "0",
              interestAllocation: "0",
              feesAllocation: "0",
              adjustmentDelta: a.amount.toFixed(0),
              runningPrincipal: runningP.toFixed(0),
              runningInterest: runningI.toFixed(0),
              runningTotalOwed: runningP.plus(runningI).toFixed(0),
            };
          } else if (item.kind === "SETTLEMENT") {
            const s = item.settle;
            runningP = new D(0);
            runningI = new D(0);
            entry = {
              date: item.date,
              eventType: "EARLY_SETTLEMENT",
              description: `Early settlement closed agreement (Payoff: ₹${s.payoffAmount.toFixed(0)}, Delta: ₹${s.adjustmentDelta.toFixed(0)})`,
              reference: null,
              cashAmount: s.payoffAmount.toFixed(0),
              cashDirection: "IN",
              principalAllocation: "0",
              interestAllocation: "0",
              feesAllocation: "0",
              adjustmentDelta: s.adjustmentDelta.toFixed(0),
              runningPrincipal: "0",
              runningInterest: "0",
              runningTotalOwed: "0",
            };
          }

          if (isBeforeFrom) {
            openingBalance = {
              date: fromDate!,
              principal: runningP.toFixed(0),
              interest: runningI.toFixed(0),
              totalOwed: runningP.plus(runningI).toFixed(0),
            };
          } else if (!isAfterTo && entry) {
            entries.push(entry);
          }
        }

        const activePaymentsAsOf = loan.payments.filter(
          (p) =>
            p.transactionDate.toISOString().slice(0, 10) <= asOf &&
            (!p.reversal || p.reversal.reversalDate.toISOString().slice(0, 10) > asOf),
        );
        const totalPaidPrincipal = activePaymentsAsOf.reduce((s, p) => s.plus(p.principal.toString()), new D(0));
        const totalPaidInterest = activePaymentsAsOf.reduce((s, p) => s.plus(p.interest.toString()), new D(0));
        const adjustmentsAsOf = loan.adjustments.filter(
          (a) => a.createdAt.toISOString().slice(0, 10) <= asOf,
        );
        const totalAdjustments = adjustmentsAsOf.reduce((s, a) => s.plus(a.amount.toString()), new D(0));
        const currentAdjustedInterest = initialAgreedInterest.plus(totalAdjustments);
        const settlementsAsOf = loan.settlements.filter(
          (s) => s.settlementDate.toISOString().slice(0, 10) <= asOf,
        );
        const isClosedAsOf = loan.status === "CLOSED" && (settlementsAsOf.length > 0 || initialPrincipal.minus(totalPaidPrincipal).lte(0));
        const remainingPrincipal = isClosedAsOf ? new D(0) : D.max(new D(0), initialPrincipal.minus(totalPaidPrincipal));
        const remainingInterest = isClosedAsOf ? new D(0) : D.max(new D(0), currentAdjustedInterest.minus(totalPaidInterest));

        return {
          agreementId: loan.id,
          agreementType: "LOAN",
          counterpartyName: loan.borrower.person.name,
          counterpartyPhone: loan.borrower.person.phone,
          principal: loan.principal.toFixed(0),
          rate: loan.rate.toString(),
          interestMethod: loan.interestMethod,
          originalInterest: loan.originalInterest.toFixed(0),
          currentAdjustedInterest: currentAdjustedInterest.toFixed(0),
          startDate: loan.startDate.toISOString().slice(0, 10),
          dueDate: loan.dueDate.toISOString().slice(0, 10),
          status: isClosedAsOf ? "CLOSED" : "ACTIVE",
          asOfDate: asOf,
          openingBalance,
          totalPaidPrincipal: totalPaidPrincipal.toFixed(0),
          totalPaidInterest: totalPaidInterest.toFixed(0),
          remainingPrincipal: remainingPrincipal.toFixed(0),
          remainingInterest: remainingInterest.toFixed(0),
          totalRemainingPayoff: remainingPrincipal.plus(remainingInterest).toFixed(0),
          entries,
        };
      } else {
        const borrowing = await tx.borrowing.findUnique({
          where: { id: agreementId },
          include: {
            lender: { include: { person: true } },
            payments: {
              include: { reversal: true },
              orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            },
            adjustments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
            settlements: { orderBy: [{ createdAt: "asc" }] },
          },
        });
        if (!borrowing) throw new RuleError("Borrowing not found.");

        const initialPrincipal = new D(borrowing.principal.toString());
        const initialAgreedInterest = new D(borrowing.originalInterest.toString());

        type TimelineItem =
          | { kind: "BORROWING_RECEIVED"; date: string; createdAt: Date; amount: string }
          | { kind: "PAYMENT"; date: string; createdAt: Date; payment: typeof borrowing.payments[0] }
          | { kind: "ADJUSTMENT"; date: string; createdAt: Date; adj: typeof borrowing.adjustments[0] }
          | { kind: "REVERSAL"; date: string; createdAt: Date; rev: NonNullable<typeof borrowing.payments[0]["reversal"]>; p: typeof borrowing.payments[0] }
          | { kind: "SETTLEMENT"; date: string; createdAt: Date; settle: typeof borrowing.settlements[0] };

        const items: TimelineItem[] = [
          {
            kind: "BORROWING_RECEIVED",
            date: borrowing.startDate.toISOString().slice(0, 10),
            createdAt: borrowing.createdAt,
            amount: borrowing.principal.toFixed(0),
          },
        ];

        for (const p of borrowing.payments) {
          const pDate = p.transactionDate.toISOString().slice(0, 10);
          if (pDate <= asOf) {
            items.push({
              kind: "PAYMENT",
              date: pDate,
              createdAt: p.createdAt,
              payment: p,
            });
          }
          if (p.reversal) {
            const revDate = p.reversal.reversalDate.toISOString().slice(0, 10);
            if (revDate <= asOf) {
              items.push({
                kind: "REVERSAL",
                date: revDate,
                createdAt: p.reversal.createdAt,
                rev: p.reversal,
                p,
              });
            }
          }
        }

        for (const a of borrowing.adjustments) {
          const aDate = a.createdAt.toISOString().slice(0, 10);
          if (aDate <= asOf) {
            items.push({
              kind: "ADJUSTMENT",
              date: aDate,
              createdAt: a.createdAt,
              adj: a,
            });
          }
        }

        for (const s of borrowing.settlements) {
          const sDate = s.settlementDate.toISOString().slice(0, 10);
          if (sDate <= asOf) {
            items.push({
              kind: "SETTLEMENT",
              date: sDate,
              createdAt: s.createdAt,
              settle: s,
            });
          }
        }

        items.sort((a, b) => {
          const dc = a.date.localeCompare(b.date);
          return dc !== 0 ? dc : a.createdAt.getTime() - b.createdAt.getTime();
        });

        const entries: StatementEntry[] = [];
        let openingBalance: { date: string; principal: string; interest: string; totalOwed: string } | undefined;
        let runningP = initialPrincipal;
        let runningI = initialAgreedInterest;

        for (const item of items) {
          const isBeforeFrom = fromDate && item.date < fromDate;
          const isAfterTo = toDate && item.date > toDate;

          let entry: StatementEntry | null = null;

          if (item.kind === "BORROWING_RECEIVED") {
            runningP = initialPrincipal;
            runningI = initialAgreedInterest;
            entry = {
              date: item.date,
              eventType: "BORROWING_RECEIVED",
              description: "Initial borrowed capital received",
              reference: null,
              cashAmount: borrowing.principal.toFixed(0),
              cashDirection: "IN",
              principalAllocation: borrowing.principal.toFixed(0),
              interestAllocation: "0",
              feesAllocation: "0",
              adjustmentDelta: null,
              runningPrincipal: runningP.toFixed(0),
              runningInterest: runningI.toFixed(0),
              runningTotalOwed: runningP.plus(runningI).toFixed(0),
            };
          } else if (item.kind === "PAYMENT") {
            const p = item.payment;
            runningP = D.max(new D(0), runningP.minus(p.principal.toString()));
            runningI = D.max(new D(0), runningI.minus(p.interest.toString()));
            const isReversedAsOf = p.reversal && p.reversal.reversalDate.toISOString().slice(0, 10) <= asOf;
            entry = {
              date: item.date,
              eventType: "LENDER_REPAYMENT",
              description: isReversedAsOf
                ? `Lender repayment of ₹${p.amount.toFixed(0)} (Later Reversed)`
                : `Lender repayment of ₹${p.amount.toFixed(0)}`,
              reference: p.reference,
              cashAmount: p.amount.toFixed(0),
              cashDirection: "OUT",
              principalAllocation: p.principal.toFixed(0),
              interestAllocation: p.interest.toFixed(0),
              feesAllocation: p.fees.toFixed(0),
              adjustmentDelta: null,
              runningPrincipal: runningP.toFixed(0),
              runningInterest: runningI.toFixed(0),
              runningTotalOwed: runningP.plus(runningI).toFixed(0),
            };
          } else if (item.kind === "REVERSAL") {
            const p = item.p;
            runningP = runningP.plus(p.principal.toString());
            runningI = runningI.plus(p.interest.toString());
            entry = {
              date: item.date,
              eventType: "PAYMENT_REVERSAL",
              description: `Reversal of lender repayment (${item.rev.reason})`,
              reference: `REVERSAL of ${p.reference || p.id}`,
              cashAmount: p.amount.toFixed(0),
              cashDirection: "IN",
              principalAllocation: `-${p.principal.toFixed(0)}`,
              interestAllocation: `-${p.interest.toFixed(0)}`,
              feesAllocation: "0",
              adjustmentDelta: null,
              runningPrincipal: runningP.toFixed(0),
              runningInterest: runningI.toFixed(0),
              runningTotalOwed: runningP.plus(runningI).toFixed(0),
            };
          } else if (item.kind === "ADJUSTMENT") {
            const a = item.adj;
            runningI = runningI.plus(a.amount.toString());
            entry = {
              date: item.date,
              eventType: "INTEREST_ADJUSTMENT",
              description: `Interest adjustment: ${a.reason}`,
              reference: null,
              cashAmount: null,
              cashDirection: null,
              principalAllocation: "0",
              interestAllocation: "0",
              feesAllocation: "0",
              adjustmentDelta: a.amount.toFixed(0),
              runningPrincipal: runningP.toFixed(0),
              runningInterest: runningI.toFixed(0),
              runningTotalOwed: runningP.plus(runningI).toFixed(0),
            };
          } else if (item.kind === "SETTLEMENT") {
            const s = item.settle;
            runningP = new D(0);
            runningI = new D(0);
            entry = {
              date: item.date,
              eventType: "EARLY_SETTLEMENT",
              description: `Early settlement closed agreement (Payoff: ₹${s.payoffAmount.toFixed(0)}, Delta: ₹${s.adjustmentDelta.toFixed(0)})`,
              reference: null,
              cashAmount: s.payoffAmount.toFixed(0),
              cashDirection: "OUT",
              principalAllocation: "0",
              interestAllocation: "0",
              feesAllocation: "0",
              adjustmentDelta: s.adjustmentDelta.toFixed(0),
              runningPrincipal: "0",
              runningInterest: "0",
              runningTotalOwed: "0",
            };
          }

          if (isBeforeFrom) {
            openingBalance = {
              date: fromDate!,
              principal: runningP.toFixed(0),
              interest: runningI.toFixed(0),
              totalOwed: runningP.plus(runningI).toFixed(0),
            };
          } else if (!isAfterTo && entry) {
            entries.push(entry);
          }
        }

        const activePaymentsAsOf = borrowing.payments.filter(
          (p) =>
            p.transactionDate.toISOString().slice(0, 10) <= asOf &&
            (!p.reversal || p.reversal.reversalDate.toISOString().slice(0, 10) > asOf),
        );
        const totalPaidPrincipal = activePaymentsAsOf.reduce((s, p) => s.plus(p.principal.toString()), new D(0));
        const totalPaidInterest = activePaymentsAsOf.reduce((s, p) => s.plus(p.interest.toString()), new D(0));
        const adjustmentsAsOf = borrowing.adjustments.filter(
          (a) => a.createdAt.toISOString().slice(0, 10) <= asOf,
        );
        const totalAdjustments = adjustmentsAsOf.reduce((s, a) => s.plus(a.amount.toString()), new D(0));
        const currentAdjustedInterest = initialAgreedInterest.plus(totalAdjustments);
        const settlementsAsOf = borrowing.settlements.filter(
          (s) => s.settlementDate.toISOString().slice(0, 10) <= asOf,
        );
        const isClosedAsOf = borrowing.status === "CLOSED" && (settlementsAsOf.length > 0 || initialPrincipal.minus(totalPaidPrincipal).lte(0));
        const remainingPrincipal = isClosedAsOf ? new D(0) : D.max(new D(0), initialPrincipal.minus(totalPaidPrincipal));
        const remainingInterest = isClosedAsOf ? new D(0) : D.max(new D(0), currentAdjustedInterest.minus(totalPaidInterest));

        return {
          agreementId: borrowing.id,
          agreementType: "BORROWING",
          counterpartyName: borrowing.lender.person.name,
          counterpartyPhone: borrowing.lender.person.phone,
          principal: borrowing.principal.toFixed(0),
          rate: borrowing.rate.toString(),
          interestMethod: borrowing.interestMethod,
          originalInterest: borrowing.originalInterest.toFixed(0),
          currentAdjustedInterest: currentAdjustedInterest.toFixed(0),
          startDate: borrowing.startDate.toISOString().slice(0, 10),
          dueDate: borrowing.dueDate.toISOString().slice(0, 10),
          status: isClosedAsOf ? "CLOSED" : "ACTIVE",
          asOfDate: asOf,
          openingBalance,
          totalPaidPrincipal: totalPaidPrincipal.toFixed(0),
          totalPaidInterest: totalPaidInterest.toFixed(0),
          remainingPrincipal: remainingPrincipal.toFixed(0),
          remainingInterest: remainingInterest.toFixed(0),
          totalRemainingPayoff: remainingPrincipal.plus(remainingInterest).toFixed(0),
          entries,
        };
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function getPoolStatement(
  db: PrismaClient,
  filter?: { fromDate?: string; toDate?: string; asOfDate?: string },
): Promise<PoolStatement> {
  return db.$transaction(
    async (tx) => {
      const asOf = filter?.asOfDate || businessDate();
      const fromDate = filter?.fromDate;
      const toDate = filter?.toDate;

      const [poolTxs, loans, borrowings] = await Promise.all([
        tx.poolTransaction.findMany({
          orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        }),
        tx.loan.findMany({
          include: { borrower: { include: { person: true } } },
        }),
        tx.borrowing.findMany({
          include: { lender: { include: { person: true } } },
        }),
      ]);

      const loanMap = new Map(loans.map((l) => [l.id, l.borrower.person.name]));
      const borrowingMap = new Map(borrowings.map((b) => [b.id, b.lender.person.name]));

      let opening = new D(0);
      let running = new D(0);
      let totalIn = new D(0);
      let totalOut = new D(0);
      const entries: PoolStatementEntry[] = [];

      for (const pt of poolTxs) {
        const ptDate = pt.transactionDate.toISOString().slice(0, 10);
        if (ptDate > asOf) continue;

        const amt = new D(pt.amount.toString());
        const isBeforeFrom = fromDate && ptDate < fromDate;
        const isAfterTo = toDate && ptDate > toDate;

        if (isBeforeFrom) {
          if (pt.direction === "IN") {
            opening = opening.plus(amt);
          } else {
            opening = opening.minus(amt);
          }
          continue;
        }

        if (entries.length === 0 && fromDate) {
          running = opening;
        }

        if (pt.direction === "IN") {
          running = running.plus(amt);
          totalIn = totalIn.plus(amt);
        } else {
          running = running.minus(amt);
          totalOut = totalOut.plus(amt);
        }

        if (isAfterTo) continue;

        let counterparty = "Owner Equity";
        if (pt.loanId && loanMap.has(pt.loanId)) {
          counterparty = loanMap.get(pt.loanId)!;
        } else if (pt.borrowingId && borrowingMap.has(pt.borrowingId)) {
          counterparty = borrowingMap.get(pt.borrowingId)!;
        }

        entries.push({
          id: pt.id,
          date: ptDate,
          type: pt.type,
          direction: pt.direction as "IN" | "OUT",
          amount: amt.toFixed(0),
          counterparty,
          reference: pt.reference,
          runningBalance: running.toFixed(0),
        });
      }

      return {
        generatedAt: new Date().toISOString(),
        asOfDate: asOf,
        openingBalance: fromDate ? opening.toFixed(0) : undefined,
        totalInflow: totalIn.toFixed(0),
        totalOutflow: totalOut.toFixed(0),
        currentBalance: running.toFixed(0),
        entries,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function getFinancialPositionSummary(
  db: PrismaClient,
  filter?: { asOfDate?: string },
): Promise<FinancialPositionSummary> {
  return db.$transaction(
    async (tx) => {
      const asOf = filter?.asOfDate || businessDate();

      const [poolTxs, loans, borrowings, equity] = await Promise.all([
        tx.poolTransaction.findMany(),
        tx.loan.findMany({
          include: { payments: { include: { reversal: true } } },
        }),
        tx.borrowing.findMany({
          include: { payments: { include: { reversal: true } } },
        }),
        tx.equityEntry.findMany(),
      ]);

      const equityAsOf = equity.filter(
        (e) => e.transactionDate.toISOString().slice(0, 10) <= asOf,
      );
      const ownCapital = equityAsOf.reduce(
        (s, e) =>
          e.type === "ADDITION"
            ? s.plus(e.amount.toString())
            : s.minus(e.amount.toString()),
        new D(0),
      );

      const loansAsOf = loans.filter(
        (l) => l.startDate.toISOString().slice(0, 10) <= asOf,
      );
      const grossLent = loansAsOf.reduce((s, l) => s.plus(l.principal.toString()), new D(0));
      const recoveredPrincipal = loansAsOf
        .flatMap((l) =>
          l.payments.filter(
            (p) =>
              p.transactionDate.toISOString().slice(0, 10) <= asOf &&
              (!p.reversal || p.reversal.reversalDate.toISOString().slice(0, 10) > asOf),
          ),
        )
        .reduce((s, p) => s.plus(p.principal.toString()), new D(0));
      const outstandingPrincipalLent = D.max(new D(0), grossLent.minus(recoveredPrincipal));

      const borrowingsAsOf = borrowings.filter(
        (b) => b.startDate.toISOString().slice(0, 10) <= asOf,
      );
      const grossBorrowed = borrowingsAsOf.reduce((s, b) => s.plus(b.principal.toString()), new D(0));
      const repaidBorrowingPrincipal = borrowingsAsOf
        .flatMap((b) =>
          b.payments.filter(
            (p) =>
              p.transactionDate.toISOString().slice(0, 10) <= asOf &&
              (!p.reversal || p.reversal.reversalDate.toISOString().slice(0, 10) > asOf),
          ),
        )
        .reduce((s, p) => s.plus(p.principal.toString()), new D(0));
      const outstandingBorrowingLiability = D.max(new D(0), grossBorrowed.minus(repaidBorrowingPrincipal));

      const borrowerInterestReceived = loansAsOf
        .flatMap((l) =>
          l.payments.filter(
            (p) =>
              p.transactionDate.toISOString().slice(0, 10) <= asOf &&
              (!p.reversal || p.reversal.reversalDate.toISOString().slice(0, 10) > asOf),
          ),
        )
        .reduce((s, p) => s.plus(p.interest.toString()), new D(0));

      const lenderInterestPaid = borrowingsAsOf
        .flatMap((b) =>
          b.payments.filter(
            (p) =>
              p.transactionDate.toISOString().slice(0, 10) <= asOf &&
              (!p.reversal || p.reversal.reversalDate.toISOString().slice(0, 10) > asOf),
          ),
        )
        .reduce((s, p) => s.plus(p.interest.toString()), new D(0));

      const netInterestSpread = borrowerInterestReceived.minus(lenderInterestPaid);

      let totalIn = new D(0);
      let totalOut = new D(0);
      for (const pt of poolTxs) {
        if (pt.transactionDate.toISOString().slice(0, 10) > asOf) continue;
        const a = new D(pt.amount.toString());
        if (pt.direction === "IN") totalIn = totalIn.plus(a);
        else totalOut = totalOut.plus(a);
      }
      const availableCash = totalIn.minus(totalOut);

      return {
        asOfDate: asOf,
        ownCapitalInjected: ownCapital.toFixed(0),
        principalLent: {
          grossDisbursed: grossLent.toFixed(0),
          principalRecovered: recoveredPrincipal.toFixed(0),
          outstandingPrincipal: outstandingPrincipalLent.toFixed(0),
          activeLoanCount: loansAsOf.filter((l) => l.status === "ACTIVE").length,
          closedLoanCount: loansAsOf.filter((l) => l.status === "CLOSED").length,
        },
        principalBorrowed: {
          grossBorrowed: grossBorrowed.toFixed(0),
          principalRepaid: repaidBorrowingPrincipal.toFixed(0),
          outstandingLiability: outstandingBorrowingLiability.toFixed(0),
          activeBorrowingCount: borrowingsAsOf.filter((b) => b.status === "ACTIVE").length,
          closedBorrowingCount: borrowingsAsOf.filter((b) => b.status === "CLOSED").length,
        },
        interest: {
          borrowerInterestReceived: borrowerInterestReceived.toFixed(0),
          lenderInterestPaid: lenderInterestPaid.toFixed(0),
          netInterestSpread: netInterestSpread.toFixed(0),
        },
        poolCash: {
          totalInflow: totalIn.toFixed(0),
          totalOutflow: totalOut.toFixed(0),
          availableBalance: availableCash.toFixed(0),
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function getActivityLedger(
  db: PrismaClient,
  filters?: {
    from?: string;
    to?: string;
    search?: string;
    entityType?: string;
    direction?: string;
  },
): Promise<ActivityEntry[]> {
  return db.$transaction(
    async (tx) => {
      const [poolTxs, loans, borrowings] = await Promise.all([
        tx.poolTransaction.findMany({
          orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
        }),
        tx.loan.findMany({
          include: { borrower: { include: { person: true } } },
        }),
        tx.borrowing.findMany({
          include: { lender: { include: { person: true } } },
        }),
      ]);

      const loanMap = new Map(loans.map((l) => [l.id, l.borrower.person.name]));
      const borrowingMap = new Map(borrowings.map((b) => [b.id, b.lender.person.name]));

      let list: ActivityEntry[] = poolTxs.map((pt) => {
        let counterparty = "Owner Equity";
        let entityType: "LOAN" | "BORROWING" | "EQUITY" | "POOL" = "EQUITY";
        let entityId = pt.equityEntryId || pt.id;

        if (pt.loanId) {
          entityType = "LOAN";
          entityId = pt.loanId;
          counterparty = loanMap.get(pt.loanId) || "Borrower";
        } else if (pt.borrowingId) {
          entityType = "BORROWING";
          entityId = pt.borrowingId;
          counterparty = borrowingMap.get(pt.borrowingId) || "Lender";
        }

        let notes = pt.type;
        if (pt.type === "BORROWER_REPAYMENT_IN") notes = "Borrower Repayment Received";
        else if (pt.type === "LENDER_REPAYMENT_OUT") notes = "Lender Repayment Disbursed";
        else if (pt.type === "LOAN_DISBURSEMENT_OUT") notes = "Loan Principal Disbursed";
        else if (pt.type === "BORROWING_RECEIVED_IN") notes = "Borrowed Capital Inflow";
        else if (pt.type === "OWN_CAPITAL_IN") notes = "Own Capital Injected";
        else if (pt.type === "EQUITY_WITHDRAWAL_OUT") notes = "Equity Withdrawn";
        else if (pt.type === "BORROWER_REPAYMENT_REVERSAL_OUT") notes = "Borrower Repayment Reversal (Cash Out)";
        else if (pt.type === "LENDER_REPAYMENT_REVERSAL_IN") notes = "Lender Repayment Reversal (Cash In)";

        return {
          id: pt.id,
          date: pt.transactionDate.toISOString().slice(0, 10),
          type: pt.type,
          direction: pt.direction as "IN" | "OUT",
          amount: pt.amount.toFixed(0),
          counterparty,
          entityType,
          entityId,
          reference: pt.reference,
          notes,
        };
      });

      if (filters?.from) {
        list = list.filter((e) => e.date >= filters.from!);
      }
      if (filters?.to) {
        list = list.filter((e) => e.date <= filters.to!);
      }
      if (filters?.direction && filters.direction !== "ALL") {
        list = list.filter((e) => e.direction === filters.direction);
      }
      if (filters?.entityType && filters.entityType !== "ALL") {
        list = list.filter((e) => e.entityType === filters.entityType);
      }
      if (filters?.search) {
        const q = filters.search.toLowerCase().trim();
        list = list.filter(
          (e) =>
            e.counterparty.toLowerCase().includes(q) ||
            e.notes.toLowerCase().includes(q) ||
            (e.reference && e.reference.toLowerCase().includes(q)) ||
            e.amount.includes(q),
        );
      }

      return list;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

