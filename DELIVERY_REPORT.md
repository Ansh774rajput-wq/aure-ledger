# Aure Ledger — first-execution delivery

Built from scratch on 27 September 2026 (Asia/Kolkata).

**Delivered:** a reproducible source project with a polished mobile UI, tested financial domain, real Prisma/PostgreSQL implementation and real database test harness. **Not yet delivered:** an empirically verified live financial ledger. PostgreSQL was unavailable, so the first end-to-end financial slice remains blocked at its database verification gate.

## 1. What was built

- Next.js 16.3.6, React 19.3.0, strict TypeScript, Tailwind v4, Prisma 7.10.0, pg adapter, Zod, decimal.js and Vitest. Dependencies are locked; `npm ci` succeeded.
- Decimal-safe money, rates and dates; Actual/365 fixed annual simple interest and anchored monthly simple interest; half-up official rounding; fees→interest→principal allocation; early-close proration and signed adjustments.
- Atomic Disburse Loan code with borrower FK enforcement, global pool movement, transactional audit, idempotency, duplicate-reference warning and cash-write lock.
- Own-capital additions and reusable person/borrower/lender roles as prerequisites.
- Signed owner sessions, same-origin writes, mobile navigation, dashboard, loan search/details, people and More.

## 2. Repository structure

| Directory | Responsibility |
|---|---|
| src/domain | Financial rules and calculations |
| src/application | Validated Disburse Loan use case |
| src/infrastructure | Real Prisma gateway, transactions, audits and authentication |
| src/app | Next.js UI entry and protected API routes |
| src/components | Responsive UI and isolated read-only sample data |
| prisma | Schema and initial SQL migration |
| tests | Domain/application/auth, real PostgreSQL harness and browser checks |
| scripts | Reproducible local environment setup |
| docs | Screenshots and captured verification output |

## 3. Exact files created/changed

This is a fresh repository; all delivered files are new. The complete exact list is in **FILE_MANIFEST.txt** in the source ZIP. Important entry points include src/domain/finance.ts, src/application/disburse.ts, src/infrastructure/ledger.ts, src/components/ledger-app.tsx, prisma/schema.prisma and prisma/migrations/202609260001_initial/migration.sql.

All seven requested source-of-truth documents are included: PROJECT_CONTEXT.md, REQUIREMENTS.md (the original brief), ARCHITECTURE.md, DOMAIN_RULES.md, DECISIONS.md, DEVELOPMENT_STATUS.md and HANDOFF.md. README.md contains exact setup/run commands; .env.example contains placeholders; no actual secrets are delivered.

## 4–5. Database/schema and migration status

- Eleven schema models cover people/roles, loans, borrowings, cash movements, payments, signed interest adjustments, equity, audits and idempotent person operations.
- No permanent loan↔borrowing funding relationship exists.
- PostgreSQL checks protect positive/finite amounts, rates, date order, targets and whole-rupee postings. Restrictive FKs, immutable-history triggers, originating-movement indexes and a deferred loan/movement consistency check are included.
- **Prisma validation and real client generation passed.** No fake client or typings were created.
- **Initial migration authored, not applied successfully.** `npm run db:migrate` exited 1 with `Error: Schema engine error:`. No running PostgreSQL instance was available. That command's exact output is in docs/verification/migration.txt.

## 6–8. Tests run and exact results

| Check | Final result |
|---|---|
| npm test | **73 passed, 0 failed**, 3 files |
| npm run typecheck | Passed |
| npx prisma validate | Passed |
| npm run db:generate | Passed, genuine Prisma 7.10 client |
| npm ci | Passed from package-lock.json |
| npm run build | Passed |
| Browser suite against production build | **12 passed, 0 failed**, desktop + Android-sized Chromium |
| npm run test:integration | **1 failed suite setup; 10 skipped; 0 test bodies executed; 0 passed** |
| npm run db:migrate | Failed / not applied |

Browser coverage includes sample balance presentation, read-only behavior, horizontal fit, loan search/detail/filtering, signature/scope, unauthorized API access, and explicitly mocked-API checks for interest preview/command payload and safe retry of an unconfirmed capital submission. **Those mocked form checks are not financial database integration tests.** Screenshots were inspected at desktop and mobile sizes.

Earlier browser attempts failed because the normal Chromium download was invalid, and subsequent development-server/test-locator issues required correction. The final harness builds and serves the production app, uses a real Chromium executable, and passes all 12 checks. Captured final output is in docs/verification/browser.txt.

## 9. Was real transaction rollback proven?

**No.** The PostgreSQL test harness is written but did not execute. Required tests A (success), B (nonexistent borrower FK), and C (second-write failure after Loan insertion) are all blocked.

Test C uses a test-only trigger to verify the loan exists inside the transaction and reject the pool insertion. A test-only sequence acts as an insert witness even after rollback. Both are outside the production migration. This is a design for proving rollback; it is not evidence that rollback has already passed.

## 10–11. Untested behavior and blockers

Real persistence, FK rejection, SQL constraint behavior, concurrent cash locking, idempotency under PostgreSQL, audit rollback and financial transaction rollback remain untested. Live authenticated financial writes are consequently not claimed usable with real money yet.

PostgreSQL binaries, Docker and database credentials were absent. Installation failed with `setgroups ... Operation not permitted` / `seteuid ... Invalid argument`. The integration setup explicitly reports `BLOCKED: TEST_DATABASE_URL is required. Real PostgreSQL tests did not execute.` No substitute in-memory database was used.

## 12. Screens/features currently usable

The app runs locally and supports a clearly labeled read-only sample dashboard, loan search/filtering, loan detail, people list and More. Actual capital/person/disbursement forms and APIs are implemented; form behavior was tested with explicitly mocked responses. They require PostgreSQL configuration and the real database gate before live use. Borrowing/repayment/early-close posting is not available in this release.

No public site or hosted database was deployed. Screenshots are in docs/screenshots. This is a source delivery, not a live Android app or PWA installation.

## 13. Creator signature

The exact text **adonis's creation** is placed in small muted typography at the bottom of the **More → Aure Ledger** section. It does not overlay content or appear prominently on each screen.

## 14. Exact next implementation slice

First unblock PostgreSQL: apply the migration to a real development database, run all ten integration tests against a separate `_test` database, fix any failures, then verify the live person → capital → disbursement flow.

After that gate passes, implement **Borrowing Received** as borrowing + pool IN + audit/idempotency in one real transaction, with no link to a borrower loan. Follow with borrower repayments and matching principal/interest reporting.
