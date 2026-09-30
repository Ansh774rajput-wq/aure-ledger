import "dotenv/config";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { disburseLoan } from "../src/application/disburse";
import { receiveBorrowing } from "../src/application/borrow";
import { repayLoan } from "../src/application/repay";
import { repayLender } from "../src/application/repay-lender";
import { previewSettlement, executeSettlement } from "../src/application/settle";
import { reversePayment } from "../src/application/reverse";
import { runReconciliation } from "../src/application/reconcile";
import {
  addCapital,
  PrismaDisbursementGateway,
  PrismaBorrowingGateway,
  PrismaRepaymentGateway,
  PrismaLenderRepaymentGateway,
  PrismaSettlementGateway,
  PrismaReversalGateway,
  PrismaReconciliationGateway,
  getAgreementStatement,
  getPoolStatement,
  getFinancialPositionSummary,
  getActivityLedger,
  poolBalance,
  snapshot,
} from "../src/infrastructure/ledger";
let db: PrismaClient;
let borrowerId: string;
let lenderId: string;
const request = () => ({
  borrowerProfileId: borrowerId,
  principal: "20000",
  rate: "12",
  interestMethod: "ANNUAL_ACTUAL_365",
  startDate: "2026-01-01",
  dueDate: "2026-04-01",
  performedBy: "test-owner",
  idempotencyKey: randomUUID(),
});
const borrowingRequest = () => ({
  lenderProfileId: lenderId,
  principal: "25000",
  rate: "10",
  interestMethod: "ANNUAL_ACTUAL_365",
  startDate: "2026-01-01",
  dueDate: "2026-07-01",
  performedBy: "test-owner",
  idempotencyKey: randomUUID(),
});
const repaymentRequest = (loanId: string) => ({
  loanId,
  amount: "5000",
  paymentDate: "2026-01-15",
  performedBy: "test-owner",
  idempotencyKey: randomUUID(),
});
const lenderRepaymentRequest = (borrowingId: string) => ({
  borrowingId,
  amount: "5000",
  paymentDate: "2026-01-15",
  performedBy: "test-owner",
  idempotencyKey: randomUUID(),
});
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      "BLOCKED: TEST_DATABASE_URL is required. Real PostgreSQL tests did not execute.",
    );
  if (!new URL(url).pathname.endsWith("_test"))
    throw new Error(
      "Refusing destructive integration setup: database name must end in _test.",
    );
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      connectionTimeoutMillis: 3000,
    }),
  });
  await db.$connect();
  // Entirely test-only DDL. Sequence increments survive rollback, giving evidence Loan INSERT ran.
  await db.$executeRawUnsafe(
    "CREATE SEQUENCE IF NOT EXISTS test_loan_insert_witness",
  );
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION test_witness_loan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('test_loan_insert_witness'); RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_witness ON "Loan"');
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_witness AFTER INSERT ON "Loan" FOR EACH ROW EXECUTE FUNCTION test_witness_loan()',
  );
  await db.$executeRawUnsafe(
    "CREATE SEQUENCE IF NOT EXISTS test_borrowing_insert_witness",
  );
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION test_witness_borrowing() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('test_borrowing_insert_witness'); RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_witness_b ON "Borrowing"');
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_witness_b AFTER INSERT ON "Borrowing" FOR EACH ROW EXECUTE FUNCTION test_witness_borrowing()',
  );
  await db.$executeRawUnsafe(
    "CREATE SEQUENCE IF NOT EXISTS test_repayment_insert_witness",
  );
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION test_witness_repayment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('test_repayment_insert_witness'); RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_witness_p ON "Payment"');
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_witness_p AFTER INSERT ON "Payment" FOR EACH ROW EXECUTE FUNCTION test_witness_repayment()',
  );
  await db.$executeRawUnsafe(
    "CREATE SEQUENCE IF NOT EXISTS test_adjustment_insert_witness",
  );
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION test_witness_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('test_adjustment_insert_witness'); RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_witness_adj ON "InterestAdjustment"');
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_witness_adj AFTER INSERT ON "InterestAdjustment" FOR EACH ROW EXECUTE FUNCTION test_witness_adjustment()',
  );
  await db.$executeRawUnsafe(
    "CREATE SEQUENCE IF NOT EXISTS test_reversal_insert_witness",
  );
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION test_witness_reversal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('test_reversal_insert_witness'); RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_witness_rev ON "PaymentReversal"');
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_witness_rev AFTER INSERT ON "PaymentReversal" FOR EACH ROW EXECUTE FUNCTION test_witness_reversal()',
  );
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION test_fail_pool() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reference='TEST_FORCE_POOL_FAILURE' THEN IF NOT EXISTS(SELECT 1 FROM "Loan" WHERE id=NEW."loanId") THEN RAISE EXCEPTION 'Missing first write'; END IF; RAISE EXCEPTION 'TEST: pool failed after visible loan insert'; END IF; IF NEW.reference='TEST_FORCE_BORROWING_POOL_FAILURE' THEN IF NOT EXISTS(SELECT 1 FROM "Borrowing" WHERE id=NEW."borrowingId") THEN RAISE EXCEPTION 'Missing first write'; END IF; RAISE EXCEPTION 'TEST: pool failed after visible borrowing insert'; END IF; IF NEW.reference='TEST_FORCE_REPAYMENT_POOL_FAILURE' THEN IF NOT EXISTS(SELECT 1 FROM "Payment" WHERE id=NEW."paymentId") THEN RAISE EXCEPTION 'Missing first write'; END IF; RAISE EXCEPTION 'TEST: pool failed after visible payment insert'; END IF; IF NEW.reference='TEST_FORCE_LENDER_REPAYMENT_POOL_FAILURE' THEN IF NOT EXISTS(SELECT 1 FROM "Payment" WHERE id=NEW."paymentId") THEN RAISE EXCEPTION 'Missing first write'; END IF; RAISE EXCEPTION 'TEST: pool failed after visible lender payment insert'; END IF; IF NEW.reference='TEST_FORCE_SETTLEMENT_POOL_FAILURE' THEN IF NOT EXISTS(SELECT 1 FROM "Payment" WHERE id=NEW."paymentId") THEN RAISE EXCEPTION 'Missing first write'; END IF; RAISE EXCEPTION 'TEST: pool failed after visible settlement payment insert'; END IF; IF NEW.type LIKE '%REVERSAL%' AND NEW.reference LIKE '%TEST_FORCE_REVERSAL_POOL_FAILURE%' THEN IF NOT EXISTS(SELECT 1 FROM "PaymentReversal" WHERE id=NEW."paymentReversalId") THEN RAISE EXCEPTION 'Missing first reversal write'; END IF; RAISE EXCEPTION 'TEST: pool failed after visible reversal insert'; END IF; RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS test_reject_pool ON "PoolTransaction"',
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_reject_pool BEFORE INSERT ON "PoolTransaction" FOR EACH ROW EXECUTE FUNCTION test_fail_pool()',
  );
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION test_fail_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='TEST_FORCE_ADJUSTMENT_FAILURE' THEN RAISE EXCEPTION 'TEST: adjustment failed during settlement'; END IF; RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS test_reject_adjustment ON "InterestAdjustment"',
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_reject_adjustment BEFORE INSERT ON "InterestAdjustment" FOR EACH ROW EXECUTE FUNCTION test_fail_adjustment()',
  );
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION test_fail_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reference='TEST_FORCE_SETTLEMENT_PAYMENT_FAILURE' THEN IF NOT EXISTS(SELECT 1 FROM "InterestAdjustment" WHERE "loanId"=NEW."loanId") THEN RAISE EXCEPTION 'Missing prior adjustment write'; END IF; RAISE EXCEPTION 'TEST: settlement payment failed after visible adjustment insert'; END IF; RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS test_reject_payment ON "Payment"',
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_reject_payment BEFORE INSERT ON "Payment" FOR EACH ROW EXECUTE FUNCTION test_fail_payment()',
  );
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION test_fail_status() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='CLOSED' AND EXISTS(SELECT 1 FROM "PoolTransaction" WHERE reference='TEST_FORCE_STATUS_FAILURE') THEN RAISE EXCEPTION 'TEST: status update failed after visible adjustment, payment and pool movement'; END IF; RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS test_reject_status ON "Loan"',
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_reject_status BEFORE UPDATE ON "Loan" FOR EACH ROW EXECUTE FUNCTION test_fail_status()',
  );
});
beforeEach(async () => {
  if (!db) return;
  await db.$executeRawUnsafe(
    'TRUNCATE "PaymentReversal", "SettlementOperation", "PersonOperation", "PoolTransaction", "AuditLog", "InterestAdjustment", "Payment", "Loan", "Borrowing", "EquityEntry", "BorrowerProfile", "LenderProfile", "Person" CASCADE',
  );
  await db.$executeRawUnsafe(
    "ALTER SEQUENCE test_loan_insert_witness RESTART WITH 1",
  );
  const p = await db.person.create({
    data: { name: "Integration borrower", borrower: { create: {} } },
    include: { borrower: true },
  });
  borrowerId = p.borrower!.id;
  const l = await db.person.create({
    data: { name: "Integration lender", lender: { create: {} } },
    include: { lender: true },
  });
  lenderId = l.lender!.id;
  await db.$executeRawUnsafe(
    "ALTER SEQUENCE test_borrowing_insert_witness RESTART WITH 1",
  );
  await db.$executeRawUnsafe(
    "ALTER SEQUENCE test_repayment_insert_witness RESTART WITH 1",
  );
  await db.$executeRawUnsafe(
    "ALTER SEQUENCE test_adjustment_insert_witness RESTART WITH 1",
  );
  await db.$executeRawUnsafe(
    "ALTER SEQUENCE test_reversal_insert_witness RESTART WITH 1",
  );
  await addCapital(
    {
      amount: "50000",
      transactionDate: "2026-01-01",
      reason: "Test capital",
      performedBy: "test-owner",
      idempotencyKey: randomUUID(),
    },
    db,
  );
});
afterAll(async () => {
  if (!db) return;
  await db.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS test_reject_pool ON "PoolTransaction"',
  );
  await db.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS test_reject_adjustment ON "InterestAdjustment"',
  );
  await db.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS test_reject_payment ON "Payment"',
  );
  await db.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS test_reject_status ON "Loan"',
  );
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_witness ON "Loan"');
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_witness_b ON "Borrowing"');
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_witness_p ON "Payment"');
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_witness_adj ON "InterestAdjustment"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_fail_pool()");
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_fail_adjustment()");
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_fail_payment()");
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_fail_status()");
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_witness_loan()");
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_witness_borrowing()");
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_witness_repayment()");
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_witness_adjustment()");
  await db.$executeRawUnsafe(
    "DROP SEQUENCE IF EXISTS test_loan_insert_witness",
  );
  await db.$executeRawUnsafe(
    "DROP SEQUENCE IF EXISTS test_borrowing_insert_witness",
  );
  await db.$executeRawUnsafe(
    "DROP SEQUENCE IF EXISTS test_repayment_insert_witness",
  );
  await db.$executeRawUnsafe(
    "DROP SEQUENCE IF EXISTS test_adjustment_insert_witness",
  );
  await db.$disconnect();
});
describe("real PostgreSQL and real Prisma", () => {
  it("A: commits matching Loan, PoolTransaction and audit", async () => {
    const r = await disburseLoan(request(), new PrismaDisbursementGateway(db));
    const loan = await db.loan.findUniqueOrThrow({ where: { id: r.loanId } });
    const p = await db.poolTransaction.findUniqueOrThrow({
      where: { id: r.poolTransactionId },
    });
    expect(loan.principal.toString()).toBe("20000");
    expect(p.amount.toString()).toBe("20000");
    expect(p.direction).toBe("OUT");
    expect(p.type).toBe("LOAN_DISBURSEMENT_OUT");
    expect(p.loanId).toBe(loan.id);
    expect(p.borrowingId).toBeNull();
    expect(p.transactionDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(await db.auditLog.count({ where: { entityId: loan.id } })).toBe(1);
  });
  it("B: nonexistent borrower causes PostgreSQL FK rejection and leaves no disbursement", async () => {
    await expect(
      disburseLoan(
        { ...request(), borrowerProfileId: randomUUID() },
        new PrismaDisbursementGateway(db),
      ),
    ).rejects.toMatchObject({ code: "P2003" });
    expect(await db.loan.count()).toBe(0);
    expect(
      await db.poolTransaction.count({
        where: { type: "LOAN_DISBURSEMENT_OUT" },
      }),
    ).toBe(0);
  });
  it("C: pool write fails after Loan INSERT, then real rollback removes both", async () => {
    await expect(
      disburseLoan(
        { ...request(), reference: "TEST_FORCE_POOL_FAILURE" },
        new PrismaDisbursementGateway(db),
      ),
    ).rejects.toThrow(/pool failed after visible loan insert/);
    const witness = await db.$queryRawUnsafe<{ is_called: boolean }[]>(
      "SELECT is_called FROM test_loan_insert_witness",
    );
    expect(witness[0].is_called).toBe(true);
    expect(await db.loan.count()).toBe(0);
    expect(
      await db.poolTransaction.count({
        where: { type: "LOAN_DISBURSEMENT_OUT" },
      }),
    ).toBe(0);
    expect((await poolBalance(db)).toString()).toBe("50000");
  });
  it("rolls back loan and movement if transactional auditing fails", async () => {
    await expect(
      disburseLoan(
        request(),
        new PrismaDisbursementGateway(db, {
          async write() {
            throw new Error("audit unavailable");
          },
        }),
      ),
    ).rejects.toThrow("audit unavailable");
    expect(await db.loan.count()).toBe(0);
    expect(
      await db.poolTransaction.count({ where: { direction: "OUT" } }),
    ).toBe(0);
  });
  it("replays the same request without spending capital again", async () => {
    const r = request(),
      g = new PrismaDisbursementGateway(db);
    const a = await disburseLoan(r, g);
    const b = await disburseLoan(r, g);
    expect(b.loanId).toBe(a.loanId);
    expect(b.replayed).toBe(true);
    expect(await db.loan.count()).toBe(1);
  });
  it("rejects changed payload under the same idempotency key", async () => {
    const r = request(),
      g = new PrismaDisbursementGateway(db);
    await disburseLoan(r, g);
    await expect(disburseLoan({ ...r, principal: "10000" }, g)).rejects.toThrow(
      "different details",
    );
    expect(await db.loan.count()).toBe(1);
  });
  it("serializes concurrent disbursements to prevent overspending", async () => {
    const g = new PrismaDisbursementGateway(db);
    const results = await Promise.allSettled([
      disburseLoan({ ...request(), principal: "40000" }, g),
      disburseLoan({ ...request(), principal: "40000" }, g),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect((await poolBalance(db)).toString()).toBe("10000");
  });
  it("warns on duplicate reference without rejecting the second loan", async () => {
    const g = new PrismaDisbursementGateway(db);
    await disburseLoan({ ...request(), reference: "SAME-UTR" }, g);
    const r = await disburseLoan({ ...request(), reference: "SAME-UTR" }, g);
    expect(r.warnings).toHaveLength(1);
    expect(await db.loan.count()).toBe(2);
  });
  it("database prevents destructive edits to cash history", async () => {
    await expect(db.poolTransaction.deleteMany()).rejects.toThrow("immutable");
    expect(await db.poolTransaction.count()).toBe(1);
  });
  it("refuses a disbursement dated before capital was available", async () => {
    await expect(
      disburseLoan(
        { ...request(), startDate: "2025-12-31" },
        new PrismaDisbursementGateway(db),
      ),
    ).rejects.toThrow("latest pool movement");
    expect(await db.loan.count()).toBe(0);
  });

  describe("Phase 2: Borrowing Received", () => {
    it("commits matching Borrowing, PoolTransaction (IN) and audit", async () => {
      const r = await receiveBorrowing(
        borrowingRequest(),
        new PrismaBorrowingGateway(db),
      );
      const borrowing = await db.borrowing.findUniqueOrThrow({
        where: { id: r.borrowingId },
      });
      const p = await db.poolTransaction.findUniqueOrThrow({
        where: { id: r.poolTransactionId },
      });
      expect(borrowing.principal.toString()).toBe("25000");
      expect(borrowing.rate.toString()).toBe("10");
      expect(borrowing.interestMethod).toBe("ANNUAL_ACTUAL_365");
      expect(borrowing.originalInterest.toString()).toBe("1240");
      expect(borrowing.status).toBe("ACTIVE");
      expect(p.amount.toString()).toBe("25000");
      expect(p.direction).toBe("IN");
      expect(p.type).toBe("BORROWING_RECEIVED_IN");
      expect(p.borrowingId).toBe(borrowing.id);
      expect(p.loanId).toBeNull();
      expect(p.transactionDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(
        await db.auditLog.count({ where: { entityId: borrowing.id } }),
      ).toBe(1);
    });

    it("nonexistent lender causes PostgreSQL FK rejection and leaves no borrowing", async () => {
      await expect(
        receiveBorrowing(
          { ...borrowingRequest(), lenderProfileId: randomUUID() },
          new PrismaBorrowingGateway(db),
        ),
      ).rejects.toMatchObject({ code: "P2003" });
      expect(await db.borrowing.count()).toBe(0);
      expect(
        await db.poolTransaction.count({
          where: { type: "BORROWING_RECEIVED_IN" },
        }),
      ).toBe(0);
    });

    it("failure after Borrowing insertion rolls back both borrowing and movement", async () => {
      await expect(
        receiveBorrowing(
          {
            ...borrowingRequest(),
            reference: "TEST_FORCE_BORROWING_POOL_FAILURE",
          },
          new PrismaBorrowingGateway(db),
        ),
      ).rejects.toThrow(/pool failed after visible borrowing insert/);
      const witness = await db.$queryRawUnsafe<{ is_called: boolean }[]>(
        "SELECT is_called FROM test_borrowing_insert_witness",
      );
      expect(witness[0].is_called).toBe(true);
      expect(await db.borrowing.count()).toBe(0);
      expect(
        await db.poolTransaction.count({
          where: { type: "BORROWING_RECEIVED_IN" },
        }),
      ).toBe(0);
      // Verify original ₹50,000 capital movement remains in the pool
      expect((await poolBalance(db)).toString()).toBe("50000");
    });

    it("rolls back borrowing and movement if transactional auditing fails", async () => {
      await expect(
        receiveBorrowing(
          borrowingRequest(),
          new PrismaBorrowingGateway(db, {
            async write() {
              throw new Error("audit unavailable");
            },
          }),
        ),
      ).rejects.toThrow("audit unavailable");
      expect(await db.borrowing.count()).toBe(0);
      expect(
        await db.poolTransaction.count({
          where: { type: "BORROWING_RECEIVED_IN" },
        }),
      ).toBe(0);
    });

    it("replays the same request without duplicating borrowing or crediting pool again", async () => {
      const r = borrowingRequest(),
        g = new PrismaBorrowingGateway(db);
      const a = await receiveBorrowing(r, g);
      const b = await receiveBorrowing(r, g);
      expect(b.borrowingId).toBe(a.borrowingId);
      expect(b.replayed).toBe(true);
      expect(await db.borrowing.count()).toBe(1);
      expect(
        await db.poolTransaction.count({
          where: { type: "BORROWING_RECEIVED_IN" },
        }),
      ).toBe(1);
      // Pool increased by exactly 25000 (50000 + 25000 = 75000)
      expect((await poolBalance(db)).toString()).toBe("75000");
    });

    it("rejects changed payload under the same idempotency key", async () => {
      const r = borrowingRequest(),
        g = new PrismaBorrowingGateway(db);
      await receiveBorrowing(r, g);
      await expect(
        receiveBorrowing({ ...r, principal: "15000" }, g),
      ).rejects.toThrow("different details");
      expect(await db.borrowing.count()).toBe(1);
    });

    it("concurrent duplicate submissions cannot credit the pool twice", async () => {
      const r = borrowingRequest(),
        g = new PrismaBorrowingGateway(db);
      const results = await Promise.allSettled([
        receiveBorrowing(r, g),
        receiveBorrowing(r, g),
      ]);
      expect(results.every((x) => x.status === "fulfilled")).toBe(true);
      expect(await db.borrowing.count()).toBe(1);
      expect(
        await db.poolTransaction.count({
          where: { type: "BORROWING_RECEIVED_IN" },
        }),
      ).toBe(1);
      expect((await poolBalance(db)).toString()).toBe("75000");
    });

    it("warns on duplicate reference without rejecting the second borrowing", async () => {
      const g = new PrismaBorrowingGateway(db);
      await receiveBorrowing(
        { ...borrowingRequest(), reference: "SAME-BORROW-UTR" },
        g,
      );
      const r = await receiveBorrowing(
        { ...borrowingRequest(), reference: "SAME-BORROW-UTR" },
        g,
      );
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain("reference already exists");
      expect(await db.borrowing.count()).toBe(2);
    });

    it("pool and liability increase correctly while income remains unchanged", async () => {
      const g = new PrismaBorrowingGateway(db);
      const initialPool = await poolBalance(db);
      await receiveBorrowing(
        { ...borrowingRequest(), principal: "30000" },
        g,
      );
      const snap = await snapshot(db);
      // Available capital increased by 30000
      expect(snap.available).toBe(initialPool.plus("30000").toString());
      // Liability (borrowed) increased to 30000
      expect(snap.borrowed).toBe("30000");
      // Income remains completely unchanged (0)
      expect(snap.interestEarned).toBe("0");
    });

    it("receiving borrowed capital works even when the pool is empty", async () => {
      // Clear all prior movements so pool is strictly 0
      await db.$executeRawUnsafe('TRUNCATE "PoolTransaction" CASCADE');
      expect((await poolBalance(db)).toString()).toBe("0");
      const r = await receiveBorrowing(
        borrowingRequest(),
        new PrismaBorrowingGateway(db),
      );
      expect(r.borrowingId).toBeDefined();
      expect((await poolBalance(db)).toString()).toBe("25000");
      expect(await db.borrowing.count()).toBe(1);
    });

    it("succeeds with a zero-interest borrowing (rate = '0') and records zero interest in PostgreSQL", async () => {
      const g = new PrismaBorrowingGateway(db);
      const r = await receiveBorrowing(
        { ...borrowingRequest(), rate: "0" },
        g,
      );
      const borrowing = await db.borrowing.findUniqueOrThrow({
        where: { id: r.borrowingId },
      });
      expect(borrowing.rate.toString()).toBe("0");
      expect(borrowing.originalInterest.toString()).toBe("0");
      const p = await db.poolTransaction.findUniqueOrThrow({
        where: { id: r.poolTransactionId },
      });
      expect(p.amount.toString()).toBe("25000");
      expect(p.type).toBe("BORROWING_RECEIVED_IN");
    });

    it("succeeds with MONTHLY_ANCHORED interest method, computing and recording correct interest in PostgreSQL", async () => {
      const g = new PrismaBorrowingGateway(db);
      const r = await receiveBorrowing(
        {
          ...borrowingRequest(),
          interestMethod: "MONTHLY_ANCHORED",
          principal: "100000",
          rate: "2",
          startDate: "2026-01-31",
          dueDate: "2026-03-31",
        },
        g,
      );
      const borrowing = await db.borrowing.findUniqueOrThrow({
        where: { id: r.borrowingId },
      });
      expect(borrowing.interestMethod).toBe("MONTHLY_ANCHORED");
      // 2 anchored months: Jan 31 -> Feb 28 -> Mar 31.
      // 100,000 * 2% * 2 = 4000
      expect(borrowing.originalInterest.toString()).toBe("4000");
    });

    it("rejects borrowing when dueDate is equal to or earlier than startDate without any database write", async () => {
      const g = new PrismaBorrowingGateway(db);
      const initialBorrowings = await db.borrowing.count();
      const initialPoolTxCount = await db.poolTransaction.count();

      // Equal dates
      await expect(
        receiveBorrowing(
          { ...borrowingRequest(), startDate: "2026-02-01", dueDate: "2026-02-01" },
          g,
        ),
      ).rejects.toThrow("Due date must be after start date.");

      // Earlier due date
      await expect(
        receiveBorrowing(
          { ...borrowingRequest(), startDate: "2026-02-10", dueDate: "2026-02-01" },
          g,
        ),
      ).rejects.toThrow("End date cannot precede start date.");

      // Verify no financial database writes occurred
      expect(await db.borrowing.count()).toBe(initialBorrowings);
      expect(await db.poolTransaction.count()).toBe(initialPoolTxCount);
    });
  });

  describe("Phase 3: Borrower Repayments", () => {
    it("allocates fees -> interest -> principal per domain rules (₹20k loan, ₹1k interest pays ₹600 then ₹5400)", async () => {
      // Disburse ₹20,000 loan with ₹1,000 agreed interest (5% monthly anchored, 1 month)
      const d = await disburseLoan(
        {
          ...request(),
          principal: "20000",
          rate: "5",
          interestMethod: "MONTHLY_ANCHORED",
          startDate: "2026-01-01",
          dueDate: "2026-02-01",
        },
        new PrismaDisbursementGateway(db),
      );
      const loanId = d.loanId;
      const initialPool = await poolBalance(db);

      const g = new PrismaRepaymentGateway(db);
      // Payment 1: ₹600
      const r1 = await repayLoan(
        {
          ...repaymentRequest(loanId),
          amount: "600",
          paymentDate: "2026-01-10",
        },
        g,
      );
      expect(r1.allocation).toEqual({
        fees: "0",
        interest: "600",
        principal: "0",
      });
      expect(r1.remainingPrincipal).toBe("20000");
      expect(r1.remainingInterest).toBe("400");
      expect(r1.settled).toBe(false);
      expect((await poolBalance(db)).toString()).toBe(
        initialPool.plus("600").toString(),
      );

      // Payment 2: ₹5400
      const r2 = await repayLoan(
        {
          ...repaymentRequest(loanId),
          amount: "5400",
          paymentDate: "2026-01-15",
        },
        g,
      );
      expect(r2.allocation).toEqual({
        fees: "0",
        interest: "400",
        principal: "5000",
      });
      expect(r2.remainingPrincipal).toBe("15000");
      expect(r2.remainingInterest).toBe("0");
      expect(r2.settled).toBe(false);
      expect((await poolBalance(db)).toString()).toBe(
        initialPool.plus("6000").toString(),
      );

      const snap = await snapshot(db);
      expect(snap.lent).toBe("15000");
      expect(snap.interestEarned).toBe("1000");
      expect(snap.available).toBe((await poolBalance(db)).toFixed(0));
    });

    it("settles loan and updates status to CLOSED when full balance reaches zero", async () => {
      const d = await disburseLoan(
        {
          ...request(),
          principal: "20000",
          rate: "5",
          interestMethod: "MONTHLY_ANCHORED",
          startDate: "2026-01-01",
          dueDate: "2026-02-01",
        },
        new PrismaDisbursementGateway(db),
      );
      const g = new PrismaRepaymentGateway(db);
      // Full payment of 21,000 (20k principal + 1k interest)
      const r = await repayLoan(
        {
          ...repaymentRequest(d.loanId),
          amount: "21000",
          paymentDate: "2026-01-20",
        },
        g,
      );
      expect(r.allocation).toEqual({
        fees: "0",
        interest: "1000",
        principal: "20000",
      });
      expect(r.remainingPrincipal).toBe("0");
      expect(r.remainingInterest).toBe("0");
      expect(r.settled).toBe(true);

      const loan = await db.loan.findUniqueOrThrow({ where: { id: d.loanId } });
      expect(loan.status).toBe("CLOSED");

      const snap = await snapshot(db);
      expect(snap.lent).toBe("0");
      expect(snap.interestEarned).toBe("1000");
    });

    it("repayment on a zero-interest loan allocates directly to principal and settles cleanly", async () => {
      const d = await disburseLoan(
        {
          ...request(),
          principal: "10000",
          rate: "0",
          interestMethod: "ANNUAL_ACTUAL_365",
          startDate: "2026-01-01",
          dueDate: "2026-04-01",
        },
        new PrismaDisbursementGateway(db),
      );
      const g = new PrismaRepaymentGateway(db);
      const r = await repayLoan(
        {
          ...repaymentRequest(d.loanId),
          amount: "10000",
          paymentDate: "2026-01-15",
        },
        g,
      );
      expect(r.allocation).toEqual({
        fees: "0",
        interest: "0",
        principal: "10000",
      });
      expect(r.settled).toBe(true);
      const loan = await db.loan.findUniqueOrThrow({ where: { id: d.loanId } });
      expect(loan.status).toBe("CLOSED");
    });

    it("rejects payment exceeding total outstanding amount and records zero payment or movement", async () => {
      const d = await disburseLoan(
        {
          ...request(),
          principal: "20000",
          rate: "5",
          interestMethod: "MONTHLY_ANCHORED",
          startDate: "2026-01-01",
          dueDate: "2026-02-01",
        },
        new PrismaDisbursementGateway(db),
      );
      const g = new PrismaRepaymentGateway(db);
      // Total outstanding is 21,000; try 21,001
      await expect(
        repayLoan(
          {
            ...repaymentRequest(d.loanId),
            amount: "21001",
            paymentDate: "2026-01-10",
          },
          g,
        ),
      ).rejects.toThrow("Payment exceeds outstanding amount.");

      expect(await db.payment.count()).toBe(0);
      expect(
        await db.poolTransaction.count({
          where: { type: "BORROWER_REPAYMENT_IN" },
        }),
      ).toBe(0);
    });

    it("rejects payment dated before loan startDate without any database write", async () => {
      const d = await disburseLoan(
        { ...request(), startDate: "2026-01-10", dueDate: "2026-02-10" },
        new PrismaDisbursementGateway(db),
      );
      const g = new PrismaRepaymentGateway(db);
      await expect(
        repayLoan(
          {
            ...repaymentRequest(d.loanId),
            amount: "5000",
            paymentDate: "2026-01-05",
          },
          g,
        ),
      ).rejects.toThrow("Payment date cannot precede the loan start date.");
      expect(await db.payment.count()).toBe(0);
    });

    it("rejects payment dated before latest pool movement without any database write", async () => {
      const d = await disburseLoan(
        { ...request(), startDate: "2026-01-01", dueDate: "2026-04-01" },
        new PrismaDisbursementGateway(db),
      );
      // Add capital on 2026-01-15, making 2026-01-15 the latest pool movement
      await addCapital(
        {
          amount: "10000",
          transactionDate: "2026-01-15",
          reason: "Newer capital",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        db,
      );
      const g = new PrismaRepaymentGateway(db);
      // Try repayment on 2026-01-10 (earlier than 2026-01-15)
      await expect(
        repayLoan(
          {
            ...repaymentRequest(d.loanId),
            amount: "5000",
            paymentDate: "2026-01-10",
          },
          g,
        ),
      ).rejects.toThrow("latest pool movement");
      expect(await db.payment.count()).toBe(0);
    });

    it("nonexistent loan causes rejection and leaves no payment or movement", async () => {
      const g = new PrismaRepaymentGateway(db);
      await expect(
        repayLoan(
          { ...repaymentRequest(randomUUID()), amount: "5000" },
          g,
        ),
      ).rejects.toThrow("Loan not found.");
      expect(await db.payment.count()).toBe(0);
    });

    it("replays the same repayment request without creating duplicate payment or crediting pool twice", async () => {
      const d = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const g = new PrismaRepaymentGateway(db);
      const req = repaymentRequest(d.loanId);
      const r1 = await repayLoan(req, g);
      expect(r1.replayed).toBe(false);

      const poolAfterFirst = await poolBalance(db);
      const r2 = await repayLoan(req, g);
      expect(r2.replayed).toBe(true);
      expect(r2.paymentId).toBe(r1.paymentId);
      expect(r2.poolTransactionId).toBe(r1.poolTransactionId);
      expect((await poolBalance(db)).toString()).toBe(poolAfterFirst.toString());
      expect(await db.payment.count()).toBe(1);
    });

    it("replaying a final payment on an already closed loan succeeds safely via idempotency check", async () => {
      const d = await disburseLoan(
        {
          ...request(),
          principal: "10000",
          rate: "0",
          startDate: "2026-01-01",
          dueDate: "2026-04-01",
        },
        new PrismaDisbursementGateway(db),
      );
      const g = new PrismaRepaymentGateway(db);
      const req = { ...repaymentRequest(d.loanId), amount: "10000" };
      const r1 = await repayLoan(req, g);
      expect(r1.settled).toBe(true);
      expect(
        (await db.loan.findUniqueOrThrow({ where: { id: d.loanId } })).status,
      ).toBe("CLOSED");

      // Resubmit the exact same request
      const r2 = await repayLoan(req, g);
      expect(r2.replayed).toBe(true);
      expect(r2.settled).toBe(true);
      expect(r2.paymentId).toBe(r1.paymentId);
      expect(await db.payment.count()).toBe(1);
    });

    it("rejects changed payload under the same idempotency key", async () => {
      const d = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const g = new PrismaRepaymentGateway(db);
      const key = randomUUID();
      await repayLoan(
        { ...repaymentRequest(d.loanId), amount: "5000", idempotencyKey: key },
        g,
      );
      await expect(
        repayLoan(
          { ...repaymentRequest(d.loanId), amount: "6000", idempotencyKey: key },
          g,
        ),
      ).rejects.toThrow(
        "This submission key was already used for different details.",
      );
      expect(await db.payment.count()).toBe(1);
    });

    it("serializes concurrent repayments to prevent overpayment", async () => {
      const d = await disburseLoan(
        {
          ...request(),
          principal: "5000",
          rate: "0",
          startDate: "2026-01-01",
          dueDate: "2026-04-01",
        },
        new PrismaDisbursementGateway(db),
      );
      const g = new PrismaRepaymentGateway(db);
      const initialPool = await poolBalance(db);

      // Two concurrent payments of 5000 (total outstanding is 5000)
      const results = await Promise.allSettled([
        repayLoan({ ...repaymentRequest(d.loanId), amount: "5000" }, g),
        repayLoan({ ...repaymentRequest(d.loanId), amount: "5000" }, g),
      ]);

      const fulfilled = results.filter((x) => x.status === "fulfilled");
      const rejected = results.filter((x) => x.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(await db.payment.count()).toBe(1);
      expect((await poolBalance(db)).toString()).toBe(
        initialPool.plus("5000").toString(),
      );
    });

    it("failure after Payment insertion rolls back payment, movement, and any status change", async () => {
      const d = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const g = new PrismaRepaymentGateway(db);
      await expect(
        repayLoan(
          {
            ...repaymentRequest(d.loanId),
            amount: "5000",
            reference: "TEST_FORCE_REPAYMENT_POOL_FAILURE",
          },
          g,
        ),
      ).rejects.toThrow(/pool failed after visible payment insert/);

      const witness = await db.$queryRawUnsafe<{ is_called: boolean }[]>(
        "SELECT is_called FROM test_repayment_insert_witness",
      );
      expect(witness[0].is_called).toBe(true);
      expect(await db.payment.count()).toBe(0);
      expect(
        await db.poolTransaction.count({
          where: { type: "BORROWER_REPAYMENT_IN" },
        }),
      ).toBe(0);
      const loan = await db.loan.findUniqueOrThrow({ where: { id: d.loanId } });
      expect(loan.status).toBe("ACTIVE");
    });

    it("rolls back payment and movement if transactional auditing fails", async () => {
      const d = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const failingAudit = {
        write: async () => {
          throw new Error("Audit log database failure");
        },
      };
      const g = new PrismaRepaymentGateway(db, failingAudit);
      await expect(
        repayLoan(
          { ...repaymentRequest(d.loanId), amount: "5000" },
          g,
        ),
      ).rejects.toThrow("Audit log database failure");

      expect(await db.payment.count()).toBe(0);
      expect(
        await db.poolTransaction.count({
          where: { type: "BORROWER_REPAYMENT_IN" },
        }),
      ).toBe(0);
      const loan = await db.loan.findUniqueOrThrow({ where: { id: d.loanId } });
      expect(loan.status).toBe("ACTIVE");
    });

    it("immutable loan terms prevent altering principal, rate, interest, or dates on a loan", async () => {
      const d = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      // Attempt to tamper with principal via raw SQL
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Loan" SET principal = 99999 WHERE id = '${d.loanId}'`,
        ),
      ).rejects.toThrow(
        /Original loan terms and agreement history are immutable/,
      );

      // Attempt to tamper with rate
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Loan" SET rate = 50 WHERE id = '${d.loanId}'`,
        ),
      ).rejects.toThrow(
        /Original loan terms and agreement history are immutable/,
      );

      // Attempt to tamper with startDate
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Loan" SET "startDate" = '2025-01-01' WHERE id = '${d.loanId}'`,
        ),
      ).rejects.toThrow(
        /Original loan terms and agreement history are immutable/,
      );
    });

    it("warns on duplicate reference without rejecting the second payment", async () => {
      const d = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const g = new PrismaRepaymentGateway(db);
      await repayLoan(
        {
          ...repaymentRequest(d.loanId),
          amount: "2000",
          reference: "SAME-REPAY-UTR",
        },
        g,
      );
      const r = await repayLoan(
        {
          ...repaymentRequest(d.loanId),
          amount: "2000",
          reference: "SAME-REPAY-UTR",
        },
        g,
      );
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain("reference already exists");
      expect(await db.payment.count()).toBe(2);
    });
  });

  describe("Phase 4: Lender Repayments", () => {
    it("allocates fees -> interest -> principal per domain rules (borrowing ₹10k, ₹500 interest pays ₹2500)", async () => {
      const b = await receiveBorrowing(
        {
          ...borrowingRequest(),
          principal: "10000",
          rate: "10",
          startDate: "2026-01-01",
          dueDate: "2026-07-01",
        },
        new PrismaBorrowingGateway(db),
      );
      const dbBorrowing = await db.borrowing.findUniqueOrThrow({
        where: { id: b.borrowingId },
      });
      const agreedInt = dbBorrowing.originalInterest.toFixed(0);

      const initialPool = await poolBalance(db);
      const initialSnap = await snapshot(db);
      const initialInterestEarned = initialSnap.interestEarned;

      const g = new PrismaLenderRepaymentGateway(db);
      const r = await repayLender(
        {
          borrowingId: b.borrowingId,
          amount: "2500",
          paymentDate: "2026-01-15",
          reference: "UTR-LENDER-ALLOC",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        g,
      );

      // Allocation: fees -> interest -> principal
      expect(r.allocation.fees).toBe("0");
      expect(r.allocation.interest).toBe(agreedInt);
      const expectedPrinPaid = (2500 - Number(agreedInt)).toString();
      expect(r.allocation.principal).toBe(expectedPrinPaid);
      const expectedRemPrin = (10000 - Number(expectedPrinPaid)).toString();
      expect(r.remainingPrincipal).toBe(expectedRemPrin);
      expect(r.remainingInterest).toBe("0");
      expect(r.settled).toBe(false);

      // Pool decreases by full 2500
      const newPool = await poolBalance(db);
      expect(newPool.toString()).toBe(initialPool.minus("2500").toString());

      // Snapshot checks
      const snap = await snapshot(db);
      expect(snap.borrowed).toBe(expectedRemPrin);
      expect(snap.lenderInterestPaid).toBe(agreedInt);
      expect(snap.interestEarned).toBe(initialInterestEarned); // Borrower interest received unchanged

      // Direct DB verification
      const payment = await db.payment.findUniqueOrThrow({
        where: { id: r.paymentId },
        include: { movements: true },
      });
      expect(payment.borrowingId).toBe(b.borrowingId);
      expect(payment.loanId).toBeNull();
      expect(payment.amount.toString()).toBe("2500");
      expect(payment.movements).toHaveLength(1);
      expect(payment.movements[0].direction).toBe("OUT");
      expect(payment.movements[0].type).toBe("LENDER_REPAYMENT_OUT");
      expect(payment.movements[0].borrowingId).toBe(b.borrowingId);
      expect(payment.movements[0].loanId).toBeNull();
    });

    it("settles borrowing and updates status to CLOSED when full balance reaches zero", async () => {
      const b = await receiveBorrowing(
        {
          ...borrowingRequest(),
          principal: "10000",
          rate: "0",
          startDate: "2026-01-01",
          dueDate: "2026-07-01",
        },
        new PrismaBorrowingGateway(db),
      );
      const g = new PrismaLenderRepaymentGateway(db);
      const r = await repayLender(
        {
          borrowingId: b.borrowingId,
          amount: "10000",
          paymentDate: "2026-01-15",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        g,
      );
      expect(r.settled).toBe(true);
      expect(r.remainingPrincipal).toBe("0");
      expect(r.remainingInterest).toBe("0");
      const borrowing = await db.borrowing.findUniqueOrThrow({
        where: { id: b.borrowingId },
      });
      expect(borrowing.status).toBe("CLOSED");

      const snap = await snapshot(db);
      expect(snap.borrowed).toBe("0");
    });

    it("repayment on a zero-interest borrowing allocates directly to principal and settles cleanly", async () => {
      const b = await receiveBorrowing(
        {
          ...borrowingRequest(),
          principal: "8000",
          rate: "0",
          startDate: "2026-01-01",
          dueDate: "2026-07-01",
        },
        new PrismaBorrowingGateway(db),
      );
      const g = new PrismaLenderRepaymentGateway(db);
      const r1 = await repayLender(
        {
          borrowingId: b.borrowingId,
          amount: "3000",
          paymentDate: "2026-01-15",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        g,
      );
      expect(r1.allocation.interest).toBe("0");
      expect(r1.allocation.principal).toBe("3000");
      expect(r1.remainingPrincipal).toBe("5000");
      expect(r1.settled).toBe(false);

      const r2 = await repayLender(
        {
          borrowingId: b.borrowingId,
          amount: "5000",
          paymentDate: "2026-01-16",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        g,
      );
      expect(r2.allocation.principal).toBe("5000");
      expect(r2.remainingPrincipal).toBe("0");
      expect(r2.settled).toBe(true);
      const borrowing = await db.borrowing.findUniqueOrThrow({
        where: { id: b.borrowingId },
      });
      expect(borrowing.status).toBe("CLOSED");
    });

    it("rejects payment exceeding total outstanding liability and records zero payment or movement", async () => {
      const b = await receiveBorrowing(
        {
          ...borrowingRequest(),
          principal: "5000",
          rate: "0",
        },
        new PrismaBorrowingGateway(db),
      );
      const g = new PrismaLenderRepaymentGateway(db);
      await expect(
        repayLender(
          {
            borrowingId: b.borrowingId,
            amount: "5001",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
          },
          g,
        ),
      ).rejects.toThrow("Payment exceeds outstanding amount.");
      expect(await db.payment.count()).toBe(0);
      expect(
        await db.poolTransaction.count({
          where: { type: "LENDER_REPAYMENT_OUT" },
        }),
      ).toBe(0);
    });

    it("rejects payment exceeding available pool cash and records zero payment or movement", async () => {
      const b = await receiveBorrowing(
        {
          ...borrowingRequest(),
          principal: "5000",
          rate: "0",
        },
        new PrismaBorrowingGateway(db),
      );
      // Reduce pool cash to 1000 by disbursing loan of 54000 (initial 50000 + borrowing 5000 = 55000)
      await disburseLoan(
        {
          ...request(),
          principal: "54000",
          rate: "0",
          startDate: "2026-01-01",
          dueDate: "2026-04-01",
        },
        new PrismaDisbursementGateway(db),
      );
      const currentPool = await poolBalance(db);
      expect(currentPool.toString()).toBe("1000");

      const g = new PrismaLenderRepaymentGateway(db);
      await expect(
        repayLender(
          {
            borrowingId: b.borrowingId,
            amount: "2000",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
          },
          g,
        ),
      ).rejects.toThrow("Payment exceeds available pool cash.");
      expect(await db.payment.count()).toBe(0);
      expect(
        await db.poolTransaction.count({
          where: { type: "LENDER_REPAYMENT_OUT" },
        }),
      ).toBe(0);
    });

    it("rejects payment dated before borrowing startDate without any database write", async () => {
      const b = await receiveBorrowing(
        {
          ...borrowingRequest(),
          startDate: "2026-02-01",
          dueDate: "2026-05-01",
        },
        new PrismaBorrowingGateway(db),
      );
      const g = new PrismaLenderRepaymentGateway(db);
      await expect(
        repayLender(
          {
            borrowingId: b.borrowingId,
            amount: "1000",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
          },
          g,
        ),
      ).rejects.toThrow(
        "Payment date cannot precede the borrowing start date.",
      );
      expect(await db.payment.count()).toBe(0);
    });

    it("rejects payment dated before latest pool movement without any database write", async () => {
      const b = await receiveBorrowing(
        {
          ...borrowingRequest(),
          startDate: "2026-01-01",
          dueDate: "2026-05-01",
        },
        new PrismaBorrowingGateway(db),
      );
      await addCapital(
        {
          amount: "1000",
          transactionDate: "2026-02-01",
          reason: "Later capital",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        db,
      );
      const g = new PrismaLenderRepaymentGateway(db);
      await expect(
        repayLender(
          {
            borrowingId: b.borrowingId,
            amount: "1000",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
          },
          g,
        ),
      ).rejects.toThrow(
        "Date cannot precede the latest pool movement",
      );
      expect(await db.payment.count()).toBe(0);
    });

    it("nonexistent borrowing causes rejection and leaves no payment or movement", async () => {
      const g = new PrismaLenderRepaymentGateway(db);
      await expect(
        repayLender(
          {
            borrowingId: randomUUID(),
            amount: "1000",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
          },
          g,
        ),
      ).rejects.toThrow("Borrowing not found.");
      expect(await db.payment.count()).toBe(0);
    });

    it("replays the same repayment request without creating duplicate payment or debiting pool twice", async () => {
      const b = await receiveBorrowing(
        borrowingRequest(),
        new PrismaBorrowingGateway(db),
      );
      const g = new PrismaLenderRepaymentGateway(db);
      const key = randomUUID();
      const payload = {
        borrowingId: b.borrowingId,
        amount: "5000",
        paymentDate: "2026-01-15",
        reference: "TEST-LENDER-IDEMP",
        performedBy: "test-owner",
        idempotencyKey: key,
      };
      const r1 = await repayLender(payload, g);
      expect(r1.replayed).toBe(false);

      const poolAfterFirst = await poolBalance(db);
      const r2 = await repayLender(payload, g);
      expect(r2.replayed).toBe(true);
      expect(r2.paymentId).toBe(r1.paymentId);
      expect(r2.poolTransactionId).toBe(r1.poolTransactionId);
      expect(r2.warnings).toContain(
        "Already recorded. No second repayment was made.",
      );

      expect(await db.payment.count()).toBe(1);
      expect(
        await db.poolTransaction.count({
          where: { type: "LENDER_REPAYMENT_OUT" },
        }),
      ).toBe(1);
      expect((await poolBalance(db)).toString()).toBe(
        poolAfterFirst.toString(),
      );
    });

    it("replaying a final payment on an already closed borrowing succeeds safely via idempotency check", async () => {
      const b = await receiveBorrowing(
        {
          ...borrowingRequest(),
          principal: "5000",
          rate: "0",
        },
        new PrismaBorrowingGateway(db),
      );
      const g = new PrismaLenderRepaymentGateway(db);
      const finalKey = randomUUID();
      const finalPayload = {
        borrowingId: b.borrowingId,
        amount: "5000",
        paymentDate: "2026-01-15",
        reference: "FINAL-LENDER-PAY",
        performedBy: "test-owner",
        idempotencyKey: finalKey,
      };
      const r1 = await repayLender(finalPayload, g);
      expect(r1.settled).toBe(true);
      expect(r1.replayed).toBe(false);

      const closedBorrowing = await db.borrowing.findUniqueOrThrow({
        where: { id: b.borrowingId },
      });
      expect(closedBorrowing.status).toBe("CLOSED");

      const r2 = await repayLender(finalPayload, g);
      expect(r2.replayed).toBe(true);
      expect(r2.settled).toBe(true);
      expect(await db.payment.count()).toBe(1);
    });

    it("rejects changed payload under the same idempotency key", async () => {
      const b = await receiveBorrowing(
        borrowingRequest(),
        new PrismaBorrowingGateway(db),
      );
      const g = new PrismaLenderRepaymentGateway(db);
      const key = randomUUID();
      await repayLender(
        {
          borrowingId: b.borrowingId,
          amount: "5000",
          paymentDate: "2026-01-15",
          performedBy: "test-owner",
          idempotencyKey: key,
        },
        g,
      );
      await expect(
        repayLender(
          {
            borrowingId: b.borrowingId,
            amount: "6000",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            idempotencyKey: key,
          },
          g,
        ),
      ).rejects.toThrow(
        "This submission key was already used for different details.",
      );
      expect(await db.payment.count()).toBe(1);
    });

    it("serializes concurrent repayments to prevent overpayment", async () => {
      const b = await receiveBorrowing(
        {
          ...borrowingRequest(),
          principal: "5000",
          rate: "0",
          startDate: "2026-01-01",
          dueDate: "2026-04-01",
        },
        new PrismaBorrowingGateway(db),
      );
      const g = new PrismaLenderRepaymentGateway(db);
      const initialPool = await poolBalance(db);

      const results = await Promise.allSettled([
        repayLender(
          {
            borrowingId: b.borrowingId,
            amount: "5000",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
          },
          g,
        ),
        repayLender(
          {
            borrowingId: b.borrowingId,
            amount: "5000",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
          },
          g,
        ),
      ]);

      const fulfilled = results.filter((x) => x.status === "fulfilled");
      const rejected = results.filter((x) => x.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(await db.payment.count()).toBe(1);
      expect((await poolBalance(db)).toString()).toBe(
        initialPool.minus("5000").toString(),
      );
    });

    it("serializes concurrent repayments competing for cash to prevent pool overdraft", async () => {
      const b = await receiveBorrowing(
        {
          ...borrowingRequest(),
          principal: "10000",
          rate: "0",
        },
        new PrismaBorrowingGateway(db),
      );
      // Reduce pool cash to 6000 by disbursing loan 54000
      await disburseLoan(
        {
          ...request(),
          principal: "54000",
          rate: "0",
          startDate: "2026-01-01",
          dueDate: "2026-04-01",
        },
        new PrismaDisbursementGateway(db),
      );
      expect((await poolBalance(db)).toString()).toBe("6000");

      const g = new PrismaLenderRepaymentGateway(db);
      // Two concurrent payments of 5000 (total 10000 > 6000 available)
      const results = await Promise.allSettled([
        repayLender(
          {
            borrowingId: b.borrowingId,
            amount: "5000",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
          },
          g,
        ),
        repayLender(
          {
            borrowingId: b.borrowingId,
            amount: "5000",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
          },
          g,
        ),
      ]);

      const fulfilled = results.filter((x) => x.status === "fulfilled");
      const rejected = results.filter((x) => x.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(await db.payment.count()).toBe(1);
      expect((await poolBalance(db)).toString()).toBe("1000");
    });

    it("failure after Payment insertion rolls back payment, movement, and any status change", async () => {
      const b = await receiveBorrowing(
        borrowingRequest(),
        new PrismaBorrowingGateway(db),
      );
      const g = new PrismaLenderRepaymentGateway(db);
      await expect(
        repayLender(
          {
            borrowingId: b.borrowingId,
            amount: "5000",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            reference: "TEST_FORCE_LENDER_REPAYMENT_POOL_FAILURE",
            idempotencyKey: randomUUID(),
          },
          g,
        ),
      ).rejects.toThrow(/pool failed after visible lender payment insert/);

      const witness = await db.$queryRawUnsafe<{ is_called: boolean }[]>(
        "SELECT is_called FROM test_repayment_insert_witness",
      );
      expect(witness[0].is_called).toBe(true);
      expect(await db.payment.count()).toBe(0);
      expect(
        await db.poolTransaction.count({
          where: { type: "LENDER_REPAYMENT_OUT" },
        }),
      ).toBe(0);
      const borrowing = await db.borrowing.findUniqueOrThrow({
        where: { id: b.borrowingId },
      });
      expect(borrowing.status).toBe("ACTIVE");
    });

    it("rolls back payment and movement if transactional auditing fails", async () => {
      const b = await receiveBorrowing(
        borrowingRequest(),
        new PrismaBorrowingGateway(db),
      );
      const failingAudit = {
        write: async () => {
          throw new Error("Lender audit log database failure");
        },
      };
      const g = new PrismaLenderRepaymentGateway(db, failingAudit);
      await expect(
        repayLender(
          {
            borrowingId: b.borrowingId,
            amount: "5000",
            paymentDate: "2026-01-15",
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
          },
          g,
        ),
      ).rejects.toThrow("Lender audit log database failure");

      expect(await db.payment.count()).toBe(0);
      expect(
        await db.poolTransaction.count({
          where: { type: "LENDER_REPAYMENT_OUT" },
        }),
      ).toBe(0);
      const borrowing = await db.borrowing.findUniqueOrThrow({
        where: { id: b.borrowingId },
      });
      expect(borrowing.status).toBe("ACTIVE");
    });

    it("immutable borrowing terms prevent altering principal, rate, interest, or dates on a borrowing", async () => {
      const b = await receiveBorrowing(
        borrowingRequest(),
        new PrismaBorrowingGateway(db),
      );
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Borrowing" SET principal = 99999 WHERE id = '${b.borrowingId}'`,
        ),
      ).rejects.toThrow(
        /Original borrowing terms and agreement history are immutable/,
      );

      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Borrowing" SET rate = 50 WHERE id = '${b.borrowingId}'`,
        ),
      ).rejects.toThrow(
        /Original borrowing terms and agreement history are immutable/,
      );

      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Borrowing" SET "startDate" = '2025-01-01' WHERE id = '${b.borrowingId}'`,
        ),
      ).rejects.toThrow(
        /Original borrowing terms and agreement history are immutable/,
      );
    });

    it("warns on duplicate reference without rejecting the second payment", async () => {
      const b = await receiveBorrowing(
        borrowingRequest(),
        new PrismaBorrowingGateway(db),
      );
      const g = new PrismaLenderRepaymentGateway(db);
      await repayLender(
        {
          borrowingId: b.borrowingId,
          amount: "2000",
          paymentDate: "2026-01-15",
          reference: "SAME-LENDER-UTR",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        g,
      );
      const r = await repayLender(
        {
          borrowingId: b.borrowingId,
          amount: "2000",
          paymentDate: "2026-01-15",
          reference: "SAME-LENDER-UTR",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        g,
      );
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain("reference already exists");
      expect(await db.payment.count()).toBe(2);
    });
  });

  describe("Phase 5: Early Closure & Interest Adjustments", () => {
    const loan100Days = () => ({
      ...request(),
      principal: "10000",
      rate: "36.5",
      startDate: "2026-01-01",
      dueDate: "2026-04-11", // exactly 100 days -> 10000 * 0.365 * 100 / 365 = 1000
    });

    const borrowing100Days = () => ({
      ...borrowingRequest(),
      principal: "10000",
      rate: "36.5",
      startDate: "2026-01-01",
      dueDate: "2026-04-11", // exactly 100 days -> 10000 * 0.365 * 100 / 365 = 1000
    });

    it("settles borrower loan with default suggested total interest and records signed adjustment, payment, pool transaction, settlement operation, and audit log atomically", async () => {
      const l = await disburseLoan(
        {
          ...request(),
          principal: "8000",
          rate: "45.625",
          startDate: "2026-01-01",
          dueDate: "2026-04-11", // exactly 100 days -> 8000 * 0.45625 * 100 / 365 = 1000
        },
        new PrismaDisbursementGateway(db),
      );
      const loan = await db.loan.findUniqueOrThrow({ where: { id: l.loanId } });
      const origInterest = loan.originalInterest.toString();

      // Make a partial repayment on 2026-01-15: ₹100 interest
      const repayGateway = new PrismaRepaymentGateway(db);
      await repayLoan(
        {
          loanId: l.loanId,
          amount: "100",
          paymentDate: "2026-01-15",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      const poolBeforeSettle = await poolBalance(db);

      // Server preview on 2026-02-10 (40 days elapsed out of 100)
      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      expect(preview.elapsedDays).toBe(40);
      expect(preview.termDays).toBe(100);
      expect(preview.suggestedTotalInterest).toBe("400");
      expect(preview.interestPaid).toBe("100");
      expect(preview.outstandingPrincipal).toBe("8000");
      expect(preview.suggestedPayoff).toBe("8300");

      // Execute settlement with SUGGESTED decision
      const settleKey = randomUUID();
      const res = await executeSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
          decision: "SUGGESTED",
          reason: "Borrower requested early closure after 40 days",
          quoteBalanceHash: preview.quoteBalanceHash,
          idempotencyKey: settleKey,
          performedBy: "test-owner",
        },
        settleGateway,
      );

      expect(res.settled).toBe(true);
      expect(res.adjustmentDelta).toBe("-600");
      expect(res.finalTotalInterest).toBe("400");
      expect(res.payoffAmount).toBe("8300");
      expect(res.replayed).toBe(false);

      // Verify PostgreSQL persisted state
      const updatedLoan = await db.loan.findUniqueOrThrow({
        where: { id: l.loanId },
        include: { adjustments: true, payments: true },
      });
      expect(updatedLoan.status).toBe("CLOSED");
      expect(updatedLoan.adjustments).toHaveLength(1);
      expect(updatedLoan.adjustments[0].amount.toString()).toBe("-600");
      expect(updatedLoan.adjustments[0].reason).toBe(
        "Borrower requested early closure after 40 days",
      );

      // Verify payment was recorded for ₹8,300
      const finalPayment = await db.payment.findUniqueOrThrow({
        where: { id: res.paymentId! },
      });
      expect(finalPayment.amount.toString()).toBe("8300");
      expect(finalPayment.principal.toString()).toBe("8000");
      expect(finalPayment.interest.toString()).toBe("300");
      expect(finalPayment.fees.toString()).toBe("0");

      // Verify matching pool transaction was created
      const poolTx = await db.poolTransaction.findFirstOrThrow({
        where: { paymentId: res.paymentId! },
      });
      expect(poolTx.type).toBe("BORROWER_REPAYMENT_IN");
      expect(poolTx.direction).toBe("IN");
      expect(poolTx.amount.toString()).toBe("8300");

      // Verify settlement operation
      const op = await db.settlementOperation.findUniqueOrThrow({
        where: { idempotencyKey: settleKey },
      });
      expect(op.loanId).toBe(l.loanId);
      expect(op.payoffAmount.toString()).toBe("8300");
      expect(op.finalTotalInterest.toString()).toBe("400");
      expect(op.adjustmentDelta.toString()).toBe("-600");

      // Verify audit log
      const audit = await db.auditLog.findFirstOrThrow({
        where: { entityId: l.loanId, action: "LOAN_EARLY_SETTLED" },
      });
      expect(audit.performedBy).toBe("test-owner");

      // Verify pool balance increased by ₹8,300
      const poolAfterSettle = await poolBalance(db);
      expect(poolAfterSettle.toString()).toBe(
        poolBeforeSettle.plus("8300").toString(),
      );

      // Verify snapshot shows closed status and 0 remaining balances
      const s = await snapshot(db);
      const snapshotLoan = s.loans.find((x) => x.id === l.loanId)!;
      expect(snapshotLoan.status).toBe("CLOSED");
      expect(snapshotLoan.remainingPrincipal).toBe("0");
      expect(snapshotLoan.remainingInterest).toBe("0");
      expect(snapshotLoan.adjustments).toHaveLength(1);
    });

    it("settles lender borrowing with default suggested total interest and debits pool atomically", async () => {
      const b = await receiveBorrowing(
        borrowing100Days(),
        new PrismaBorrowingGateway(db),
      );
      const poolBeforeSettle = await poolBalance(db);

      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: b.borrowingId,
          agreementType: "BORROWING",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      expect(preview.elapsedDays).toBe(40);
      expect(preview.suggestedTotalInterest).toBe("400");
      expect(preview.suggestedPayoff).toBe("10400");

      const settleKey = randomUUID();
      const res = await executeSettlement(
        {
          agreementId: b.borrowingId,
          agreementType: "BORROWING",
          settlementDate: "2026-02-10",
          decision: "SUGGESTED",
          reason: "Mutual agreement with lender for early closure",
          quoteBalanceHash: preview.quoteBalanceHash,
          idempotencyKey: settleKey,
          performedBy: "test-owner",
        },
        settleGateway,
      );

      expect(res.settled).toBe(true);
      expect(res.adjustmentDelta).toBe("-600");
      expect(res.finalTotalInterest).toBe("400");
      expect(res.payoffAmount).toBe("10400");

      const borrowing = await db.borrowing.findUniqueOrThrow({
        where: { id: b.borrowingId },
        include: { adjustments: true },
      });
      expect(borrowing.status).toBe("CLOSED");
      expect(borrowing.adjustments).toHaveLength(1);
      expect(borrowing.adjustments[0].amount.toString()).toBe("-600");

      const poolTx = await db.poolTransaction.findFirstOrThrow({
        where: { paymentId: res.paymentId! },
      });
      expect(poolTx.type).toBe("LENDER_REPAYMENT_OUT");
      expect(poolTx.direction).toBe("OUT");
      expect(poolTx.amount.toString()).toBe("10400");

      const poolAfterSettle = await poolBalance(db);
      expect(poolAfterSettle.toString()).toBe(
        poolBeforeSettle.minus("10400").toString(),
      );
    });

    it("rejects when owner-selected final total interest is less than interest already paid", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );

      // Pay ₹600 interest already
      const repayGateway = new PrismaRepaymentGateway(db);
      await repayLoan(
        {
          loanId: l.loanId,
          amount: "600",
          paymentDate: "2026-01-15",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      expect(preview.suggestedTotalInterest).toBe("400");
      expect(preview.interestPaid).toBe("600");

      // SUGGESTED (400) must be rejected because 400 < 600
      await expect(
        executeSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-02-10",
            decision: "SUGGESTED",
            reason: "Attempting below paid interest",
            quoteBalanceHash: preview.quoteBalanceHash,
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
      ).rejects.toThrow(
        /Final total interest.*cannot be less than interest already paid/,
      );

      // MANUAL 500 must also be rejected because 500 < 600
      await expect(
        executeSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-02-10",
            decision: "MANUAL",
            manualFinalTotalInterest: "500",
            reason: "Attempting below paid interest manually",
            quoteBalanceHash: preview.quoteBalanceHash,
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
      ).rejects.toThrow(
        /Final total interest.*cannot be less than interest already paid/,
      );

      // MANUAL 600 must succeed
      const res = await executeSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
          decision: "MANUAL",
          manualFinalTotalInterest: "600",
          reason: "Approved at exactly interest already paid",
          quoteBalanceHash: preview.quoteBalanceHash,
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        settleGateway,
      );
      expect(res.settled).toBe(true);
      expect(res.finalTotalInterest).toBe("600");
      expect(res.adjustmentDelta).toBe("-400"); // 600 - 1000 = -400
      expect(res.payoffAmount).toBe("10000"); // 10000 principal + 0 remaining interest
    });

    it("supports RETAIN_CURRENT decision, closing the agreement without creating an adjustment row", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );

      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      const res = await executeSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
          decision: "RETAIN_CURRENT",
          reason: "Owner decided to retain original contractual interest",
          quoteBalanceHash: preview.quoteBalanceHash,
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        settleGateway,
      );

      expect(res.settled).toBe(true);
      expect(res.adjustmentDelta).toBe("0");
      expect(res.adjustmentId).toBeNull();
      expect(res.finalTotalInterest).toBe("1000");
      expect(res.payoffAmount).toBe("11000");

      const loan = await db.loan.findUniqueOrThrow({
        where: { id: l.loanId },
        include: { adjustments: true },
      });
      expect(loan.status).toBe("CLOSED");
      expect(loan.adjustments).toHaveLength(0); // Zero adjustments
    });

    it("supports MANUAL decision allowing owner to set agreed final total interest", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );

      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      const res = await executeSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
          decision: "MANUAL",
          manualFinalTotalInterest: "550",
          reason: "Negotiated round figure total interest with borrower",
          quoteBalanceHash: preview.quoteBalanceHash,
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        settleGateway,
      );

      expect(res.settled).toBe(true);
      expect(res.finalTotalInterest).toBe("550");
      expect(res.adjustmentDelta).toBe("-450");
      expect(res.payoffAmount).toBe("10550");

      const loan = await db.loan.findUniqueOrThrow({
        where: { id: l.loanId },
        include: { adjustments: true },
      });
      expect(loan.status).toBe("CLOSED");
      expect(loan.adjustments[0].amount.toString()).toBe("-450");
    });

    it("replaces prior adjustments with a signed delta rather than repeatedly subtracting discounts", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );

      // Prior adjustment of -100
      await db.interestAdjustment.create({
        data: {
          loanId: l.loanId,
          amount: "-100",
          reason: "Prior courtesy discount",
          performedBy: "test-owner",
        },
      });

      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      expect(preview.currentAdjustedInterest).toBe("900");
      expect(preview.suggestedTotalInterest).toBe("400");

      const res = await executeSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
          decision: "SUGGESTED",
          reason: "Early closure replaces prior adjusted interest",
          quoteBalanceHash: preview.quoteBalanceHash,
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        settleGateway,
      );

      // Delta should be 400 - 900 = -500
      expect(res.adjustmentDelta).toBe("-500");
      expect(res.finalTotalInterest).toBe("400");

      const loan = await db.loan.findUniqueOrThrow({
        where: { id: l.loanId },
        include: { adjustments: true },
      });
      expect(loan.adjustments).toHaveLength(2);
      const sumAdjustments = loan.adjustments.reduce(
        (sum, a) => sum + Number(a.amount),
        0,
      );
      expect(sumAdjustments).toBe(-600); // 1000 - 600 = 400!
    });

    it("handles zero-interest agreements cleanly", async () => {
      const l = await disburseLoan(
        {
          ...loan100Days(),
          rate: "0",
        },
        new PrismaDisbursementGateway(db),
      );

      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      expect(preview.originalInterest).toBe("0");
      expect(preview.suggestedTotalInterest).toBe("0");
      expect(preview.suggestedPayoff).toBe("10000");

      const res = await executeSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
          decision: "SUGGESTED",
          reason: "Zero-interest loan early settlement",
          quoteBalanceHash: preview.quoteBalanceHash,
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        settleGateway,
      );

      expect(res.settled).toBe(true);
      expect(res.adjustmentDelta).toBe("0");
      expect(res.payoffAmount).toBe("10000");
      expect(res.adjustmentId).toBeNull();
    });

    it("handles zero cash legitimately due without creating zero-value Payment or PoolTransaction rows", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );

      // Fully pay principal 10000 and 400 interest beforehand
      const { p } = await db.$transaction(async (tx) => {
        const p = await tx.payment.create({
          data: {
            loanId: l.loanId,
            amount: "10400",
            fees: "0",
            interest: "400",
            principal: "10000",
            transactionDate: new Date("2026-01-15T00:00:00.000Z"),
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
            requestHash: "test-hash",
          },
        });
        await tx.poolTransaction.create({
          data: {
            direction: "IN",
            type: "BORROWER_REPAYMENT_IN",
            amount: "10400",
            transactionDate: new Date("2026-01-15T00:00:00.000Z"),
            loanId: l.loanId,
            paymentId: p.id,
            performedBy: "test-owner",
          },
        });
        return { p };
      });

      const paymentCountBefore = await db.payment.count();
      const poolTxCountBefore = await db.poolTransaction.count();

      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      expect(preview.outstandingPrincipal).toBe("0");
      expect(preview.interestPaid).toBe("400");
      expect(preview.suggestedTotalInterest).toBe("400");
      expect(preview.suggestedPayoff).toBe("0");

      const settleKey = randomUUID();
      const res = await executeSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
          decision: "SUGGESTED",
          reason: "Closing out loan with zero remaining cash due",
          quoteBalanceHash: preview.quoteBalanceHash,
          idempotencyKey: settleKey,
          performedBy: "test-owner",
        },
        settleGateway,
      );

      expect(res.settled).toBe(true);
      expect(res.payoffAmount).toBe("0");
      expect(res.paymentId).toBeNull();
      expect(res.poolTransactionId).toBeNull();
      expect(res.adjustmentDelta).toBe("-600");

      // Verify no new Payment or PoolTransaction was inserted
      expect(await db.payment.count()).toBe(paymentCountBefore);
      expect(await db.poolTransaction.count()).toBe(poolTxCountBefore);

      // Verify loan is closed and settlement operation was recorded
      const loan = await db.loan.findUniqueOrThrow({ where: { id: l.loanId } });
      expect(loan.status).toBe("CLOSED");

      const op = await db.settlementOperation.findUniqueOrThrow({
        where: { idempotencyKey: settleKey },
      });
      expect(op.paymentId).toBeNull();
      expect(op.payoffAmount.toString()).toBe("0");
    });

    it("enforces date boundaries: startDate allowed (0 elapsed), dueDate and post-dueDate rejected", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );
      const settleGateway = new PrismaSettlementGateway(db);

      // Settlement on start date (2026-01-01) -> 0 elapsed days
      const previewStart = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-01-01",
        },
        settleGateway,
      );
      expect(previewStart.elapsedDays).toBe(0);
      expect(previewStart.suggestedTotalInterest).toBe("0");

      // Settlement on due date (2026-04-11) -> rejected
      await expect(
        previewSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-04-11",
          },
          settleGateway,
        ),
      ).rejects.toThrow(/Early closure applies strictly before the due date/);

      // Settlement before start date -> rejected
      await expect(
        previewSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2025-12-31",
          },
          settleGateway,
        ),
      ).rejects.toThrow(/Settlement date cannot precede the agreement start date/);
    });

    it("rejects lender borrowing settlement when pool cash is insufficient and rolls back entirely", async () => {
      const b = await receiveBorrowing(
        borrowing100Days(),
        new PrismaBorrowingGateway(db),
      );

      // Drain pool cash by disbursing a large loan
      const currentPool = await poolBalance(db); // 50000 + 10000 = 60000
      await disburseLoan(
        {
          ...request(),
          principal: "55000",
          rate: "0",
          startDate: "2026-01-01",
          dueDate: "2026-04-01",
        },
        new PrismaDisbursementGateway(db),
      );
      // Pool now has 5,000 available. Payoff is 10,400 > 5,000.
      expect((await poolBalance(db)).toString()).toBe("5000");

      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: b.borrowingId,
          agreementType: "BORROWING",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      await expect(
        executeSettlement(
          {
            agreementId: b.borrowingId,
            agreementType: "BORROWING",
            settlementDate: "2026-02-10",
            decision: "SUGGESTED",
            reason: "Attempting lender settlement with insufficient pool",
            quoteBalanceHash: preview.quoteBalanceHash,
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
      ).rejects.toThrow(/Insufficient available pool funds/);

      // Verify borrowing remains ACTIVE and nothing was inserted
      const borrowing = await db.borrowing.findUniqueOrThrow({
        where: { id: b.borrowingId },
      });
      expect(borrowing.status).toBe("ACTIVE");
      expect(await db.payment.count()).toBe(0);
      expect(await db.interestAdjustment.count()).toBe(0);
      expect(await db.settlementOperation.count()).toBe(0);
    });

    it("rejects stale preview quote when balances change prior to confirmation", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );
      const settleGateway = new PrismaSettlementGateway(db);

      // Obtain preview quote
      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      // Now a repayment occurs before settlement is confirmed
      const repayGateway = new PrismaRepaymentGateway(db);
      await repayLoan(
        {
          loanId: l.loanId,
          amount: "1000",
          paymentDate: "2026-01-15",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      // Attempting to execute with stale quoteBalanceHash must be rejected
      await expect(
        executeSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-02-10",
            decision: "SUGGESTED",
            reason: "Executing with stale quote",
            quoteBalanceHash: preview.quoteBalanceHash,
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
      ).rejects.toThrow(/Agreement balances or payments have changed/);
    });

    it("safely replays identical settlement after closure and rejects changed payload under same key", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );
      const settleGateway = new PrismaSettlementGateway(db);

      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      const key = randomUUID();
      const payload = {
        agreementId: l.loanId,
        agreementType: "LOAN" as const,
        settlementDate: "2026-02-10",
        decision: "SUGGESTED" as const,
        reason: "Early closure replay test",
        quoteBalanceHash: preview.quoteBalanceHash,
        idempotencyKey: key,
        performedBy: "test-owner",
      };

      const first = await executeSettlement(payload, settleGateway);
      expect(first.replayed).toBe(false);

      // Replay identical
      const second = await executeSettlement(payload, settleGateway);
      expect(second.replayed).toBe(true);
      expect(second.payoffAmount).toBe(first.payoffAmount);
      expect(second.warnings).toContain(
        "Already recorded. No second settlement was made.",
      );
      expect(await db.settlementOperation.count()).toBe(1);

      // Changed payload with same key must reject
      await expect(
        executeSettlement(
          {
            ...payload,
            reason: "Altered reason payload",
          },
          settleGateway,
        ),
      ).rejects.toThrow(/This submission key was already used for different details/);
    });

    it("serializes concurrent duplicate settlement requests to prevent double closure or double adjustment", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );
      const settleGateway = new PrismaSettlementGateway(db);

      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      // Two concurrent settlement requests with different keys
      const results = await Promise.allSettled([
        executeSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-02-10",
            decision: "SUGGESTED",
            reason: "Concurrent 1",
            quoteBalanceHash: preview.quoteBalanceHash,
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
        executeSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-02-10",
            decision: "SUGGESTED",
            reason: "Concurrent 2",
            quoteBalanceHash: preview.quoteBalanceHash,
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
      ]);

      const fulfilled = results.filter((x) => x.status === "fulfilled");
      const rejected = results.filter((x) => x.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(await db.settlementOperation.count()).toBe(1);
      expect(await db.interestAdjustment.count()).toBe(1);
    });

    it("proves complete rollback on pool write failure using sequence witness", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );
      const settleGateway = new PrismaSettlementGateway(db);

      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      await expect(
        executeSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-02-10",
            decision: "SUGGESTED",
            reason: "Testing pool write failure rollback",
            quoteBalanceHash: preview.quoteBalanceHash,
            reference: "TEST_FORCE_SETTLEMENT_POOL_FAILURE",
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
      ).rejects.toThrow(/pool failed after visible settlement payment insert/);

      // Sequence witness confirms adjustment was inserted in PostgreSQL before rollback
      const adjWitness = await db.$queryRawUnsafe<{ is_called: boolean }[]>(
        "SELECT is_called FROM test_adjustment_insert_witness",
      );
      expect(adjWitness[0].is_called).toBe(true);

      // But everything was rolled back
      expect(await db.interestAdjustment.count()).toBe(0);
      expect(await db.payment.count()).toBe(0);
      expect(await db.settlementOperation.count()).toBe(0);
      const loan = await db.loan.findUniqueOrThrow({ where: { id: l.loanId } });
      expect(loan.status).toBe("ACTIVE");
    });

    it("proves complete rollback when transactional auditing fails", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );
      const failingAudit = {
        write: async () => {
          throw new Error("Audit log database failure");
        },
      };
      const settleGateway = new PrismaSettlementGateway(db, failingAudit);
      const normalGateway = new PrismaSettlementGateway(db);

      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        normalGateway,
      );

      await expect(
        executeSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-02-10",
            decision: "SUGGESTED",
            reason: "Audit failure test",
            quoteBalanceHash: preview.quoteBalanceHash,
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
      ).rejects.toThrow("Audit log database failure");

      expect(await db.interestAdjustment.count()).toBe(0);
      expect(await db.payment.count()).toBe(0);
      expect(await db.settlementOperation.count()).toBe(0);
      const loan = await db.loan.findUniqueOrThrow({ where: { id: l.loanId } });
      expect(loan.status).toBe("ACTIVE");
    });

    it("proves complete rollback when adjustment write fails during settlement", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );
      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      await expect(
        executeSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-02-10",
            decision: "SUGGESTED",
            reason: "TEST_FORCE_ADJUSTMENT_FAILURE",
            quoteBalanceHash: preview.quoteBalanceHash,
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
      ).rejects.toThrow(/TEST: adjustment failed during settlement/);

      expect(await db.interestAdjustment.count()).toBe(0);
      expect(await db.payment.count()).toBe(0);
      expect(await db.settlementOperation.count()).toBe(0);
      const loan = await db.loan.findUniqueOrThrow({ where: { id: l.loanId } });
      expect(loan.status).toBe("ACTIVE");
    });

    it("proves complete rollback when payment write fails during settlement using adjustment sequence witness", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );
      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      await expect(
        executeSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-02-10",
            decision: "SUGGESTED",
            reason: "Testing payment write failure rollback",
            quoteBalanceHash: preview.quoteBalanceHash,
            reference: "TEST_FORCE_SETTLEMENT_PAYMENT_FAILURE",
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
      ).rejects.toThrow(/TEST: settlement payment failed after visible adjustment insert/);

      // Sequence witness confirms adjustment was inserted in PostgreSQL before rollback
      const adjWitness = await db.$queryRawUnsafe<{ is_called: boolean }[]>(
        "SELECT is_called FROM test_adjustment_insert_witness",
      );
      expect(adjWitness[0].is_called).toBe(true);

      // But everything was rolled back
      expect(await db.interestAdjustment.count()).toBe(0);
      expect(await db.payment.count()).toBe(0);
      expect(await db.settlementOperation.count()).toBe(0);
      const loan = await db.loan.findUniqueOrThrow({ where: { id: l.loanId } });
      expect(loan.status).toBe("ACTIVE");
    });

    it("proves complete rollback when agreement status update fails during settlement using adjustment and payment sequence witnesses", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );
      const settleGateway = new PrismaSettlementGateway(db);
      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      await expect(
        executeSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-02-10",
            decision: "SUGGESTED",
            reason: "Testing status write failure rollback",
            quoteBalanceHash: preview.quoteBalanceHash,
            reference: "TEST_FORCE_STATUS_FAILURE",
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
      ).rejects.toThrow(/TEST: status update failed after visible adjustment, payment and pool movement/);

      // Sequence witness confirms adjustment and payment were inserted in PostgreSQL before rollback
      const adjWitness = await db.$queryRawUnsafe<{ is_called: boolean }[]>(
        "SELECT is_called FROM test_adjustment_insert_witness",
      );
      expect(adjWitness[0].is_called).toBe(true);
      const repWitness = await db.$queryRawUnsafe<{ is_called: boolean }[]>(
        "SELECT is_called FROM test_repayment_insert_witness",
      );
      expect(repWitness[0].is_called).toBe(true);

      // But everything was rolled back
      expect(await db.interestAdjustment.count()).toBe(0);
      expect(await db.payment.count()).toBe(0);
      expect(await db.settlementOperation.count()).toBe(0);
      const loan = await db.loan.findUniqueOrThrow({ where: { id: l.loanId } });
      expect(loan.status).toBe("ACTIVE");
    });

    it("proves original agreement terms remain immutable under direct SQL update attempts", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );
      const settleGateway = new PrismaSettlementGateway(db);

      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        settleGateway,
      );

      await executeSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
          decision: "SUGGESTED",
          reason: "Immutability check test",
          quoteBalanceHash: preview.quoteBalanceHash,
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        settleGateway,
      );

      // Attempting to reopen closed loan fails
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Loan" SET status = 'ACTIVE' WHERE id = '${l.loanId}'`,
        ),
      ).rejects.toThrow(/Closed loans cannot be reopened/);

      // Attempting to alter principal or dates fails
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Loan" SET principal = 99999 WHERE id = '${l.loanId}'`,
        ),
      ).rejects.toThrow(/Original loan terms and agreement history are immutable/);
    });

    it("verifies standard repayments continue to work normally", async () => {
      const l = await disburseLoan(
        loan100Days(),
        new PrismaDisbursementGateway(db),
      );
      const repayGateway = new PrismaRepaymentGateway(db);

      const rep = await repayLoan(
        {
          loanId: l.loanId,
          amount: "5000",
          paymentDate: "2026-01-15",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      expect(rep.settled).toBe(false);
      expect(rep.allocation.principal).toBe("4000");
      expect(rep.allocation.interest).toBe("1000");
    });
  });

  describe("Phase 6: Safe Corrections, Statements, and Reconciliation", () => {
    it("reverses a borrower repayment on an active loan atomically, restoring balances and debiting pool", async () => {
      // Disburse loan (₹20,000 principal, ₹598 interest approx for 90 days @ 12%)
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);
      const rep = await repayLoan(repaymentRequest(l.loanId), repayGateway);
      expect(rep.settled).toBe(false);

      const poolBeforeReversal = await poolBalance(db);
      const sBefore = await snapshot(db);
      const snapLoanBefore = sBefore.loans.find((x) => x.id === l.loanId)!;
      expect(snapLoanBefore.payments).toHaveLength(1);
      const paymentId = snapLoanBefore.payments[0].id;

      // Execute reversal
      const reversalGateway = new PrismaReversalGateway(db);
      const revResult = await reversePayment(
        {
          paymentId,
          reversalDate: "2026-01-20",
          reason: "Payment reversed due to duplicate bank transfer entry",
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        reversalGateway,
      );

      expect(revResult.amountReversed).toBe("5000");
      expect(revResult.reinstatedPrincipal).toBe(rep.allocation.principal);
      expect(revResult.reinstatedInterest).toBe(rep.allocation.interest);
      expect(revResult.replayed).toBe(false);

      // Verify DB records
      const revRow = await db.paymentReversal.findUniqueOrThrow({
        where: { paymentId },
      });
      expect(revRow.reason).toBe("Payment reversed due to duplicate bank transfer entry");
      expect(revRow.performedBy).toBe("test-owner");

      // Verify compensating pool transaction (direction OUT, type BORROWER_REPAYMENT_REVERSAL_OUT)
      const compPoolTx = await db.poolTransaction.findFirstOrThrow({
        where: { paymentReversalId: revRow.id },
      });
      expect(compPoolTx.direction).toBe("OUT");
      expect(compPoolTx.type).toBe("BORROWER_REPAYMENT_REVERSAL_OUT");
      expect(compPoolTx.amount.toString()).toBe("5000");

      // Verify pool balance decreased by ₹5,000
      const poolAfterReversal = await poolBalance(db);
      expect(poolAfterReversal.toString()).toBe(poolBeforeReversal.minus("5000").toString());

      // Verify snapshot shows balances reinstated and payment flagged as reversed
      const sAfter = await snapshot(db);
      const snapLoanAfter = sAfter.loans.find((x) => x.id === l.loanId)!;
      expect(snapLoanAfter.payments).toHaveLength(1);
      expect(snapLoanAfter.payments[0].reversed).toBe(true);
      expect(snapLoanAfter.payments[0].reversalReason).toBe("Payment reversed due to duplicate bank transfer entry");
      expect(snapLoanAfter.payments[0].canReverse).toBe(false); // already reversed
      expect(snapLoanAfter.remainingPrincipal).toBe(snapLoanBefore.principal);
      expect(snapLoanAfter.remainingInterest).toBe(snapLoanBefore.interest);

      // Verify audit log
      const audit = await db.auditLog.findFirstOrThrow({
        where: { entityId: l.loanId, action: "BORROWER_REPAYMENT_REVERSED" },
      });
      expect(audit.performedBy).toBe("test-owner");
    });

    it("reverses a lender repayment on an active borrowing atomically, restoring balances and crediting pool", async () => {
      // Receive borrowing (₹25,000 principal)
      const b = await receiveBorrowing(borrowingRequest(), new PrismaBorrowingGateway(db));
      const lenderRepayGateway = new PrismaLenderRepaymentGateway(db);
      const rep = await repayLender(lenderRepaymentRequest(b.borrowingId), lenderRepayGateway);

      const poolBeforeReversal = await poolBalance(db);
      const sBefore = await snapshot(db);
      const snapBorrowingBefore = sBefore.borrowings.find((x) => x.id === b.borrowingId)!;
      const paymentId = snapBorrowingBefore.payments[0].id;

      // Execute reversal
      const reversalGateway = new PrismaReversalGateway(db);
      const revResult = await reversePayment(
        {
          paymentId,
          reversalDate: "2026-01-20",
          reason: "Incorrect bank account debited; reversing lender payout",
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        reversalGateway,
      );

      expect(revResult.amountReversed).toBe("5000");
      expect(revResult.reinstatedPrincipal).toBe(rep.allocation.principal);
      expect(revResult.reinstatedInterest).toBe(rep.allocation.interest);

      // Verify compensating pool transaction (direction IN, type LENDER_REPAYMENT_REVERSAL_IN)
      const compPoolTx = await db.poolTransaction.findFirstOrThrow({
        where: { paymentReversalId: revResult.reversalId },
      });
      expect(compPoolTx.direction).toBe("IN");
      expect(compPoolTx.type).toBe("LENDER_REPAYMENT_REVERSAL_IN");
      expect(compPoolTx.amount.toString()).toBe("5000");

      // Verify pool balance increased by ₹5,000
      const poolAfterReversal = await poolBalance(db);
      expect(poolAfterReversal.toString()).toBe(poolBeforeReversal.plus("5000").toString());

      // Verify snapshot shows borrowing balance reinstated
      const sAfter = await snapshot(db);
      const snapBorrowingAfter = sAfter.borrowings.find((x) => x.id === b.borrowingId)!;
      expect(snapBorrowingAfter.remainingPrincipal).toBe(snapBorrowingBefore.principal);
      expect(snapBorrowingAfter.remainingInterest).toBe(snapBorrowingBefore.interest);
    });

    it("rejects borrower repayment reversal if pool cash is insufficient", async () => {
      // Disburse loan
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);
      await repayLoan(repaymentRequest(l.loanId), repayGateway);

      const s = await snapshot(db);
      const paymentId = s.loans.find((x) => x.id === l.loanId)!.payments[0].id;

      // Artificially withdraw equity to leave pool cash at ₹1,000 (less than ₹5,000 reversal needed)
      const currentPool = await poolBalance(db);
      const drainAmount = currentPool.minus(1000);
      if (drainAmount.gt(0)) {
        const eq = await db.equityEntry.create({
          data: {
            amount: drainAmount.toString(),
            type: "WITHDRAWAL",
            transactionDate: new Date("2026-01-18"),
            performedBy: "test-owner",
            idempotencyKey: randomUUID(),
            requestHash: "test-drain-hash",
            reason: "Temporary test withdrawal",
          },
        });
        await db.poolTransaction.create({
          data: {
            direction: "OUT",
            amount: drainAmount.toString(),
            type: "EQUITY_WITHDRAWAL_OUT",
            transactionDate: new Date("2026-01-18"),
            equityEntryId: eq.id,
            performedBy: "test-owner",
            reference: "Drain pool for test",
          },
        });
      }

      const reversalGateway = new PrismaReversalGateway(db);
      await expect(
        reversePayment(
          {
            paymentId,
            reversalDate: "2026-01-20",
            reason: "Attempting reversal with insufficient pool funds",
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          reversalGateway,
        ),
      ).rejects.toThrow(/Insufficient available pool funds/);

      // Verify payment was NOT reversed
      expect(await db.paymentReversal.count()).toBe(0);
    });

    it("rejects reversal if agreement is closed (e.g. after early settlement)", async () => {
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const settleGateway = new PrismaSettlementGateway(db);

      const preview = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-01",
        },
        settleGateway,
      );

      await executeSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-01",
          decision: "SUGGESTED",
          reason: "Full payoff early settlement",
          quoteBalanceHash: preview.quoteBalanceHash,
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        settleGateway,
      );

      const loan = await db.loan.findUniqueOrThrow({
        where: { id: l.loanId },
        include: { payments: true },
      });
      expect(loan.status).toBe("CLOSED");
      const settlementPaymentId = loan.payments[0].id;

      const reversalGateway = new PrismaReversalGateway(db);
      await expect(
        reversePayment(
          {
            paymentId: settlementPaymentId,
            reversalDate: "2026-02-02",
            reason: "Trying to reverse closed settlement",
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          reversalGateway,
        ),
      ).rejects.toThrow(/Payments on closed agreements cannot be reversed/);
    });

    it("rejects reversal of an older payment if downstream non-reversed payments exist", async () => {
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);

      // First payment
      const p1 = await repayLoan(
        {
          loanId: l.loanId,
          amount: "2000",
          paymentDate: "2026-01-10",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      // Second payment
      const p2 = await repayLoan(
        {
          loanId: l.loanId,
          amount: "3000",
          paymentDate: "2026-01-20",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      const reversalGateway = new PrismaReversalGateway(db);

      // Attempt to reverse first payment p1 -> should fail because p2 exists
      await expect(
        reversePayment(
          {
            paymentId: p1.paymentId,
            reversalDate: "2026-01-25",
            reason: "Attempting to reverse non-latest payment",
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          reversalGateway,
        ),
      ).rejects.toThrow(/Only the latest repayment on an active agreement can be safely reversed/);

      // Reverse latest payment p2 -> succeeds!
      await reversePayment(
        {
          paymentId: p2.paymentId,
          reversalDate: "2026-01-25",
          reason: "Reversing latest payment p2 first",
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        reversalGateway,
      );

      // Now p1 IS the latest non-reversed payment -> reversing p1 succeeds!
      const revP1 = await reversePayment(
        {
          paymentId: p1.paymentId,
          reversalDate: "2026-01-26",
          reason: "Now p1 is the latest active payment",
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        reversalGateway,
      );
      expect(revP1.amountReversed).toBe("2000");
    });

    it("supports idempotent replay of reversePayment and rejects conflicting command", async () => {
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);
      const rep = await repayLoan(repaymentRequest(l.loanId), repayGateway);

      const idempotencyKey = randomUUID();
      const reversalGateway = new PrismaReversalGateway(db);

      const res1 = await reversePayment(
        {
          paymentId: rep.paymentId,
          reversalDate: "2026-01-20",
          reason: "First attempt at reversal",
          idempotencyKey,
          performedBy: "test-owner",
        },
        reversalGateway,
      );
      expect(res1.replayed).toBe(false);

      // Replay with exact same payload
      const res2 = await reversePayment(
        {
          paymentId: rep.paymentId,
          reversalDate: "2026-01-20",
          reason: "First attempt at reversal",
          idempotencyKey,
          performedBy: "test-owner",
        },
        reversalGateway,
      );
      expect(res2.replayed).toBe(true);
      expect(res2.reversalId).toBe(res1.reversalId);
      expect(await db.paymentReversal.count()).toBe(1);

      // Replay with differing payload
      await expect(
        reversePayment(
          {
            paymentId: rep.paymentId,
            reversalDate: "2026-01-25", // changed date
            reason: "Differing reason",
            idempotencyKey,
            performedBy: "test-owner",
          },
          reversalGateway,
        ),
      ).rejects.toThrow(/already used for different details/);
    });

    it("proves complete atomic rollback when compensating pool transaction fails during reversal", async () => {
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);
      const rep = await repayLoan(
        {
          ...repaymentRequest(l.loanId),
          reference: "TEST_FORCE_REVERSAL_POOL_FAILURE",
        },
        repayGateway,
      );

      const reversalGateway = new PrismaReversalGateway(db);

      await expect(
        reversePayment(
          {
            paymentId: rep.paymentId,
            reversalDate: "2026-01-20",
            reason: "TEST_FORCE_REVERSAL_POOL_FAILURE",
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          reversalGateway,
        ),
      ).rejects.toThrow(/TEST: pool failed after visible reversal insert/);

      // Sequence witness confirms reversal insert was executed in PG before rollback
      const revWitness = await db.$queryRawUnsafe<{ is_called: boolean }[]>(
        "SELECT is_called FROM test_reversal_insert_witness",
      );
      expect(revWitness[0].is_called).toBe(true);

      // But everything was rolled back atomically!
      expect(await db.paymentReversal.count()).toBe(0);
      expect(await db.poolTransaction.count({ where: { type: "BORROWER_REPAYMENT_REVERSAL_OUT" } })).toBe(0);

      // Payment remains active
      const s = await snapshot(db);
      const snapLoan = s.loans.find((x) => x.id === l.loanId)!;
      expect(snapLoan.payments[0].reversed).toBe(false);
      expect(snapLoan.payments[0].reversalDate).toBeNull();
    });

    it("verifies reconciliation engine reports healthy status on valid active ledger", async () => {
      // Create healthy activity: disburse, borrow, repay, reverse
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const b = await receiveBorrowing(borrowingRequest(), new PrismaBorrowingGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);
      const rep = await repayLoan(repaymentRequest(l.loanId), repayGateway);

      // Run reconciliation
      const reconciliationGateway = new PrismaReconciliationGateway(db);
      const report = await runReconciliation(reconciliationGateway);

      expect(report.healthy).toBe(true);
      expect(report.discrepancies).toHaveLength(0);
      expect(report.metrics.criticalDiscrepancies).toBe(0);
      expect(report.metrics.warningDiscrepancies).toBe(0);
      expect(report.metrics.totalLoans).toBe(1);
      expect(report.metrics.totalBorrowings).toBe(1);
      expect(report.metrics.totalPayments).toBe(1);
    });

    it("verifies reconciliation engine flags discrepancies on corrupted ledger and recovers when fixed", async () => {
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);
      const rep = await repayLoan(repaymentRequest(l.loanId), repayGateway);

      const reconciliationGateway = new PrismaReconciliationGateway(db);

      // Corrupt matching pool transaction amount by altering amount with protect_pool disabled
      await db.$executeRawUnsafe('ALTER TABLE "PoolTransaction" DISABLE TRIGGER protect_pool');
      await db.$executeRawUnsafe(
        `UPDATE "PoolTransaction" SET amount = 9999 WHERE "paymentId" = '${rep.paymentId}'`,
      );

      const reportCorrupt = await runReconciliation(reconciliationGateway);
      expect(reportCorrupt.healthy).toBe(false);
      expect(reportCorrupt.discrepancies.length).toBeGreaterThan(0);
      const poolMismatch = reportCorrupt.discrepancies.find(
        (d) => d.code === "PAYMENT_POOL_AMOUNT_MISMATCH",
      );
      expect(poolMismatch).toBeDefined();
      expect(poolMismatch?.severity).toBe("CRITICAL");

      // Fix corruption and re-enable immutability trigger
      await db.$executeRawUnsafe(
        `UPDATE "PoolTransaction" SET amount = 5000 WHERE "paymentId" = '${rep.paymentId}'`,
      );
      await db.$executeRawUnsafe('ALTER TABLE "PoolTransaction" ENABLE TRIGGER protect_pool');

      const reportClean = await runReconciliation(reconciliationGateway);
      expect(reportClean.healthy).toBe(true);
      expect(reportClean.discrepancies).toHaveLength(0);
    });

    it("generates dated activity ledger, agreement statements and pool statement with running balances", async () => {
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const b = await receiveBorrowing(borrowingRequest(), new PrismaBorrowingGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);
      const rep = await repayLoan(repaymentRequest(l.loanId), repayGateway);

      // 1. Agreement statement
      const loanStatement = await getAgreementStatement(db, l.loanId, "LOAN");
      expect(loanStatement.agreementId).toBe(l.loanId);
      expect(loanStatement.entries.length).toBeGreaterThanOrEqual(2); // Agreement row + Repayment row
      expect(loanStatement.totalPaidPrincipal).toBe(rep.allocation.principal);
      expect(loanStatement.totalPaidInterest).toBe(rep.allocation.interest);

      // 2. Pool statement
      const poolStatement = await getPoolStatement(db);
      expect(poolStatement.entries.length).toBeGreaterThanOrEqual(4); // Equity + Loan disburse + Borrowing in + Repayment in
      const lastLine = poolStatement.entries[poolStatement.entries.length - 1];
      expect(lastLine.runningBalance).toBe(poolStatement.currentBalance);

      // 3. Financial position summary
      const position = await getFinancialPositionSummary(db);
      expect(position.ownCapitalInjected).toBe("50000"); // Initial equity
      expect(position.principalLent.grossDisbursed).toBe("20000");
      expect(position.principalBorrowed.grossBorrowed).toBe("25000");
      expect(position.interest.borrowerInterestReceived).toBe(rep.allocation.interest);
      expect(position.interest.lenderInterestPaid).toBe("0");

      // 4. Activity ledger
      const activity = await getActivityLedger(db);
      expect(activity.length).toBeGreaterThanOrEqual(4);
      expect(activity.every((a) => a.date && a.notes)).toBe(true);
    });

    it("handles concurrent duplicate reversals safely (both same key replay and competing keys rejection)", async () => {
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);
      const rep = await repayLoan(repaymentRequest(l.loanId), repayGateway);

      const reversalGateway = new PrismaReversalGateway(db);

      // Case A: Two concurrent reversal requests for the same payment with DIFFERENT keys
      const key1 = randomUUID();
      const key2 = randomUUID();
      const resultsDiff = await Promise.allSettled([
        reversePayment(
          {
            paymentId: rep.paymentId,
            reversalDate: "2026-01-20",
            reason: "Concurrent attempt A",
            idempotencyKey: key1,
            performedBy: "test-owner",
          },
          reversalGateway,
        ),
        reversePayment(
          {
            paymentId: rep.paymentId,
            reversalDate: "2026-01-20",
            reason: "Concurrent attempt B",
            idempotencyKey: key2,
            performedBy: "test-owner",
          },
          reversalGateway,
        ),
      ]);

      const fulfilled = resultsDiff.filter((r) => r.status === "fulfilled");
      const rejected = resultsDiff.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(await db.paymentReversal.count()).toBe(1);
      expect(
        await db.poolTransaction.count({
          where: { type: "BORROWER_REPAYMENT_REVERSAL_OUT" },
        }),
      ).toBe(1);

      // Case B: Concurrent requests with the SAME idempotency key (idempotent replay)
      const sameKey = randomUUID();
      const l2 = await disburseLoan(
        {
          ...request(),
          startDate: "2026-01-21",
          dueDate: "2026-04-21",
        },
        new PrismaDisbursementGateway(db),
      );
      const rep2 = await repayLoan(
        {
          ...repaymentRequest(l2.loanId),
          paymentDate: "2026-01-22",
        },
        repayGateway,
      );

      const resultsSame = await Promise.allSettled([
        reversePayment(
          {
            paymentId: rep2.paymentId,
            reversalDate: "2026-01-22",
            reason: "Concurrent identical attempt",
            idempotencyKey: sameKey,
            performedBy: "test-owner",
          },
          reversalGateway,
        ),
        reversePayment(
          {
            paymentId: rep2.paymentId,
            reversalDate: "2026-01-22",
            reason: "Concurrent identical attempt",
            idempotencyKey: sameKey,
            performedBy: "test-owner",
          },
          reversalGateway,
        ),
      ]);

      expect(resultsSame.every((r) => r.status === "fulfilled")).toBe(true);
      const resA = (resultsSame[0] as PromiseFulfilledResult<any>).value;
      const resB = (resultsSame[1] as PromiseFulfilledResult<any>).value;
      expect(resA.reversalId).toBe(resB.reversalId);
      const replayedCount = [resA.replayed, resB.replayed].filter(Boolean).length;
      expect(replayedCount).toBe(1);
      expect(await db.paymentReversal.count({ where: { paymentId: rep2.paymentId } })).toBe(1);
    });

    it("confirms retries replay before eligibility checks, even after original payment becomes reversed", async () => {
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);
      const rep = await repayLoan(repaymentRequest(l.loanId), repayGateway);

      const reversalGateway = new PrismaReversalGateway(db);
      const idempotencyKey = randomUUID();

      // First call executes successfully
      const first = await reversePayment(
        {
          paymentId: rep.paymentId,
          reversalDate: "2026-01-20",
          reason: "Testing replay precedence",
          idempotencyKey,
          performedBy: "test-owner",
        },
        reversalGateway,
      );
      expect(first.replayed).toBe(false);

      // Verify the payment in DB is now reversed
      const payInDb = await db.payment.findUniqueOrThrow({
        where: { id: rep.paymentId },
        include: { reversal: true },
      });
      expect(payInDb.reversal).not.toBeNull();

      // Second call with same idempotencyKey must NOT fail with "This payment has already been reversed."
      // Instead, idempotency check precedes eligibility check and successfully returns replayed: true
      const second = await reversePayment(
        {
          paymentId: rep.paymentId,
          reversalDate: "2026-01-20",
          reason: "Testing replay precedence",
          idempotencyKey,
          performedBy: "test-owner",
        },
        reversalGateway,
      );
      expect(second.replayed).toBe(true);
      expect(second.reversalId).toBe(first.reversalId);
      expect(second.warnings).toContain("Already recorded. No second reversal was made.");
    });

    it("enforces database-level uniqueness and trigger validation for compensating movement agreement, amount, date, and direction", async () => {
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);
      const rep = await repayLoan(repaymentRequest(l.loanId), repayGateway);

      const reversalGateway = new PrismaReversalGateway(db);
      const rev = await reversePayment(
        {
          paymentId: rep.paymentId,
          reversalDate: "2026-01-20",
          reason: "Legitimate reversal",
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        reversalGateway,
      );
      expect(rev.reversalId).toBeDefined();

      // 1. Direct DB check: Attempt to insert a second PaymentReversal for the same paymentId must violate PaymentReversal_paymentId_key
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO "PaymentReversal" ("id", "paymentId", "reversalDate", "reason", "performedBy", "idempotencyKey", "requestHash", "createdAt")
           VALUES ('${randomUUID()}', '${rep.paymentId}', DATE '2026-01-21', 'Duplicate DB reversal', 'hacker', '${randomUUID()}', 'hash', NOW())`,
        ),
      ).rejects.toThrow(/PaymentReversal_paymentId_key/);

      // 2. Direct DB check: verify_reversal_movement trigger rejects reversal if amount differs
      const rep2 = await repayLoan(
        {
          ...repaymentRequest(l.loanId),
          paymentDate: "2026-01-21",
        },
        repayGateway,
      );
      const testRevId = randomUUID();
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "PaymentReversal" ("id", "paymentId", "reversalDate", "reason", "performedBy", "idempotencyKey", "requestHash", "createdAt")
             VALUES ('${testRevId}', '${rep2.paymentId}', DATE '2026-01-22', 'Test mismatch amount', 'test-owner', '${randomUUID()}', 'hash', NOW())`,
          );
          // Insert pool movement with WRONG amount (4000 instead of 5000)
          await tx.$executeRawUnsafe(
            `INSERT INTO "PoolTransaction" ("id", "direction", "type", "amount", "transactionDate", "loanId", "paymentReversalId", "performedBy", "createdAt")
             VALUES ('${randomUUID()}', 'OUT', 'BORROWER_REPAYMENT_REVERSAL_OUT', 4000, DATE '2026-01-22', '${l.loanId}', '${testRevId}', 'test-owner', NOW())`,
          );
        }),
      ).rejects.toThrow(/matching compensating OUT movement with identical loan, amount, and date/);

      // 3. Direct DB check: verify_reversal_movement trigger rejects reversal if direction is wrong (IN instead of OUT)
      const testRevId2 = randomUUID();
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "PaymentReversal" ("id", "paymentId", "reversalDate", "reason", "performedBy", "idempotencyKey", "requestHash", "createdAt")
             VALUES ('${testRevId2}', '${rep2.paymentId}', DATE '2026-01-22', 'Test mismatch direction', 'test-owner', '${randomUUID()}', 'hash', NOW())`,
          );
          // Insert pool movement with WRONG direction (IN instead of OUT)
          await tx.$executeRawUnsafe(
            `INSERT INTO "PoolTransaction" ("id", "direction", "type", "amount", "transactionDate", "loanId", "paymentReversalId", "performedBy", "createdAt")
             VALUES ('${randomUUID()}', 'IN', 'LENDER_REPAYMENT_REVERSAL_IN', 5000, DATE '2026-01-22', '${l.loanId}', '${testRevId2}', 'test-owner', NOW())`,
          );
        }),
      ).rejects.toThrow();
    });

    it("verifies a reversal invalidates an older settlement preview even if resulting numeric balances happen to match", async () => {
      const l = await disburseLoan(
        {
          borrowerProfileId: borrowerId,
          principal: "10000",
          rate: "10",
          interestMethod: "ANNUAL_ACTUAL_365",
          startDate: "2026-01-01",
          dueDate: "2026-04-11",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        new PrismaDisbursementGateway(db),
      );
      const repayGateway = new PrismaRepaymentGateway(db);
      const p1 = await repayLoan(
        {
          loanId: l.loanId,
          amount: "2000",
          paymentDate: "2026-01-15",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      const settleGateway = new PrismaSettlementGateway(db);
      const preview1 = await previewSettlement(
        {
          agreementId: l.loanId,
          agreementType: "LOAN",
          settlementDate: "2026-02-01",
        },
        settleGateway,
      );

      // Reverse payment p1
      const reversalGateway = new PrismaReversalGateway(db);
      await reversePayment(
        {
          paymentId: p1.paymentId,
          reversalDate: "2026-01-20",
          reason: "Reversing payment to test settlement invalidation",
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        reversalGateway,
      );

      // Now make a new payment p2 of the EXACT SAME AMOUNT (2000) on 2026-01-20
      await repayLoan(
        {
          loanId: l.loanId,
          amount: "2000",
          paymentDate: "2026-01-20",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      // The numeric outstanding balances match preview1 exactly (principal paid 2000, interest paid matches),
      // BUT payment fingerprint has changed because p2 has a different ID!
      await expect(
        executeSettlement(
          {
            agreementId: l.loanId,
            agreementType: "LOAN",
            settlementDate: "2026-02-01",
            decision: "SUGGESTED",
            reason: "Attempting settlement with stale quote",
            quoteBalanceHash: preview1.quoteBalanceHash,
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          settleGateway,
        ),
      ).rejects.toThrow(/Agreement balances or payments have changed since the preview quote was calculated/);
    });

    it("verifies deterministic ordering and reversal eligibility when payments share the same date", async () => {
      const l = await disburseLoan(request(), new PrismaDisbursementGateway(db));
      const repayGateway = new PrismaRepaymentGateway(db);

      // Submit two payments with the SAME date (2026-01-15)
      const pay1 = await repayLoan(
        {
          loanId: l.loanId,
          amount: "1000",
          paymentDate: "2026-01-15",
          reference: "PAY_SAME_DATE_1",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      const pay2 = await repayLoan(
        {
          loanId: l.loanId,
          amount: "2000",
          paymentDate: "2026-01-15",
          reference: "PAY_SAME_DATE_2",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      const reversalGateway = new PrismaReversalGateway(db);

      // pay1 was created first, pay2 was created second.
      // Attempting to reverse pay1 directly must fail because pay2 is the latest active payment!
      await expect(
        reversePayment(
          {
            paymentId: pay1.paymentId,
            reversalDate: "2026-01-15",
            reason: "Trying to reverse earlier same-date payment",
            idempotencyKey: randomUUID(),
            performedBy: "test-owner",
          },
          reversalGateway,
        ),
      ).rejects.toThrow(/Only the latest repayment on an active agreement can be safely reversed/);

      // Reversing pay2 succeeds
      const revPay2 = await reversePayment(
        {
          paymentId: pay2.paymentId,
          reversalDate: "2026-01-15",
          reason: "Reversing latest same-date payment",
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        reversalGateway,
      );
      expect(revPay2.amountReversed).toBe("2000");

      // Now pay1 is the latest active payment and can be reversed
      const revPay1 = await reversePayment(
        {
          paymentId: pay1.paymentId,
          reversalDate: "2026-01-15",
          reason: "Now reversing pay1 which is now latest",
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        reversalGateway,
      );
      expect(revPay1.amountReversed).toBe("1000");
    });

    it("verifies filtered statements include opening balance and as-of reports exclude later events", async () => {
      const l = await disburseLoan(
        {
          borrowerProfileId: borrowerId,
          principal: "20000",
          rate: "12",
          interestMethod: "ANNUAL_ACTUAL_365",
          startDate: "2026-01-01",
          dueDate: "2026-04-01",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        new PrismaDisbursementGateway(db),
      );
      const repayGateway = new PrismaRepaymentGateway(db);

      // Payment 1 on 2026-01-10
      await repayLoan(
        {
          loanId: l.loanId,
          amount: "3000",
          paymentDate: "2026-01-10",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      // Payment 2 on 2026-01-20
      const p2 = await repayLoan(
        {
          loanId: l.loanId,
          amount: "4000",
          paymentDate: "2026-01-20",
          performedBy: "test-owner",
          idempotencyKey: randomUUID(),
        },
        repayGateway,
      );

      // Reversal of Payment 2 on 2026-01-25
      const reversalGateway = new PrismaReversalGateway(db);
      await reversePayment(
        {
          paymentId: p2.paymentId,
          reversalDate: "2026-01-25",
          reason: "Reversing payment 2 on 25th",
          idempotencyKey: randomUUID(),
          performedBy: "test-owner",
        },
        reversalGateway,
      );

      // 1. Filtered statement with fromDate="2026-01-15":
      // Must include openingBalance reflecting disbursement + Payment 1, but exclude Payment 1 from entries list
      const stmtFiltered = await getAgreementStatement(db, l.loanId, "LOAN", {
        fromDate: "2026-01-15",
        toDate: "2026-01-31",
      });
      expect(stmtFiltered.openingBalance).toBeDefined();
      expect(stmtFiltered.openingBalance?.date).toBe("2026-01-15");
      expect(Number(stmtFiltered.openingBalance?.totalOwed)).toBeLessThan(20000 + 600);

      // 2. As-of report as of "2026-01-15":
      // At 2026-01-15, Payment 1 was made, Payment 2 was NOT made yet, Reversal was NOT made yet
      const stmtAsOf15 = await getAgreementStatement(db, l.loanId, "LOAN", {
        asOfDate: "2026-01-15",
      });
      expect(stmtAsOf15.entries.some((e) => e.date === "2026-01-10")).toBe(true);
      expect(stmtAsOf15.entries.some((e) => e.date === "2026-01-20")).toBe(false);
      expect(stmtAsOf15.entries.some((e) => e.date === "2026-01-25")).toBe(false);

      // 3. As-of report as of "2026-01-22":
      // At 2026-01-22, Payment 2 was made, but Reversal on 25th had NOT yet occurred!
      // So Payment 2 is still ACTIVE as of the 22nd!
      const stmtAsOf22 = await getAgreementStatement(db, l.loanId, "LOAN", {
        asOfDate: "2026-01-22",
      });
      expect(stmtAsOf22.entries.some((e) => e.date === "2026-01-20")).toBe(true);
      expect(stmtAsOf22.entries.some((e) => e.date === "2026-01-25")).toBe(false);
      // Total amount paid (principal + interest) as of the 22nd is 7000 (3000 + 4000)
      expect(Number(stmtAsOf22.totalPaidPrincipal) + Number(stmtAsOf22.totalPaidInterest)).toBe(7000);

      // 4. As-of report as of "2026-01-30":
      // Reversal on 25th HAS occurred, so total amount paid drops back to 3000!
      const stmtAsOf30 = await getAgreementStatement(db, l.loanId, "LOAN", {
        asOfDate: "2026-01-30",
      });
      expect(Number(stmtAsOf30.totalPaidPrincipal) + Number(stmtAsOf30.totalPaidInterest)).toBe(3000);
      expect(stmtAsOf30.entries.some((e) => e.eventType === "PAYMENT_REVERSAL")).toBe(true);
    });

    it("guarantees snapshot RepeatableRead isolation: concurrent transaction cannot produce mixed before/after balances and records", async () => {
      // Pool capital starts at ₹50,000 from beforeEach
      let resolveSnapshotStarted!: () => void;
      const snapshotStarted = new Promise<void>((r) => {
        resolveSnapshotStarted = r;
      });

      let resolveConcurrentTxCommitted!: () => void;
      const concurrentTxCommitted = new Promise<void>((r) => {
        resolveConcurrentTxCommitted = r;
      });

      // 1. Launch snapshot transaction under RepeatableRead
      const snapshotTask = db.$transaction(
        async (tx) => {
          // First read: pool balance
          const balance = await poolBalance(tx);
          // Signal that snapshot has established its MVCC snapshot in PostgreSQL
          resolveSnapshotStarted();

          // Wait until concurrent financial transaction T2 commits to PostgreSQL
          await concurrentTxCommitted;

          // Subsequent reads inside same RepeatableRead transaction
          const loans = await tx.loan.findMany();
          const activity = await tx.poolTransaction.findMany();

          return {
            balance: balance.toFixed(0),
            loanCount: loans.length,
            activityCount: activity.length,
            loanIds: loans.map((l) => l.id),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );

      // Wait for snapshot transaction to perform its initial read
      await snapshotStarted;

      // 2. Concurrently disburse a new loan of ₹20,000 (committed while snapshot is paused)
      const gw = new PrismaDisbursementGateway(db);
      const loanReq = {
        borrowerProfileId: borrowerId,
        principal: "20000",
        rate: "12",
        interestMethod: "ANNUAL_ACTUAL_365" as const,
        startDate: "2026-01-02",
        dueDate: "2026-04-02",
        performedBy: "test-owner",
        idempotencyKey: randomUUID(),
      };
      const disbursed = await disburseLoan(loanReq, gw);
      expect(disbursed.loanId).toBeDefined();

      // Outside the transaction, verify that PostgreSQL committed the loan and pool was debited to ₹30,000
      const currentBalance = await poolBalance(db);
      expect(currentBalance.toFixed(0)).toBe("30000");

      // 3. Release snapshot transaction to complete its remaining queries
      resolveConcurrentTxCommitted();

      const snapshotResult = await snapshotTask;

      // 4. In RepeatableRead isolation, the snapshot MUST NOT observe the concurrent transaction
      // It must see the consistent state from when it began (balance ₹50,000, 0 loans, 1 initial capital activity)
      expect(snapshotResult.balance).toBe("50000");
      expect(snapshotResult.loanCount).toBe(0);
      expect(snapshotResult.activityCount).toBe(1);
      expect(snapshotResult.loanIds.includes(disbursed.loanId)).toBe(false);

      // 5. A subsequent fresh snapshot after completion observes the new state consistently
      const freshSnap = await snapshot(db);
      expect(freshSnap.available).toBe("30000");
      expect(freshSnap.loans.some((l) => l.id === disbursed.loanId)).toBe(true);
    });
  });
});



