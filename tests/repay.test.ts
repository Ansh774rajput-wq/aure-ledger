import { it, expect, vi } from "vitest";
import { receiveBorrowing } from "../src/application/borrow";
import { repayLoan } from "../src/application/repay";
import { businessDate } from "../src/domain/finance";

export const validRepayment = {
  loanId: "loan-1",
  amount: "5000",
  paymentDate: "2026-01-15",
  performedBy: "owner",
  idempotencyKey: "788afad0-0d94-4f71-9ca1-0262113cf47c",
};

it("validates then calls the gateway exactly once", async () => {
  const gateway = {
    repay: vi.fn().mockResolvedValue({
      paymentId: "p1",
      poolTransactionId: "pt1",
      allocation: { fees: "0", interest: "1000", principal: "4000" },
      remainingPrincipal: "16000",
      remainingInterest: "0",
      settled: false,
      warnings: [],
      replayed: false,
    }),
  };
  await expect(repayLoan(validRepayment, gateway)).resolves.toEqual({
    paymentId: "p1",
    poolTransactionId: "pt1",
    allocation: { fees: "0", interest: "1000", principal: "4000" },
    remainingPrincipal: "16000",
    remainingInterest: "0",
    settled: false,
    warnings: [],
    replayed: false,
  });
  expect(gateway.repay).toHaveBeenCalledOnce();
  const request = gateway.repay.mock.calls[0][0];
  expect(request.amount).toBe("5000");
  expect(request.loanId).toBe("loan-1");
});

it.each([
  { amount: "0" },
  { amount: "-100" },
  { amount: "NaN" },
  { amount: "Infinity" },
  { amount: "500.50" },
  { amount: 5000 },
  { paymentDate: "invalid" },
  { paymentDate: "2026-02-30" },
  { paymentDate: "2099-01-01" }, // Future date
  { loanId: "" },
  { loanId: "   " },
  { performedBy: "" },
  { performedBy: "   " },
  { idempotencyKey: "bad-uuid" },
])("rejects invalid input without any gateway call: %j", async (patch) => {
  const gateway = { repay: vi.fn() };
  await expect(
    repayLoan({ ...validRepayment, ...patch }, gateway),
  ).rejects.toThrow();
  expect(gateway.repay).not.toHaveBeenCalled();
});

it("rejects future dates in Asia/Kolkata", async () => {
  const gateway = { repay: vi.fn() };
  const tomorrow = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
  await expect(
    repayLoan({ ...validRepayment, paymentDate: tomorrow }, gateway),
  ).rejects.toThrow("Payment date cannot be in the future.");
  expect(gateway.repay).not.toHaveBeenCalled();
});

it("propagates a transaction/audit failure without an automatic retry", async () => {
  const gateway = {
    repay: vi.fn().mockRejectedValue(new Error("audit failed")),
  };
  await expect(repayLoan(validRepayment, gateway)).rejects.toThrow("audit failed");
  expect(gateway.repay).toHaveBeenCalledOnce();
});
