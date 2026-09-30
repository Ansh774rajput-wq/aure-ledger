-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "requestHash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- Deferred check: a new borrower Payment cannot commit without its matching cash repayment movement.
CREATE FUNCTION verify_payment_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."loanId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "PoolTransaction" p
      WHERE p."paymentId" = NEW.id
        AND p."loanId" = NEW."loanId"
        AND p."borrowingId" IS NULL
        AND p.type = 'BORROWER_REPAYMENT_IN'
        AND p.direction = 'IN'
        AND p.amount = NEW.amount
        AND p."transactionDate" = NEW."transactionDate"
    ) THEN
      RAISE EXCEPTION 'A borrower payment must have a matching repayment movement with identical amount and transaction date';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER payment_requires_movement AFTER INSERT ON "Payment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_payment_movement();

-- Narrowly scoped update trigger on Loan to allow settlement status update while protecting all loan terms
DROP TRIGGER protect_loan ON "Loan";

CREATE OR REPLACE FUNCTION protect_loan_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Financial history is immutable. Use a reviewed append-only correction workflow.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR
       NEW."borrowerProfileId" <> OLD."borrowerProfileId" OR
       NEW.principal <> OLD.principal OR
       NEW.rate <> OLD.rate OR
       NEW."interestMethod" <> OLD."interestMethod" OR
       NEW."originalInterest" <> OLD."originalInterest" OR
       NEW."startDate" <> OLD."startDate" OR
       NEW."dueDate" <> OLD."dueDate" OR
       NEW."createdAt" <> OLD."createdAt" OR
       NEW."idempotencyKey" <> OLD."idempotencyKey" OR
       NEW."requestHash" <> OLD."requestHash" THEN
      RAISE EXCEPTION 'Original loan terms and agreement history are immutable.';
    END IF;
    IF OLD.status = 'CLOSED' AND NEW.status <> 'CLOSED' THEN
      RAISE EXCEPTION 'Closed loans cannot be reopened.';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_loan_terms BEFORE UPDATE OR DELETE ON "Loan" FOR EACH ROW EXECUTE FUNCTION protect_loan_terms();
