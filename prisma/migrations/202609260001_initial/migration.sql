-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorrowerProfile" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "BorrowerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LenderProfile" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "LenderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "borrowerProfileId" TEXT NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,
    "interestMethod" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "originalInterest" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Borrowing" (
    "id" TEXT NOT NULL,
    "lenderProfileId" TEXT NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,
    "interestMethod" TEXT NOT NULL,
    "originalInterest" DECIMAL(18,2) NOT NULL,
    "startDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performedBy" TEXT NOT NULL,

    CONSTRAINT "Borrowing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquityEntry" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "type" TEXT NOT NULL,
    "transactionDate" DATE NOT NULL,
    "performedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquityEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT,
    "borrowingId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "fees" DECIMAL(18,2) NOT NULL,
    "interest" DECIMAL(18,2) NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "transactionDate" DATE NOT NULL,
    "reference" TEXT,
    "performedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterestAdjustment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT,
    "borrowingId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterestAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolTransaction" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "transactionDate" DATE NOT NULL,
    "loanId" TEXT,
    "borrowingId" TEXT,
    "equityEntryId" TEXT,
    "paymentId" TEXT,
    "reference" TEXT,
    "performedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BorrowerProfile_personId_key" ON "BorrowerProfile"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "LenderProfile_personId_key" ON "LenderProfile"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_idempotencyKey_key" ON "Loan"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "EquityEntry_idempotencyKey_key" ON "EquityEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PoolTransaction_transactionDate_createdAt_idx" ON "PoolTransaction"("transactionDate", "createdAt");

-- CreateIndex
CREATE INDEX "PoolTransaction_reference_idx" ON "PoolTransaction"("reference");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");

-- AddForeignKey
ALTER TABLE "BorrowerProfile" ADD CONSTRAINT "BorrowerProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LenderProfile" ADD CONSTRAINT "LenderProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_borrowerProfileId_fkey" FOREIGN KEY ("borrowerProfileId") REFERENCES "BorrowerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrowing" ADD CONSTRAINT "Borrowing_lenderProfileId_fkey" FOREIGN KEY ("lenderProfileId") REFERENCES "LenderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_borrowingId_fkey" FOREIGN KEY ("borrowingId") REFERENCES "Borrowing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterestAdjustment" ADD CONSTRAINT "InterestAdjustment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterestAdjustment" ADD CONSTRAINT "InterestAdjustment_borrowingId_fkey" FOREIGN KEY ("borrowingId") REFERENCES "Borrowing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolTransaction" ADD CONSTRAINT "PoolTransaction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolTransaction" ADD CONSTRAINT "PoolTransaction_borrowingId_fkey" FOREIGN KEY ("borrowingId") REFERENCES "Borrowing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolTransaction" ADD CONSTRAINT "PoolTransaction_equityEntryId_fkey" FOREIGN KEY ("equityEntryId") REFERENCES "EquityEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolTransaction" ADD CONSTRAINT "PoolTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Financial checks are intentional SQL additions; do not replace this migration with db push.
ALTER TABLE "Person" ADD CONSTRAINT person_name CHECK (length(trim(name)) > 0);
ALTER TABLE "Loan" ADD CONSTRAINT loan_values CHECK (
 principal > 0 AND principal::text NOT IN ('NaN','Infinity','-Infinity') AND principal=trunc(principal)
 AND rate >= 0 AND rate <= 100000 AND "originalInterest" >= 0 AND "originalInterest"::text NOT IN ('NaN','Infinity','-Infinity')
 AND "originalInterest"=trunc("originalInterest") AND "dueDate">"startDate"
 AND "startDate">=DATE '1900-01-01' AND "dueDate"<=DATE '2200-12-31'
 AND "interestMethod" IN ('ANNUAL_ACTUAL_365','MONTHLY_ANCHORED')
 AND status IN ('ACTIVE','CLOSED','CLOSED_EARLY','CANCELLED') AND length(trim("performedBy"))>0);
ALTER TABLE "Borrowing" ADD CONSTRAINT borrowing_values CHECK (
 principal > 0 AND principal::text NOT IN ('NaN','Infinity','-Infinity') AND principal=trunc(principal)
 AND rate >= 0 AND rate <= 100000 AND "originalInterest" >= 0 AND "originalInterest"::text NOT IN ('NaN','Infinity','-Infinity')
 AND "originalInterest"=trunc("originalInterest") AND "dueDate">"startDate"
 AND "startDate">=DATE '1900-01-01' AND "dueDate"<=DATE '2200-12-31'
 AND "interestMethod" IN ('ANNUAL_ACTUAL_365','MONTHLY_ANCHORED')
 AND status IN ('ACTIVE','CLOSED','CLOSED_EARLY','CANCELLED') AND length(trim("performedBy"))>0);
ALTER TABLE "EquityEntry" ADD CONSTRAINT equity_values CHECK (amount>0 AND amount::text NOT IN ('NaN','Infinity','-Infinity') AND amount=trunc(amount) AND type IN ('ADDITION','WITHDRAWAL') AND length(trim(reason))>0 AND length(trim("performedBy"))>0);
ALTER TABLE "Payment" ADD CONSTRAINT payment_values CHECK (
 num_nonnulls("loanId","borrowingId")=1 AND amount>0 AND amount::text NOT IN ('NaN','Infinity','-Infinity') AND amount=trunc(amount)
 AND fees>=0 AND interest>=0 AND principal>=0 AND amount=fees+interest+principal AND length(trim("performedBy"))>0);
