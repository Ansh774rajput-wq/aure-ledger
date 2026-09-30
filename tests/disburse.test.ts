import { it, expect, vi } from "vitest";
import { disburseLoan } from "../src/application/disburse";
export const valid = {
  borrowerProfileId: "borrower-1",
  principal: "20000",
  rate: "12",
  interestMethod: "ANNUAL_ACTUAL_365",
  startDate: "2026-01-01",
  dueDate: "2026-04-01",
  performedBy: "owner",
  idempotencyKey: "568afad0-0d94-4f71-9ca1-0262113cf47b",
};
it("validates then calls the gateway exactly once", async () => {
  const gateway = { disburse: vi.fn().mockResolvedValue({ loanId: "a" }) };
  await expect(disburseLoan(valid, gateway)).resolves.toEqual({ loanId: "a" });
  expect(gateway.disburse).toHaveBeenCalledOnce();
  expect(gateway.disburse.mock.calls[0][0].originalInterest).toBe("592");
});
it.each([
  { principal: "0" },
  { principal: "-1" },
  { principal: "NaN" },
  { principal: "Infinity" },
  { principal: "0.5" },
  { principal: 20000 },
  { rate: "-1" },
  { rate: "NaN" },
  { rate: "Infinity" },
  { rate: Infinity },
  { startDate: "invalid" },
  { startDate: "2026-02-30" },
  { dueDate: "2026-01-01" },
  { dueDate: "2025-12-01" },
  { performedBy: "" },
  { performedBy: "   " },
  { borrowerProfileId: "" },
  { interestMethod: "UNKNOWN" },
  { idempotencyKey: "bad" },
])("rejects invalid input without any gateway call: %j", async (patch) => {
  const gateway = { disburse: vi.fn() };
  await expect(disburseLoan({ ...valid, ...patch }, gateway)).rejects.toThrow();
  expect(gateway.disburse).not.toHaveBeenCalled();
});
it("propagates a transaction/audit failure without an automatic retry", async () => {
  const gateway = {
    disburse: vi.fn().mockRejectedValue(new Error("audit failed")),
  };
  await expect(disburseLoan(valid, gateway)).rejects.toThrow("audit failed");
  expect(gateway.disburse).toHaveBeenCalledOnce();
});
