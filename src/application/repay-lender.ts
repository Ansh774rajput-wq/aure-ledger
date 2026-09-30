import { z } from "zod";
import { businessDate, date, money, RuleError } from "../domain/finance";

export const lenderRepaymentSchema = z
  .object({
    borrowingId: z.string().trim().min(1).max(100),
    amount: z.string(),
    paymentDate: z.string(),
    performedBy: z.string().trim().min(1).max(100),
    reference: z.string().trim().max(120).optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export type ValidatedLenderRepayment = z.infer<typeof lenderRepaymentSchema> & {
  amount: string;
  paymentDate: string;
  reference?: string;
};

export type LenderRepaymentResult = {
  paymentId: string;
  poolTransactionId: string;
  allocation: {
    fees: string;
    interest: string;
    principal: string;
  };
  remainingPrincipal: string;
  remainingInterest: string;
  settled: boolean;
  warnings: string[];
  replayed: boolean;
};

export interface LenderRepaymentGateway {
  repayLender(request: ValidatedLenderRepayment): Promise<LenderRepaymentResult>;
}

export function validateLenderRepayment(input: unknown): ValidatedLenderRepayment {
  const r = lenderRepaymentSchema.parse(input);
  const p = money(r.amount, { positive: true, whole: true });
  date(r.paymentDate);
  if (r.paymentDate > businessDate()) {
    throw new RuleError("Payment date cannot be in the future.");
  }
  return {
    ...r,
    amount: p.toFixed(0),
    paymentDate: r.paymentDate,
    reference: r.reference || undefined,
  };
}

export async function repayLender(
  input: unknown,
  gateway: LenderRepaymentGateway,
): Promise<LenderRepaymentResult> {
  return gateway.repayLender(validateLenderRepayment(input));
}
