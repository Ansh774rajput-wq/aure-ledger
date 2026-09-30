# Architecture

## Modular monolith

Next.js App Router serves a responsive React client and Node-runtime API routes. TypeScript is strict. Tailwind v4 is configured; the custom visual theme uses CSS tokens and native accessible controls, including HTML dialog for focus trapping. No component-library scaffolding was necessary for this slice.

The domain depends only on decimal.js. The application validates a request and calls one DisbursementGateway. Infrastructure implements that gateway with the real generated Prisma 7 client and the pg adapter. The API derives performedBy=`owner` from authenticated access; clients cannot choose the actor. UI depends on the pure interest calculator for a preview, while the server recomputes the official amount.

## Disbursement transaction

1. Parse all input, normalize money/rate/reference, validate dates/actor and calculate original interest before calling the financial gateway.
2. Begin one PostgreSQL transaction, acquire a fixed advisory transaction lock for this one global ledger.
3. Replay matching idempotency key + request hash, or reject key reuse with different data.
4. Validate current/chronological cash date and derive pool funds inside the lock.
5. Create Loan. Its borrower FK, rather than a separate existence pre-check, enforces borrower validity.
6. Create the matching OUT/LOAN_DISBURSEMENT_OUT PoolTransaction, with borrowingId=null and start-date cash date.
7. Create the audit event in the same transaction; any failure rolls everything back.
8. Commit and return IDs and non-blocking duplicate-reference warnings.

ReadCommitted is intentional: the advisory lock serializes all application cash writers, and subsequent reads see the latest committed state. There is no automatic financial retry. Snapshot reads use RepeatableRead to avoid mixed-time dashboard totals. Future cash writers must acquire the same lock. Ad hoc database writers that bypass this application protocol are unsupported; use least-privilege roles in deployment.

## Data model

Person → optional BorrowerProfile and LenderProfile. Loan → BorrowerProfile. Borrowing → LenderProfile. No loan-to-borrowing funding FK exists. PoolTransaction references a loan, borrowing, equity entry or payment according to its movement type. Payment and InterestAdjustment have XOR loan/borrowing references. PersonOperation provides idempotent person/role commands.

PostgreSQL NUMERIC stores money/rates. SQL CHECK constraints enforce sign, finiteness, whole-rupee posting, contract date order, allowed methods and targets. Restrictive FKs protect referenced records. Partial unique indexes prevent duplicate originating movements. A deferred constraint trigger requires a new Loan to have a matching disbursement before commit. History triggers reject UPDATE/DELETE on financial tables; future closure/reversal design must deliberately evolve them.

## Security and scope

Signed, expiring, HttpOnly/SameSite=strict owner cookie. Secure is enabled for an HTTPS APP_ORIGIN. Writes require an exact trusted Origin. Missing auth configuration fails closed. An in-process login throttle supports local single-process use, not public multi-instance hardening. No secrets are shipped. No bank transfers, OTP/PIN storage or OCR auto-posting.

## Hosting decision

A normal Next.js Node server preserves the requested real PostgreSQL/Prisma model. A hosted mock, SQLite/D1 substitute or static app claiming durable financial writes was not used. Source is delivered with Docker Compose and environment/setup instructions; no hosted database or public application was provisioned.
