import { z } from "zod";
import { RuleError } from "../domain/finance";

export const reversePaymentSchema = z.object({
  paymentId: z.string().uuid("A valid payment ID is required."),
  reversalDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Reversal date must be in YYYY-MM-DD format.")
    .refine((d) => !isNaN(Date.parse(d)), "Invalid calendar date."),
  reason: z
    .string()
    .trim()
    .min(5, "An explanatory reason of at least 5 characters is required for reversal."),
  idempotencyKey: z.string().trim().min(1, "Idempotency key is required."),
  performedBy: z.string().optional(),
}).strict();

export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;
export type ValidatedPaymentReversal = ReversePaymentInput & { performedBy: string };

export interface PaymentReversalResult {
  reversalId: string;
  paymentId: string;
  agreementId: string;
  agreementType: "LOAN" | "BORROWING";
  amountReversed: string;
  reinstatedPrincipal: string;
  reinstatedInterest: string;
  reversalDate: string;
  replayed: boolean;
  warnings?: string[];
}

export interface PaymentReversalGateway {
  reversePayment(r: ValidatedPaymentReversal): Promise<PaymentReversalResult>;
}

export async function reversePayment(
  input: ReversePaymentInput,
  gateway: PaymentReversalGateway,
): Promise<PaymentReversalResult> {
  const parsed = reversePaymentSchema.safeParse(input);
  if (!parsed.success) {
    throw new RuleError(parsed.error.issues[0]?.message || "Invalid reversal input.");
  }
  const performedBy = input.performedBy || "owner";
  return gateway.reversePayment({ ...parsed.data, performedBy });
}
