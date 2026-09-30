# Domain rules

- One GLOBAL FUNGIBLE capital pool; no borrower/lender funding attachment.
- Available = sum(IN) − sum(OUT). Cash balance is never a manually edited field.
- Borrowed principal is a liability; own capital is equity; principal returned is not income. Interest received must stay separate.
- All money/rates enter as finite decimal strings. Never JavaScript-number money arithmetic. Money has max two decimal places and NUMERIC(18,2) bounds. Posted amounts/principal are whole rupees in this slice. Rate range is 0–100000 with at most six decimal places.
- Decimal.js uses 80 significant digits, with no intermediate currency quantization. This is finite arbitrary-precision decimal arithmetic, not symbolic infinite precision. Official interest/statement values use ₹1 ROUND HALF UP.
- Date-only YYYY-MM-DD; valid Gregorian dates in 1900–2200. Asia/Kolkata defines today. Due date is strictly after start. Start inclusive, end exclusive; no DST-dependent day arithmetic.
- ANNUAL_ACTUAL_365 is simple principal × annual rate/100 × elapsed actual days/365; denominator is fixed even in leap years.
- MONTHLY_ANCHORED is simple principal × monthly rate/100 × anchored-month units. Each full anchored interval counts as one month. Partial intervals use actual elapsed days divided by the actual days in that interval. Month boundaries always clamp from the original start day, never drift from February's clamp. Not equivalent to an annual rate divided by 12.
- Original agreed interest is calculated through the original due date and remains immutable. No automatic overdue interest, penalties or fees.
- Default early-close suggestion = original agreed interest × elapsed/original term, rounded half up. No reduction suggestion at/after original due date. Signed adjustments preserve history; reasons are required; final interest cannot be negative or below already-paid interest without an explicit refund workflow. Domain helpers exist; no posting endpoint exists yet.
- Payment allocation: fees, then interest, then principal; reject overpayment. Domain allocation helper is tested; posting is not implemented.
- First-slice disbursement cannot exceed derived available cash. Chronological postings only: date cannot be before latest cash date or after today. Backdated reconciliation requires a later design; do not remove this guard casually.
- A duplicate UTR/reference produces a warning, not a unique-constraint rejection. Idempotency keys are a separate technical duplicate-submission protection.
- Referenced records use restrictive FKs; no financial UPDATE/DELETE endpoint. SQL triggers make current financial records immutable even under ordinary direct UPDATE/DELETE. Migration/admin/TRUNCATE capabilities must not be given to the production runtime role.
- A person may be both borrower and lender. UI supports selecting an existing person when adding roles. Names/phones are not globally unique identity proofs.
