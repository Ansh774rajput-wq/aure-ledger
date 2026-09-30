import { z } from "zod";
import { businessDate, date, money, RuleError } from "../domain/finance";

export const repaymentSchema = z
  .object({
    loanId: z.string().trim().min(1).max(100),
    amount: z.string(),
    paymentDate: z.string(),
    performedBy: z.string().trim().min(1).max(100),
    reference: z.string().trim().max(120).optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export type ValidatedRepayment = z.infer<typeof repaymentSchema> & {
  amount: string;
  paymentDate: string;
  reference?: string;
};

export type RepaymentResult = {
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

export interface RepaymentGateway {
  repay(request: ValidatedRepayment): Promise<RepaymentResult>;
}

export function validateRepayment(input: unknown): ValidatedRepayment {
  const r = repaymentSchema.parse(input);
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

export async function repayLoan(
  input: unknown,
  gateway: RepaymentGateway,
): Promise<RepaymentResult> {
  return gateway.repay(validateRepayment(input));
}
