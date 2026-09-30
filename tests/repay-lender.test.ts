import { it, expect, vi } from "vitest";
import { repayLender } from "../src/application/repay-lender";
import { businessDate } from "../src/domain/finance";

export const validLenderRepayment = {
  borrowingId: "borrowing-1",
  amount: "5000",
  paymentDate: "2026-01-15",
  performedBy: "owner",
  idempotencyKey: "788afad0-0d94-4f71-9ca1-0262113cf47c",
};

it("validates then calls the lender gateway exactly once", async () => {
  const gateway = {
    repayLender: vi.fn().mockResolvedValue({
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
  await expect(repayLender(validLenderRepayment, gateway)).resolves.toEqual({
    paymentId: "p1",
    poolTransactionId: "pt1",
    allocation: { fees: "0", interest: "1000", principal: "4000" },
    remainingPrincipal: "16000",
    remainingInterest: "0",
    settled: false,
    warnings: [],
    replayed: false,
  });
  expect(gateway.repayLender).toHaveBeenCalledOnce();
  const request = gateway.repayLender.mock.calls[0][0];
  expect(request.amount).toBe("5000");
  expect(request.borrowingId).toBe("borrowing-1");
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
  { borrowingId: "" },
  { borrowingId: "   " },
  { performedBy: "" },
  { performedBy: "   " },
  { idempotencyKey: "bad-uuid" },
])("rejects invalid input without any gateway call: %j", async (patch) => {
  const gateway = { repayLender: vi.fn() };
  await expect(
    repayLender({ ...validLenderRepayment, ...patch }, gateway),
  ).rejects.toThrow();
  expect(gateway.repayLender).not.toHaveBeenCalled();
});

it("rejects future dates in Asia/Kolkata", async () => {
  const gateway = { repayLender: vi.fn() };
  const tomorrow = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
  await expect(
    repayLender({ ...validLenderRepayment, paymentDate: tomorrow }, gateway),
  ).rejects.toThrow("Payment date cannot be in the future.");
  expect(gateway.repayLender).not.toHaveBeenCalled();
});

it("propagates a transaction/audit failure without an automatic retry", async () => {
  const gateway = {
    repayLender: vi.fn().mockRejectedValue(new Error("audit failed")),
  };
  await expect(repayLender(validLenderRepayment, gateway)).rejects.toThrow("audit failed");
  expect(gateway.repayLender).toHaveBeenCalledOnce();
});
