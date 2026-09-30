import Decimal from "decimal.js";
export const D = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
});
export class RuleError extends Error {}
export function decimal(value: unknown, label = "Amount"): Decimal {
  if (
    typeof value !== "string" ||
    !/^[-]?\d+(\.\d+)?$/.test(value) ||
    value.length > 40
  )
    throw new RuleError(`${label} must be a finite decimal string.`);
  const n = new D(value);
  if (!n.isFinite()) throw new RuleError(`${label} must be finite.`);
  return n;
}
export function money(
  value: unknown,
  { positive = false, whole = false } = {},
): Decimal {
  const n = decimal(value);
  if (
    n.isNegative() ||
    (positive && n.isZero()) ||
    n.decimalPlaces() > 2 ||
    n.gt("9999999999999999.99")
  )
    throw new RuleError(
      "Amount must be positive/non-negative, with at most two decimal places and within the supported limit.",
    );
  if (whole && !n.isInteger())
    throw new RuleError("Posted amounts use whole rupees.");
  return n;
}
export function rate(value: unknown): Decimal {
  const n = decimal(value, "Rate");
  if (n.lt(0) || n.gt("100000") || n.decimalPlaces() > 6)
    throw new RuleError(
      "Rate must be between 0 and 100000 with at most six decimals.",
    );
  return n;
}
export function payable(n: Decimal): Decimal {
  if (!n.isFinite() || n.lt(0)) throw new RuleError("Invalid payable.");
  return n.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}
export function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RuleError("Use a valid YYYY-MM-DD date.");
  const d = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== value ||
    value < "1900-01-01" ||
    value > "2200-12-31"
  )
    throw new RuleError(
      "Date must be a real calendar date between 1900 and 2200.",
    );
  return value;
}
export const businessDate = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
export const asDate = (s: string) => new Date(`${date(s)}T00:00:00.000Z`);
export function days(start: string, end: string): number {
  const n = (asDate(end).getTime() - asDate(start).getTime()) / 86400000;
  if (n < 0) throw new RuleError("End date cannot precede start date.");
  return n;
}
export function term(start: string, end: string): number {
  const n = days(start, end);
  if (n === 0) throw new RuleError("Due date must be after start date.");
  return n;
}
export function anchoredMonth(start: string, offset: number): string {
  const d = asDate(start);
  if (!Number.isInteger(offset) || offset < 0)
    throw new RuleError("Invalid month offset.");
  const first = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1),
  );
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d.getUTCDate(), last));
  return first.toISOString().slice(0, 10);
}
export const METHODS = ["ANNUAL_ACTUAL_365", "MONTHLY_ANCHORED"] as const;
export type InterestMethod = (typeof METHODS)[number];
export function interest(
  principal: string,
  percentage: string,
  method: InterestMethod,
  start: string,
  end: string,
): Decimal {
  const p = money(principal, { positive: true }),
    r = rate(percentage),
    n = term(start, end);
  if (method === "ANNUAL_ACTUAL_365") return p.mul(r).div(100).mul(n).div(365);
  if (method !== "MONTHLY_ANCHORED")
    throw new RuleError("Invalid interest method.");
  // Simple (non-compounding) monthly rate. Partial months use actual days of the anchored interval.
  let i = 0,
    units = new D(0),
    cursor = start;
  while (cursor < end) {
    const next = anchoredMonth(start, ++i);
    const stop = next < end ? next : end;
    units = units.plus(
      new D(days(cursor, stop)).div(
        (new Date(next + "T00:00:00Z").getTime() - asDate(cursor).getTime()) /
          86400000,
      ),
    );
    cursor = stop;
  }
  return p.mul(r).div(100).mul(units);
}
export function earlyClose(
  original: string,
  start: string,
  due: string,
  closed: string,
): { suggested: string; reduction: string } | null {
  const amount = money(original),
    total = term(start, due),
    elapsed = days(start, closed);
  if (elapsed >= total) return null;
  const suggested = payable(amount.mul(elapsed).div(total));
  return {
    suggested: suggested.toFixed(0),
    reduction: payable(amount).minus(suggested).toFixed(0),
  };
}
export function adjustedInterest(
  original: string,
  adjustments: { amount: string; reason: string }[],
  alreadyPaid = "0",
): Decimal {
  let total = money(original);
  for (const a of adjustments) {
    if (!a.reason.trim())
      throw new RuleError("An adjustment requires a reason.");
    const delta = decimal(a.amount);
    if (delta.decimalPlaces() > 2)
      throw new RuleError("Adjustment precision invalid.");
    total = total.plus(delta);
    if (total.lt(0)) throw new RuleError("Final interest cannot be negative.");
  }
  if (payable(total).lt(money(alreadyPaid)))
    throw new RuleError(
      "Adjusted interest cannot be below interest already paid.",
    );
  return total;
}
export function allocate(
  payment: string,
  fees: string,
  interestDue: string,
  principal: string,
) {
  let remaining = money(payment, { positive: true, whole: true });
  const balances = [fees, interestDue, principal].map((x) =>
    money(x, { whole: true }),
  );
  if (remaining.gt(balances.reduce((a, b) => a.plus(b), new D(0))))
    throw new RuleError("Payment exceeds outstanding amount.");
  const parts = balances.map((b) => {
    const part = D.min(b, remaining);
    remaining = remaining.minus(part);
    return part.toFixed(0);
  });
  return { fees: parts[0], interest: parts[1], principal: parts[2] };
}
