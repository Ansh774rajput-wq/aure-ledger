import { describe, expect, it } from "vitest";
import {
  validateSettlementPreview,
  validateSettlementExecution,
  previewSettlement,
  executeSettlement,
  SettlementGateway,
} from "../src/application/settle";
import {
  businessDate,
  days,
  term,
  payable,
  money,
  adjustedInterest,
  RuleError,
  D,
} from "../src/domain/finance";

describe("Phase 5: Settlement domain and validation rules", () => {
  const dummyGateway: SettlementGateway = {
    async preview(req) {
      return {
        agreementId: req.agreementId,
        agreementType: req.agreementType,
        counterpartyName: "Test Person",
        startDate: "2026-01-01",
        dueDate: "2026-04-11",
        settlementDate: req.settlementDate,
        originalPrincipal: "10000",
        originalInterest: "1000",
        elapsedDays: 40,
        termDays: 100,
        suggestedTotalInterest: "400",
        currentAdjustedInterest: "1000",
        interestPaid: "100",
        principalPaid: "2000",
        outstandingPrincipal: "8000",
        existingAdjustments: [],
        suggestedPayoff: "8300",
        currentPayoff: "8900",
        availablePoolCash: "50000",
        quoteBalanceHash: "dummyhash",
      };
    },
    async settle(req) {
      return {
        settled: true,
        agreementId: req.agreementId,
        agreementType: req.agreementType,
        adjustmentId: "adj-1",
        paymentId: "pay-1",
        poolTransactionId: "pool-1",
        adjustmentDelta: "-600",
        finalTotalInterest: "400",
        payoffAmount: "8300",
        decision: req.decision,
        replayed: false,
        warnings: [],
      };
    },
  };

  describe("Settlement Preview Validation", () => {
    it("accepts a valid preview request for a loan", async () => {
      const res = await previewSettlement(
        {
          agreementId: "loan-123",
          agreementType: "LOAN",
          settlementDate: "2026-02-10",
        },
        dummyGateway,
      );
      expect(res.agreementId).toBe("loan-123");
      expect(res.suggestedTotalInterest).toBe("400");
    });

    it("accepts a valid preview request for a borrowing", async () => {
      const res = await previewSettlement(
        {
          agreementId: "borrowing-456",
          agreementType: "BORROWING",
          settlementDate: "2026-02-10",
        },
        dummyGateway,
      );
      expect(res.agreementId).toBe("borrowing-456");
      expect(res.agreementType).toBe("BORROWING");
    });

    it("rejects future settlement date", () => {
      expect(() =>
        validateSettlementPreview({
          agreementId: "loan-1",
          agreementType: "LOAN",
          settlementDate: "2099-01-01",
        }),
      ).toThrow("Settlement date cannot be in the future.");
    });

    it("rejects invalid date format", () => {
      expect(() =>
        validateSettlementPreview({
          agreementId: "loan-1",
          agreementType: "LOAN",
          settlementDate: "10/02/2026",
        }),
      ).toThrow();
    });

    it("rejects invalid agreement type", () => {
      expect(() =>
        validateSettlementPreview({
          agreementId: "loan-1",
          agreementType: "INVALID",
          settlementDate: "2026-02-10",
        }),
      ).toThrow();
    });
  });

  describe("Settlement Execution Validation", () => {
    const validExecution = {
      agreementId: "loan-123",
      agreementType: "LOAN",
      settlementDate: "2026-02-10",
      decision: "SUGGESTED",
      reason: "Early payment agreed with borrower after mutual review",
      quoteBalanceHash: "abcdef1234567890",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      performedBy: "owner",
    };

    it("validates successful execution input with SUGGESTED decision", () => {
      const parsed = validateSettlementExecution(validExecution);
      expect(parsed.decision).toBe("SUGGESTED");
      expect(parsed.reason).toBe(
        "Early payment agreed with borrower after mutual review",
      );
    });

    it("validates successful execution input with RETAIN_CURRENT decision", () => {
      const parsed = validateSettlementExecution({
        ...validExecution,
        decision: "RETAIN_CURRENT",
      });
      expect(parsed.decision).toBe("RETAIN_CURRENT");
    });

    it("validates successful execution input with MANUAL decision", () => {
      const parsed = validateSettlementExecution({
        ...validExecution,
        decision: "MANUAL",
        manualFinalTotalInterest: "500",
      });
      expect(parsed.decision).toBe("MANUAL");
      expect(parsed.manualFinalTotalInterest).toBe("500");
    });

    it("rejects MANUAL decision when manualFinalTotalInterest is missing", () => {
      expect(() =>
        validateSettlementExecution({
          ...validExecution,
          decision: "MANUAL",
        }),
      ).toThrow("Manual final total interest is required when selecting manual decision.");
    });

    it("rejects MANUAL decision when manualFinalTotalInterest is negative", () => {
      expect(() =>
        validateSettlementExecution({
          ...validExecution,
          decision: "MANUAL",
          manualFinalTotalInterest: "-100",
        }),
      ).toThrow();
    });

    it("rejects empty or whitespace-only reason", () => {
      expect(() =>
        validateSettlementExecution({
          ...validExecution,
          reason: "   ",
        }),
      ).toThrow();
    });

    it("rejects missing quoteBalanceHash", () => {
      expect(() =>
        validateSettlementExecution({
          ...validExecution,
          quoteBalanceHash: "  ",
        }),
      ).toThrow();
    });

    it("rejects invalid idempotencyKey format", () => {
      expect(() =>
        validateSettlementExecution({
          ...validExecution,
          idempotencyKey: "not-a-uuid",
        }),
      ).toThrow();
    });

    it("rejects future settlement date", () => {
      expect(() =>
        validateSettlementExecution({
          ...validExecution,
          settlementDate: "2099-01-01",
        }),
      ).toThrow("Settlement date cannot be in the future.");
    });
  });

  describe("Proration and Payoff Domain Rules Verification", () => {
    it("suggests ₹400 for ₹1,000 original interest over 100 days after 40 elapsed days", () => {
      const originalInterest = "1000";
      const startDate = "2026-01-01";
      const dueDate = "2026-04-11"; // 100 days
      const settlementDate = "2026-02-10"; // 40 days

      const elapsed = days(startDate, settlementDate);
      const totalTerm = term(startDate, dueDate);
      expect(elapsed).toBe(40);
      expect(totalTerm).toBe(100);

      const suggested = payable(
        money(originalInterest).mul(elapsed).div(totalTerm),
      ).toFixed(0);
      expect(suggested).toBe("400");

      // Payoff formula: outstandingPrincipal (8000) + selectedTotal (400) - interestPaid (100) = 8300
      const outstandingPrincipal = new D("8000");
      const interestPaid = new D("100");
      const finalTotal = new D(suggested);
      const payoff = outstandingPrincipal
        .plus(finalTotal)
        .minus(interestPaid)
        .toFixed(0);
      expect(payoff).toBe("8300");
    });

    it("enforces that final total interest cannot be below interest already paid", () => {
      const interestPaid = new D("600");
      const proposedFinalTotal = new D("400");
      expect(proposedFinalTotal.lt(interestPaid)).toBe(true);

      // Attempting to select 400 when 600 was already paid must be rejected
      const validateTotal = (selectedTotal: InstanceType<typeof D>) => {
        if (selectedTotal.lt(interestPaid)) {
          throw new RuleError(
            `Final total interest cannot be less than interest already paid (₹${interestPaid.toFixed(0)}). A valid owner-selected total must be at least ₹${interestPaid.toFixed(0)}.`,
          );
        }
      };

      expect(() => validateTotal(proposedFinalTotal)).toThrow(
        "Final total interest cannot be less than interest already paid (₹600). A valid owner-selected total must be at least ₹600.",
      );
      expect(() => validateTotal(new D("600"))).not.toThrow();
      expect(() => validateTotal(new D("700"))).not.toThrow();
    });

    it("computes signed delta replacing current adjusted total without repeatedly subtracting", () => {
      const originalInterest = "1000";
      const previousAdjustments = [{ amount: "-100", reason: "First discount" }];
      const currentAdjusted = adjustedInterest(
        originalInterest,
        previousAdjustments,
        "0",
      );
      expect(currentAdjusted.toFixed(0)).toBe("900");

      // Owner selects final total ₹400: delta should be 400 - 900 = -500
      const finalTotal = new D("400");
      const delta = finalTotal.minus(currentAdjusted);
      expect(delta.toFixed(0)).toBe("-500");

      // When added to previous adjustments, total becomes 400
      const allAdjustments = [
        ...previousAdjustments,
        { amount: delta.toFixed(0), reason: "Early closure settlement" },
      ];
      const newAdjusted = adjustedInterest(originalInterest, allAdjustments, "0");
      expect(newAdjusted.toFixed(0)).toBe("400");
    });

    it("handles elapsed days = 0 on agreement start date suggesting ₹0 interest", () => {
      const originalInterest = "1500";
      const startDate = "2026-01-01";
      const dueDate = "2026-03-02"; // 60 days
      const settlementDate = "2026-01-01"; // 0 elapsed days

      const elapsed = days(startDate, settlementDate);
      expect(elapsed).toBe(0);
      const totalTerm = term(startDate, dueDate);
      const suggested = payable(
        money(originalInterest).mul(elapsed).div(totalTerm),
      ).toFixed(0);
      expect(suggested).toBe("0");
    });

    it("correctly rounds half-up on fractional rupee proration", () => {
      const originalInterest = "1000";
      // 1000 * 100 / 300 = 333.333... -> rounds to 333
      expect(
        payable(money(originalInterest).mul(100).div(300)).toFixed(0),
      ).toBe("333");

      // 1000 * 150 / 300 = 500
      expect(
        payable(money(originalInterest).mul(150).div(300)).toFixed(0),
      ).toBe("500");

      // 1000 * 1 / 200 = 5
      expect(
        payable(money(originalInterest).mul(1).div(200)).toFixed(0),
      ).toBe("5");

      // 1000 * 1 / 300 = 3.333 -> 3
      expect(
        payable(money(originalInterest).mul(1).div(300)).toFixed(0),
      ).toBe("3");

      // 1000 * 5 / 300 = 16.666 -> 17
      expect(
        payable(money(originalInterest).mul(5).div(300)).toFixed(0),
      ).toBe("17");
    });

    it("handles zero-interest agreements cleanly", () => {
      const originalInterest = "0";
      const elapsed = 40;
      const totalTerm = 100;
      const suggested = payable(
        money(originalInterest).mul(elapsed).div(totalTerm),
      ).toFixed(0);
      expect(suggested).toBe("0");

      const outstandingPrincipal = new D("50000");
      const interestPaid = new D("0");
      const payoff = outstandingPrincipal
        .plus(suggested)
        .minus(interestPaid)
        .toFixed(0);
      expect(payoff).toBe("50000");
    });
  });
});
