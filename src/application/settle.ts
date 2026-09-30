import { z } from "zod";
import {
  businessDate,
  date,
  days,
  money,
  payable,
  RuleError,
  term,
  D,
} from "../domain/finance";

export const agreementTypeSchema = z.enum(["LOAN", "BORROWING"]);
export type AgreementType = z.infer<typeof agreementTypeSchema>;

export const settlementDecisionSchema = z.enum([
  "SUGGESTED",
  "RETAIN_CURRENT",
  "MANUAL",
]);
export type SettlementDecision = z.infer<typeof settlementDecisionSchema>;

export const previewSettlementSchema = z
  .object({
    agreementId: z.string().trim().min(1).max(100),
    agreementType: agreementTypeSchema,
    settlementDate: z.string(),
    performedBy: z.string().optional(),
  })
  .strict();

export type ValidatedSettlementPreview = z.infer<
  typeof previewSettlementSchema
>;

export const executeSettlementSchema = z
  .object({
    agreementId: z.string().trim().min(1).max(100),
    agreementType: agreementTypeSchema,
    settlementDate: z.string(),
    decision: settlementDecisionSchema,
    manualFinalTotalInterest: z.string().optional(),
    reason: z.string().trim().min(1, "A reason is mandatory for settlement decisions.").max(500),
    quoteBalanceHash: z.string().trim().min(1, "Quote balance hash is required."),
    reference: z.string().trim().max(120).optional(),
    idempotencyKey: z.string().uuid(),
    performedBy: z.string().trim().min(1).max(100),
  })
  .strict();

export type ValidatedSettlementExecution = z.infer<
  typeof executeSettlementSchema
>;

export type SettlementPreviewResult = {
  agreementId: string;
  agreementType: AgreementType;
  counterpartyName: string;
  startDate: string;
  dueDate: string;
  settlementDate: string;
  originalPrincipal: string;
  originalInterest: string;
  elapsedDays: number;
  termDays: number;
  suggestedTotalInterest: string;
  currentAdjustedInterest: string;
  interestPaid: string;
  principalPaid: string;
  outstandingPrincipal: string;
  existingAdjustments: {
    id: string;
    amount: string;
    reason: string;
    createdAt: string;
    performedBy: string;
  }[];
  suggestedPayoff: string;
  currentPayoff: string;
  availablePoolCash: string;
  quoteBalanceHash: string;
};

export type SettlementExecutionResult = {
  settled: boolean;
  agreementId: string;
  agreementType: AgreementType;
  adjustmentId: string | null;
  paymentId: string | null;
  poolTransactionId: string | null;
  adjustmentDelta: string;
  finalTotalInterest: string;
  payoffAmount: string;
  decision: SettlementDecision;
  replayed: boolean;
  warnings: string[];
};

export interface SettlementGateway {
  preview(request: ValidatedSettlementPreview): Promise<SettlementPreviewResult>;
  settle(request: ValidatedSettlementExecution): Promise<SettlementExecutionResult>;
}

export function validateSettlementPreview(
  input: unknown,
): ValidatedSettlementPreview {
  const r = previewSettlementSchema.parse(input);
  date(r.settlementDate);
  if (r.settlementDate > businessDate()) {
    throw new RuleError("Settlement date cannot be in the future.");
  }
  return r;
}

export function validateSettlementExecution(
  input: unknown,
): ValidatedSettlementExecution {
  const r = executeSettlementSchema.parse(input);
  date(r.settlementDate);
  if (r.settlementDate > businessDate()) {
    throw new RuleError("Settlement date cannot be in the future.");
  }
  if (r.decision === "MANUAL") {
    if (!r.manualFinalTotalInterest || r.manualFinalTotalInterest.trim() === "") {
      throw new RuleError("Manual final total interest is required when selecting manual decision.");
    }
    const m = money(r.manualFinalTotalInterest, { positive: false, whole: true });
    if (m.isNegative()) {
      throw new RuleError("Final total interest cannot be negative.");
    }
  }
  return {
    ...r,
    reference: r.reference || undefined,
  };
}

export async function previewSettlement(
  input: unknown,
  gateway: SettlementGateway,
): Promise<SettlementPreviewResult> {
  return gateway.preview(validateSettlementPreview(input));
}

export async function executeSettlement(
  input: unknown,
  gateway: SettlementGateway,
): Promise<SettlementExecutionResult> {
  return gateway.settle(validateSettlementExecution(input));
}
