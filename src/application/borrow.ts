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

export const borrowingSchema = z
  .object({
    lenderProfileId: z.string().trim().min(1).max(100),
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

export type ValidatedBorrowing = z.infer<typeof borrowingSchema> & {
  originalInterest: string;
};

export type BorrowingResult = {
  borrowingId: string;
  poolTransactionId: string;
  warnings: string[];
  replayed: boolean;
};

export interface BorrowingGateway {
  receive(request: ValidatedBorrowing): Promise<BorrowingResult>;
}

export function validateBorrowing(input: unknown): ValidatedBorrowing {
  const r = borrowingSchema.parse(input);
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

export async function receiveBorrowing(
  input: unknown,
  gateway: BorrowingGateway,
): Promise<BorrowingResult> {
  return gateway.receive(validateBorrowing(input));
}
