import { z } from "zod";
import {
  date,
  interest,
  METHODS,
  money,
  payable,
  rate,
  term,
} from "../domain/finance";
export const disbursementSchema = z
  .object({
    borrowerProfileId: z.string().trim().min(1).max(100),
    principal: z.string(),
    rate: z.string(),
    interestMethod: z.enum(METHODS),
    startDate: z.string(),
    dueDate: z.string(),
    performedBy: z.string().trim().min(1).max(100),
    reference: z.string().trim().max(120).optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type ValidatedLoan = z.infer<typeof disbursementSchema> & {
  originalInterest: string;
};
export type DisbursementResult = {
  loanId: string;
  poolTransactionId: string;
  warnings: string[];
  replayed: boolean;
};
export interface DisbursementGateway {
  disburse(request: ValidatedLoan): Promise<DisbursementResult>;
}
export function validateLoan(input: unknown): ValidatedLoan {
  const r = disbursementSchema.parse(input);
  const p = money(r.principal, { positive: true, whole: true });
  const pct = rate(r.rate);
  date(r.startDate);
  date(r.dueDate);
  term(r.startDate, r.dueDate);
  const originalInterest = payable(
    interest(
      p.toFixed(0),
      pct.toString(),
      r.interestMethod,
      r.startDate,
      r.dueDate,
    ),
  );
  money(originalInterest.toString());
  return {
    ...r,
    principal: p.toFixed(0),
    rate: pct.toString(),
    reference: r.reference || undefined,
    originalInterest: originalInterest.toFixed(0),
  };
}
export async function disburseLoan(
  input: unknown,
  gateway: DisbursementGateway,
): Promise<DisbursementResult> {
  return gateway.disburse(validateLoan(input));
}
