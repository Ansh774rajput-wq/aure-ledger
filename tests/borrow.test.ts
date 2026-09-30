import { it, expect, vi } from "vitest";
import { receiveBorrowing } from "../src/application/borrow";

export const validBorrowing = {
  lenderProfileId: "lender-1",
  principal: "25000",
  rate: "10",
  interestMethod: "ANNUAL_ACTUAL_365",
  startDate: "2026-01-01",
  dueDate: "2026-07-01",
  performedBy: "owner",
  idempotencyKey: "788afad0-0d94-4f71-9ca1-0262113cf47c",
};

it("validates then calls the gateway exactly once", async () => {
  const gateway = { receive: vi.fn().mockResolvedValue({ borrowingId: "b1" }) };
  await expect(receiveBorrowing(validBorrowing, gateway)).resolves.toEqual({
    borrowingId: "b1",
  });
  expect(gateway.receive).toHaveBeenCalledOnce();
  expect(gateway.receive.mock.calls[0][0].originalInterest).toBe("1240");
});

it.each([
  { principal: "0" },
  { principal: "-1" },
  { principal: "NaN" },
  { principal: "Infinity" },
  { principal: "0.5" },
  { principal: 25000 },
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
  { lenderProfileId: "" },
  { interestMethod: "UNKNOWN" },
  { idempotencyKey: "bad" },
])("rejects invalid input without any gateway call: %j", async (patch) => {
  const gateway = { receive: vi.fn() };
  await expect(
    receiveBorrowing({ ...validBorrowing, ...patch }, gateway),
  ).rejects.toThrow();
  expect(gateway.receive).not.toHaveBeenCalled();
});

it("propagates a transaction/audit failure without an automatic retry", async () => {
  const gateway = {
    receive: vi.fn().mockRejectedValue(new Error("audit failed")),
  };
  await expect(receiveBorrowing(validBorrowing, gateway)).rejects.toThrow(
    "audit failed",
  );
  expect(gateway.receive).toHaveBeenCalledOnce();
});

it("allows a zero-interest borrowing (rate = '0') and computes zero original interest", async () => {
  const gateway = { receive: vi.fn().mockResolvedValue({ borrowingId: "b0" }) };
  await expect(
    receiveBorrowing({ ...validBorrowing, rate: "0" }, gateway),
  ).resolves.toEqual({ borrowingId: "b0" });
  expect(gateway.receive).toHaveBeenCalledOnce();
  const request = gateway.receive.mock.calls[0][0];
  expect(request.rate).toBe("0");
  expect(request.originalInterest).toBe("0");
});

it("strictly rejects equal startDate and dueDate before any gateway I/O", async () => {
  const gateway = { receive: vi.fn() };
  await expect(
    receiveBorrowing(
      { ...validBorrowing, startDate: "2026-03-01", dueDate: "2026-03-01" },
      gateway,
    ),
  ).rejects.toThrow("Due date must be after start date.");
  expect(gateway.receive).not.toHaveBeenCalled();
});

it("strictly rejects dueDate preceding startDate before any gateway I/O", async () => {
  const gateway = { receive: vi.fn() };
  await expect(
    receiveBorrowing(
      { ...validBorrowing, startDate: "2026-03-15", dueDate: "2026-03-10" },
      gateway,
    ),
  ).rejects.toThrow("End date cannot precede start date.");
  expect(gateway.receive).not.toHaveBeenCalled();
});

it("computes and passes MONTHLY_ANCHORED interest method to the gateway", async () => {
  const gateway = {
    receive: vi.fn().mockResolvedValue({ borrowingId: "b-monthly" }),
  };
  await expect(
    receiveBorrowing(
      {
        ...validBorrowing,
        interestMethod: "MONTHLY_ANCHORED",
        principal: "100000",
        rate: "1.5",
        startDate: "2026-01-31",
        dueDate: "2026-04-30",
      },
      gateway,
    ),
  ).resolves.toEqual({ borrowingId: "b-monthly" });
  expect(gateway.receive).toHaveBeenCalledOnce();
  const request = gateway.receive.mock.calls[0][0];
  expect(request.interestMethod).toBe("MONTHLY_ANCHORED");
  // 3 anchored months: Jan 31 -> Feb 28 (1 mo) -> Mar 31 (1 mo) -> Apr 30 (1 mo) = 3 months
  // 100,000 * 1.5% * 3 = 4500
  expect(request.originalInterest).toBe("4500");
});

