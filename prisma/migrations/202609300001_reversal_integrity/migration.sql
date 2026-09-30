-- Enhance verify_reversal_movement to guarantee matching agreement, amount, date, and direction
CREATE OR REPLACE FUNCTION verify_reversal_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_pay RECORD;
BEGIN
  SELECT "loanId", "borrowingId", amount INTO v_pay FROM "Payment" WHERE id = NEW."paymentId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found for reversal', NEW."paymentId";
  END IF;

  IF v_pay."loanId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "PoolTransaction" p
      WHERE p."paymentReversalId" = NEW.id
        AND p."loanId" = v_pay."loanId"
        AND p."borrowingId" IS NULL
        AND p.type = 'BORROWER_REPAYMENT_REVERSAL_OUT'
        AND p.direction = 'OUT'
        AND p.amount = v_pay.amount
        AND p."transactionDate" = NEW."reversalDate"
    ) THEN
      RAISE EXCEPTION 'A borrower payment reversal must have a matching compensating OUT movement with identical loan, amount, and date';
    END IF;
  ELSIF v_pay."borrowingId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "PoolTransaction" p
      WHERE p."paymentReversalId" = NEW.id
        AND p."borrowingId" = v_pay."borrowingId"
        AND p."loanId" IS NULL
        AND p.type = 'LENDER_REPAYMENT_REVERSAL_IN'
        AND p.direction = 'IN'
        AND p.amount = v_pay.amount
        AND p."transactionDate" = NEW."reversalDate"
    ) THEN
      RAISE EXCEPTION 'A lender payment reversal must have a matching compensating IN movement with identical borrowing, amount, and date';
    END IF;
  ELSE
    RAISE EXCEPTION 'Payment % is neither a loan nor borrowing payment', NEW."paymentId";
  END IF;
  RETURN NEW;
END; $$;
