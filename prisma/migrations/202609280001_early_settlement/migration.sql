-- CreateTable
CREATE TABLE "SettlementOperation" (
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "loanId" TEXT,
    "borrowingId" TEXT,
    "adjustmentId" TEXT,
    "paymentId" TEXT,
    "adjustmentDelta" DECIMAL(18,2) NOT NULL,
    "payoffAmount" DECIMAL(18,2) NOT NULL,
    "finalTotalInterest" DECIMAL(18,2) NOT NULL,
    "settlementDate" DATE NOT NULL,
    "performedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementOperation_pkey" PRIMARY KEY ("idempotencyKey")
);

-- AddForeignKey
ALTER TABLE "SettlementOperation" ADD CONSTRAINT "SettlementOperation_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementOperation" ADD CONSTRAINT "SettlementOperation_borrowingId_fkey" FOREIGN KEY ("borrowingId") REFERENCES "Borrowing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Protect settlement operations from UPDATE and DELETE
CREATE TRIGGER protect_settlement_operation BEFORE UPDATE OR DELETE ON "SettlementOperation" FOR EACH ROW EXECUTE FUNCTION protect_financial_history();