ALTER TABLE "InterestAdjustment" ADD CONSTRAINT adjustment_values CHECK (num_nonnulls("loanId","borrowingId")=1 AND amount::text NOT IN ('NaN','Infinity','-Infinity') AND length(trim(reason))>0 AND length(trim("performedBy"))>0);
ALTER TABLE "AuditLog" ADD CONSTRAINT audit_values CHECK (length(trim("performedBy"))>0 AND length(trim(action))>0);
ALTER TABLE "PoolTransaction" ADD CONSTRAINT pool_values CHECK (amount>0 AND amount::text NOT IN ('NaN','Infinity','-Infinity') AND amount=trunc(amount) AND length(trim("performedBy"))>0 AND "transactionDate">=DATE '1900-01-01' AND "transactionDate"<=DATE '2200-12-31');
ALTER TABLE "PoolTransaction" ADD CONSTRAINT pool_target CHECK (
 (type='LOAN_DISBURSEMENT_OUT' AND direction='OUT' AND "loanId" IS NOT NULL AND "borrowingId" IS NULL AND "equityEntryId" IS NULL AND "paymentId" IS NULL) OR
 (type='BORROWING_RECEIVED_IN' AND direction='IN' AND "borrowingId" IS NOT NULL AND "loanId" IS NULL AND "equityEntryId" IS NULL AND "paymentId" IS NULL) OR
 (type='BORROWER_REPAYMENT_IN' AND direction='IN' AND "loanId" IS NOT NULL AND "paymentId" IS NOT NULL AND "borrowingId" IS NULL AND "equityEntryId" IS NULL) OR
 (type='LENDER_REPAYMENT_OUT' AND direction='OUT' AND "borrowingId" IS NOT NULL AND "paymentId" IS NOT NULL AND "loanId" IS NULL AND "equityEntryId" IS NULL) OR
 (type='OWN_CAPITAL_IN' AND direction='IN' AND "equityEntryId" IS NOT NULL AND "loanId" IS NULL AND "borrowingId" IS NULL AND "paymentId" IS NULL) OR
 (type='EQUITY_WITHDRAWAL_OUT' AND direction='OUT' AND "equityEntryId" IS NOT NULL AND "loanId" IS NULL AND "borrowingId" IS NULL AND "paymentId" IS NULL));
CREATE UNIQUE INDEX one_disbursement_per_loan ON "PoolTransaction" ("loanId") WHERE type='LOAN_DISBURSEMENT_OUT';
CREATE UNIQUE INDEX one_receipt_per_borrowing ON "PoolTransaction" ("borrowingId") WHERE type='BORROWING_RECEIVED_IN';
CREATE UNIQUE INDEX one_movement_per_equity ON "PoolTransaction" ("equityEntryId");
CREATE UNIQUE INDEX one_movement_per_payment ON "PoolTransaction" ("paymentId");

-- Database immutability complements the absence of destructive application endpoints.
CREATE FUNCTION protect_financial_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial history is immutable. Use a reviewed append-only correction workflow.'; END; $$;
CREATE TRIGGER protect_pool BEFORE UPDATE OR DELETE ON "PoolTransaction" FOR EACH ROW EXECUTE FUNCTION protect_financial_history();
CREATE TRIGGER protect_equity BEFORE UPDATE OR DELETE ON "EquityEntry" FOR EACH ROW EXECUTE FUNCTION protect_financial_history();
CREATE TRIGGER protect_payment BEFORE UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION protect_financial_history();
CREATE TRIGGER protect_adjustment BEFORE UPDATE OR DELETE ON "InterestAdjustment" FOR EACH ROW EXECUTE FUNCTION protect_financial_history();
CREATE TRIGGER protect_audit BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION protect_financial_history();
CREATE TRIGGER protect_loan BEFORE UPDATE OR DELETE ON "Loan" FOR EACH ROW EXECUTE FUNCTION protect_financial_history();
CREATE TRIGGER protect_borrowing BEFORE UPDATE OR DELETE ON "Borrowing" FOR EACH ROW EXECUTE FUNCTION protect_financial_history();

-- Deferred check: a new Loan cannot commit without its matching cash movement.
CREATE FUNCTION verify_disbursement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "PoolTransaction" p WHERE p."loanId"=NEW.id AND p.type='LOAN_DISBURSEMENT_OUT' AND p.amount=NEW.principal AND p."transactionDate"=NEW."startDate") THEN
  RAISE EXCEPTION 'A loan must have a matching disbursement movement';
 END IF; RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER loan_requires_movement AFTER INSERT ON "Loan" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_disbursement();

CREATE TABLE "PersonOperation" (
 "idempotencyKey" TEXT PRIMARY KEY,
 "requestHash" TEXT NOT NULL,
 "personId" TEXT NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER protect_person_operation BEFORE UPDATE OR DELETE ON "PersonOperation" FOR EACH ROW EXECUTE FUNCTION protect_financial_history();
