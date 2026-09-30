import { describe, it, expect } from "vitest";
import {
  D,
  money,
  payable,
  date,
  days,
  anchoredMonth,
  interest,
  earlyClose,
  allocate,
  adjustedInterest,
  rate,
  businessDate,
} from "../src/domain/finance";
describe("money", () => {
  it("adds decimal money exactly", () =>
    expect(money("0.1").plus(money("0.2")).toString()).toBe("0.3"));
  it.each(["-1", "NaN", "Infinity", "1e3", "", "0.001", "10000000000000000"])(
    "rejects invalid money %s",
    (v) => expect(() => money(v)).toThrow(),
  );
  it("rejects binary number inputs", () => expect(() => money(0.1)).toThrow());
  it("rejects zero positive amounts", () =>
    expect(() => money("0", { positive: true })).toThrow());
  it("rejects fractional posted amounts", () =>
    expect(() => money("1.50", { whole: true })).toThrow());
  it("rounds official values half up", () => {
    expect(payable(new D("600.5")).toString()).toBe("601");
    expect(payable(new D("600.49")).toString()).toBe("600");
  });
  it.each(["-1", "NaN", "Infinity", "100001", "0.0000001"])(
    "rejects invalid rate %s",
    (v) => expect(() => rate(v)).toThrow(),
  );
});
describe("dates and interest", () => {
  it.each([
    "2025-02-29",
    "2026-13-01",
    "2026-04-31",
    "invalid",
    "2026-1-1",
    "1899-01-01",
  ])("rejects invalid date %s", (v) => expect(() => date(v)).toThrow());
  it("supports leap day", () => expect(date("2024-02-29")).toBe("2024-02-29"));
  it("start inclusive, end exclusive", () =>
    expect(days("2026-01-01", "2026-01-02")).toBe(1));
  it("actual 365 uses a fixed denominator in leap years", () =>
    expect(
      interest(
        "36500",
        "10",
        "ANNUAL_ACTUAL_365",
        "2024-01-01",
        "2025-01-01",
      ).toString(),
    ).toBe("3660"));
  it("preserves precision before official rounding", () =>
    expect(
      interest(
        "10000",
        "12",
        "ANNUAL_ACTUAL_365",
        "2026-01-01",
        "2026-01-02",
      ).decimalPlaces(),
    ).toBeGreaterThan(2));
  it("clamps February and restores original anchor in March", () => {
    expect(anchoredMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(anchoredMonth("2026-01-31", 2)).toBe("2026-03-31");
  });
  it("handles leap-year month clamp", () =>
    expect(anchoredMonth("2024-01-31", 1)).toBe("2024-02-29"));
  it("calculates two anchored months", () =>
    expect(
      interest(
        "20000",
        "2",
        "MONTHLY_ANCHORED",
        "2026-01-31",
        "2026-03-31",
      ).toString(),
    ).toBe("800"));
  it("prorates a partial anchored month", () =>
    expect(
      interest(
        "20000",
        "2",
        "MONTHLY_ANCHORED",
        "2026-01-31",
        "2026-02-14",
      ).toString(),
    ).toBe("200"));
  it("rejects equal dates", () =>
    expect(() =>
      interest("100", "1", "ANNUAL_ACTUAL_365", "2026-01-01", "2026-01-01"),
    ).toThrow());
  it("supports zero interest", () =>
    expect(
      interest(
        "100",
        "0",
        "ANNUAL_ACTUAL_365",
        "2026-01-01",
        "2026-02-01",
      ).toString(),
    ).toBe("0"));
});
describe("allocation and early closure", () => {
  it("allocates fees then interest then principal", () =>
    expect(allocate("1200", "100", "300", "2000")).toEqual({
      fees: "100",
      interest: "300",
      principal: "800",
    }));
  it("stops within fees", () =>
    expect(allocate("50", "100", "300", "2000")).toEqual({
      fees: "50",
      interest: "0",
      principal: "0",
    }));
  it("rejects overpayment", () =>
    expect(() => allocate("101", "0", "0", "100")).toThrow());
  it("prorates original interest without replacing it", () =>
    expect(
      earlyClose("1000", "2026-01-01", "2026-04-11", "2026-03-02"),
    ).toEqual({ suggested: "600", reduction: "400" }));
  it("has no suggestion at the agreed term", () =>
    expect(
      earlyClose("1000", "2026-01-01", "2026-04-11", "2026-04-11"),
    ).toBeNull());
  it("has no suggestion after the term", () =>
    expect(
      earlyClose("1000", "2026-01-01", "2026-04-11", "2026-04-12"),
    ).toBeNull());
  it("rejects closure before start", () =>
    expect(() =>
      earlyClose("1000", "2026-01-01", "2026-04-11", "2025-12-31"),
    ).toThrow());
  it("keeps multiple signed adjustments", () =>
    expect(
      adjustedInterest("1000", [
        { amount: "-400", reason: "Early close" },
        { amount: "100", reason: "Correction" },
      ]).toString(),
    ).toBe("700"));
  it("requires override reasons", () =>
    expect(() =>
      adjustedInterest("1000", [{ amount: "-10", reason: " " }]),
    ).toThrow());
  it("rejects negative final interest", () =>
    expect(() =>
      adjustedInterest("1000", [{ amount: "-1001", reason: "Invalid" }]),
    ).toThrow());
  it("does not silently refund paid interest", () =>
    expect(() =>
      adjustedInterest(
        "1000",
        [{ amount: "-600", reason: "Reduction" }],
        "500",
      ),
    ).toThrow());
});

it("uses the Indian calendar date around UTC midnight", () =>
  expect(businessDate(new Date("2026-09-26T20:00:00Z"))).toBe("2026-09-27"));
it("handles the final supported calendar month for monthly interest", () =>
  expect(
    interest(
      "3100",
      "1",
      "MONTHLY_ANCHORED",
      "2200-12-30",
      "2200-12-31",
    ).toString(),
  ).toBe("1"));
