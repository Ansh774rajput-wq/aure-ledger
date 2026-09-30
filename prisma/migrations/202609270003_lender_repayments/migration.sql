-- 1. Extend payment movement verification to handle both borrower repayments (IN) and lender repayments (OUT).
CREATE OR REPLACE FUNCTION verify_payment_movement() RETURNS trigger LANGUAGE plpgsql AS $$
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
  ELSIF NEW."borrowingId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "PoolTransaction" p
      WHERE p."paymentId" = NEW.id
        AND p."borrowingId" = NEW."borrowingId"
        AND p."loanId" IS NULL
        AND p.type = 'LENDER_REPAYMENT_OUT'
        AND p.direction = 'OUT'
        AND p.amount = NEW.amount
        AND p."transactionDate" = NEW."transactionDate"
    ) THEN
      RAISE EXCEPTION 'A lender payment must have a matching lender repayment movement with identical amount and transaction date';
    END IF;
  ELSE
    RAISE EXCEPTION 'Payment must be linked to either a loan or a borrowing';
  END IF;
  RETURN NEW;
END; $$;

-- 2. Narrowly scoped update trigger on Borrowing to allow settlement status update while protecting all borrowing terms
DROP TRIGGER IF EXISTS protect_borrowing ON "Borrowing";

CREATE OR REPLACE FUNCTION protect_borrowing_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Financial history is immutable. Use a reviewed append-only correction workflow.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR
       NEW."lenderProfileId" <> OLD."lenderProfileId" OR
       NEW.principal <> OLD.principal OR
       NEW.rate <> OLD.rate OR
       NEW."interestMethod" <> OLD."interestMethod" OR
       NEW."originalInterest" <> OLD."originalInterest" OR
       NEW."startDate" <> OLD."startDate" OR
       NEW."dueDate" <> OLD."dueDate" OR
       NEW."createdAt" <> OLD."createdAt" OR
       NEW."performedBy" <> OLD."performedBy" OR
       NEW."idempotencyKey" <> OLD."idempotencyKey" OR
       NEW."requestHash" <> OLD."requestHash" THEN
      RAISE EXCEPTION 'Original borrowing terms and agreement history are immutable.';
    END IF;
    IF OLD.status = 'CLOSED' AND NEW.status <> 'CLOSED' THEN
      RAISE EXCEPTION 'Closed borrowings cannot be reopened.';
    END IF;
    IF NEW.status NOT IN ('ACTIVE', 'CLOSED') THEN
      RAISE EXCEPTION 'Invalid borrowing status.';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_borrowing_terms ON "Borrowing";
CREATE TRIGGER protect_borrowing_terms BEFORE UPDATE OR DELETE ON "Borrowing" FOR EACH ROW EXECUTE FUNCTION protect_borrowing_terms();
