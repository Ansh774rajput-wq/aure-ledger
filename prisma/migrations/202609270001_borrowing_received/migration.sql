-- AlterTable
ALTER TABLE "Borrowing" ADD COLUMN "idempotencyKey" TEXT NOT NULL;
ALTER TABLE "Borrowing" ADD COLUMN "requestHash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Borrowing_idempotencyKey_key" ON "Borrowing"("idempotencyKey");

-- Deferred check: a new Borrowing cannot commit without its matching cash receipt movement.
CREATE FUNCTION verify_borrowing_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "PoolTransaction" p WHERE p."borrowingId"=NEW.id AND p.type='BORROWING_RECEIVED_IN' AND p.amount=NEW.principal AND p."transactionDate"=NEW."startDate") THEN
  RAISE EXCEPTION 'A borrowing must have a matching receipt movement';
 END IF; RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER borrowing_requires_movement AFTER INSERT ON "Borrowing" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_borrowing_receipt();
