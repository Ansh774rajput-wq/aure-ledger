-- CreateTable
CREATE TABLE "PaymentReversal" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "reversalDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReversal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReversal_paymentId_key" ON "PaymentReversal"("paymentId");
CREATE UNIQUE INDEX "PaymentReversal_idempotencyKey_key" ON "PaymentReversal"("idempotencyKey");

-- AlterTable PoolTransaction
ALTER TABLE "PoolTransaction" ADD COLUMN "paymentReversalId" TEXT;
CREATE UNIQUE INDEX "PoolTransaction_paymentReversalId_key" ON "PoolTransaction"("paymentReversalId");

-- AddForeignKey
ALTER TABLE "PaymentReversal" ADD CONSTRAINT "PaymentReversal_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PoolTransaction" ADD CONSTRAINT "PoolTransaction_paymentReversalId_fkey" FOREIGN KEY ("paymentReversalId") REFERENCES "PaymentReversal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Validation Checks
ALTER TABLE "PaymentReversal" ADD CONSTRAINT reversal_values CHECK (
    length(trim(reason)) > 0 AND length(trim("performedBy")) > 0 AND "reversalDate" >= DATE '1900-01-01' AND "reversalDate" <= DATE '2200-12-31'
);

-- Update PoolTransaction check constraint
ALTER TABLE "PoolTransaction" DROP CONSTRAINT IF EXISTS pool_target;
ALTER TABLE "PoolTransaction" ADD CONSTRAINT pool_target CHECK (
  (type='LOAN_DISBURSEMENT_OUT' AND direction='OUT' AND "loanId" IS NOT NULL AND "borrowingId" IS NULL AND "equityEntryId" IS NULL AND "paymentId" IS NULL AND "paymentReversalId" IS NULL) OR
  (type='BORROWING_RECEIVED_IN' AND direction='IN' AND "borrowingId" IS NOT NULL AND "loanId" IS NULL AND "equityEntryId" IS NULL AND "paymentId" IS NULL AND "paymentReversalId" IS NULL) OR
  (type='BORROWER_REPAYMENT_IN' AND direction='IN' AND "loanId" IS NOT NULL AND "paymentId" IS NOT NULL AND "borrowingId" IS NULL AND "equityEntryId" IS NULL AND "paymentReversalId" IS NULL) OR
  (type='LENDER_REPAYMENT_OUT' AND direction='OUT' AND "borrowingId" IS NOT NULL AND "paymentId" IS NOT NULL AND "loanId" IS NULL AND "equityEntryId" IS NULL AND "paymentReversalId" IS NULL) OR
  (type='BORROWER_REPAYMENT_REVERSAL_OUT' AND direction='OUT' AND "loanId" IS NOT NULL AND "paymentReversalId" IS NOT NULL AND "borrowingId" IS NULL AND "equityEntryId" IS NULL AND "paymentId" IS NULL) OR
  (type='LENDER_REPAYMENT_REVERSAL_IN' AND direction='IN' AND "borrowingId" IS NOT NULL AND "paymentReversalId" IS NOT NULL AND "loanId" IS NULL AND "equityEntryId" IS NULL AND "paymentId" IS NULL) OR
  (type='OWN_CAPITAL_IN' AND direction='IN' AND "equityEntryId" IS NOT NULL AND "loanId" IS NULL AND "borrowingId" IS NULL AND "paymentId" IS NULL AND "paymentReversalId" IS NULL) OR
  (type='EQUITY_WITHDRAWAL_OUT' AND direction='OUT' AND "equityEntryId" IS NOT NULL AND "loanId" IS NULL AND "borrowingId" IS NULL AND "paymentId" IS NULL AND "paymentReversalId" IS NULL)
);

-- Immutability of PaymentReversal
CREATE TRIGGER protect_payment_reversal BEFORE UPDATE OR DELETE ON "PaymentReversal" FOR EACH ROW EXECUTE FUNCTION protect_financial_history();

-- Deferred trigger: reversal requires matching compensating movement
CREATE OR REPLACE FUNCTION verify_reversal_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "PoolTransaction" p
    WHERE p."paymentReversalId" = NEW.id
      AND p."transactionDate" = NEW."reversalDate"
  ) THEN
    RAISE EXCEPTION 'A payment reversal must have a matching pool movement with identical transaction date';
  END IF;
  RETURN NEW;
END; $$;

CREATE CONSTRAINT TRIGGER reversal_requires_movement AFTER INSERT ON "PaymentReversal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_reversal_movement();
