# Development status

Execution date: 2026-09-30 (Asia/Kolkata). This file distinguishes tested behavior from code that merely exists.

| Area | Status | Evidence / limit |
|---|---|---|
| Project/dependency setup | COMPLETE | npm ci succeeded from the committed lockfile; Node 24.12.0 LTS |
| Docker & PostgreSQL 17 | COMPLETE | Docker Compose up with postgres:17 healthy on 127.0.0.1:5432; `lending` & `lending_test` created |
| Prisma schema syntax/client generation | COMPLETE | Prisma 7.10 validation and real client generation passed |
| SQL migrations | COMPLETE | Migrations `202609260001_initial`, `202609270001_borrowing_received`, `202609270002_borrower_repayments`, `202609270003_lender_repayments`, `202609280001_early_settlement`, `202609290001_reversals_and_reports`, and `202609300001_reversal_integrity` applied successfully via `prisma migrate deploy` |
| Money/date/interest/allocation/early-close helpers | COMPLETE | 46 domain tests passed |
| Disbursement input validation/gateway boundary | COMPLETE | 21 application tests passed; no-I/O-on-invalid assertions |
| Borrowing input validation/gateway boundary | COMPLETE | 25 application tests passed; no-I/O-on-invalid assertions; zero rate and strict date ordering verified |
| Borrower repayment input validation/gateway boundary (Phase 3) | COMPLETE | 17 application tests passed; whole-rupee positive money, chronology, and future date checks verified |
| Lender repayment input validation/gateway boundary (Phase 4) | COMPLETE | 17 application tests passed; whole-rupee positive money, chronology, and future date checks verified |
| Early closure & settlement input validation/gateway boundary (Phase 5) | COMPLETE | 20 application tests passed; start-inclusive/due-date exclusive proration, minimum-paid interest check, signed delta calculation, zero-payoff, and date boundary checks verified |
| Safe payment reversal input validation & gateway boundary (Phase 6) | COMPLETE | 9 application tests passed; active loan/borrowing check, latest payment check, pool solvency, reason requirement, and date validation verified |
| Pure domain reconciliation engine (Phase 6) | COMPLETE | 13 domain tests passed; 11 financial equations checked, discrepancy detection & recovery verified, formula injection sanitization verified |
| Owner authentication & security hardening (Phase 7) | COMPLETE | Strict HTTPS origin enforcement in production (`sameOrigin`); per-IP sliding window sign-in rate limiting (max 5 failed attempts per 15 min); `PRIVATE_HEADERS` (`no-store, no-cache, must-revalidate, private, max-age=0`) applied to all private endpoints; secure cookies |
| PWA manifest & offline architecture (Phase 7) | COMPLETE | `manifest.json` configured for standalone installation with `#111315` theme; `public/offline.html` displays branded safeguard and preserves `"adonis's creation"`; `public/sw.js` passes `/api/*` through network-only with zero offline mutation queuing |
| Idempotency & network uncertainty retries (Phase 7) | COMPLETE | `ledger-app.tsx` preserves original idempotency key and payload across network interruptions for commands and reversals; shows retry banner |
| Backup & restore verification (Phase 7) | COMPLETE | Secret-safe `./scripts/backup-db.sh` and serverless `.github/workflows/backup.yml` (90-day retention on GitHub, 0 disk required); `./scripts/restore-and-verify-backup.ts` restored archive into disposable DB `lending_backup_verify_test`, verified 8 migrations, 11 table counts, pool balances, full reconciliation, representative live capital addition, and clean teardown; source DB untouched |
| Minimal health check & deployment prep (Phase 7) | COMPLETE | `GET /api/health` returns HTTP 200 `{ "status": "healthy" }` without leaking private data; `DEPLOYMENT.md` and `RELEASE_CHECKLIST.md` configured for strictly ₹0 Vercel Hobby + Neon Free Tier; Path A fresh production setup & Path B reviewed data migration scripts created |
| Mobile interface & responsive UI | COMPLETE | Desktop and mobile browser checks (54 passed); Playwright against production build; Indian currency formatting (₹1,55,00,000), WCAG AA contrast, and charcoal-and-gold design verified |
| Disbursement/own-capital/person database adapters | COMPLETE | 10 real PostgreSQL integration tests passed; live authenticated flow verified |
| Borrowing database adapter (Phase 2) | COMPLETE | 13 real PostgreSQL integration tests passed; zero-rate, MONTHLY_ANCHORED, date ordering verified |
| Borrower repayment database adapter (Phase 3) | COMPLETE | 15 real PostgreSQL integration tests passed; allocation fees->interest->principal, settlement status update, rollback, idempotency verified |
| Lender repayment database adapter (Phase 4) | COMPLETE | 17 real PostgreSQL integration tests passed; allocation fees->interest->principal, pool cash check, settlement status update, rollback, idempotency verified |
| Early closure & settlement database adapter (Phase 5) | COMPLETE | 20 real PostgreSQL integration tests passed; signed delta replacement, default proration, retain current, manual override, stale preview rejection, insufficient pool cash rollback; sequence witnesses prove executed insertions prior to error and row count queries prove complete transactional rollback |
| Safe corrections, statements & reconciliation database adapter (Phase 6) | COMPLETE | 16 real PostgreSQL integration tests passed; borrower reversal, lender reversal, insufficient cash rejection, closed loan rejection, older payment reversal rejection, rollback on pool failure, clean reconciliation, corrupted ledger detection & recovery, statements generation, concurrent duplicate reversals, idempotency precedence over status checks, DB trigger agreement/amount/date/direction matching, preview invalidation, same-date deterministic ordering, and filtered/as-of statements verified |
| Real FK/transaction rollback/audit rollback | COMPLETE | Real PostgreSQL integration tests with sequence witnesses executed and passed for disburse, borrow, repay, repay-lender, early settlement, and reversal. Non-transactional sequence witnesses confirm insertion attempt before abort; zero row counts confirm atomic rollback |
| Real concurrency/idempotency checks | COMPLETE | Advisory locking (`67421901`) and idempotency verified under real PostgreSQL across all workflows |
| Live financial UI persistence & Browser submission | COMPLETE | Playwright tests submitted real borrower repayment, real lender repayment, real early settlement, and real safe payment reversal against disposable test DB, verifying persisted rows and zero hydration errors |
| Physical device testing | PENDING DEPLOYMENT | Browser emulation on desktop Chromium and Pixel 7 mobile verified (54/54 passed). Physical device checklist prepared for owner's Android phone (Chrome PWA) and developer's iPhone (Safari) upon HTTPS deployment |
| Production deployment | READY FOR DEPLOYMENT | Full deployment guide, strictly ₹0 hosting architecture (Vercel Hobby + Neon Free Tier), environment variable checklist, and migration procedures prepared in `DEPLOYMENT.md` |

## Test results

- Unit/domain/application/auth/security/PWA: **188 passed, 0 failed, 0 skipped** across 11 test files (`tests/finance.test.ts`, `tests/disburse.test.ts`, `tests/borrow.test.ts`, `tests/repay.test.ts`, `tests/repay-lender.test.ts`, `tests/settle.test.ts`, `tests/auth.test.ts`, `tests/reconcile.test.ts`, `tests/reverse.test.ts`, `tests/phase7.security-pwa.test.ts`, `tests/rate-limiter.test.ts`).
- TypeScript: passed (`tsc --noEmit`).
- Production Next.js build: passed (`npm run build` with Next.js 16.3.6 Turbopack).
- Real PostgreSQL integration suite: **92 passed, 0 failed, 0 skipped** (`tests/ledger.integration.test.ts`) against real disposable `lending_test` database:
  - 10 Disbursement tests (Phase 1)
  - 13 Borrowing tests (Phase 2)
  - 15 Borrower repayment tests (Phase 3)
  - 17 Lender repayment tests (Phase 4)
  - 20 Early settlement tests (Phase 5)
  - 16 Safe corrections, statements, and reconciliation tests (Phase 6)
- Browser suite: **44 passed, 0 failed, 0 skipped** across desktop and mobile viewports (`tests/browser/ledger.spec.ts`, `tests/browser/repayment-submission.spec.ts`, `tests/browser/settlement-submission.spec.ts`, `tests/browser/phase6.spec.ts`, & `tests/browser/screenshots.spec.ts`):
  - 16 baseline ledger navigation and mocked command checks (8×2).
  - 6 real repayment submissions with database assertions (3×2).
  - 6 real early settlement submissions with database assertions (3×2).
  - 8 Phase 6 browser checks (activity ledger, reconciliation screen, statements modal, and safe payment reversal) (4×2).
  - 8 UI redesign screenshots and visual checks (4×2).
  - Zero browser console errors or hydration errors across all desktop and mobile runs.
- Backup & Restore Verification: passed (`scripts/restore-and-verify-backup.ts`):
  - Created compressed archive: `./backups/aure_ledger_20260929_223015Z.dump` (62,820 bytes).
  - Restored to disposable DB `lending_backup_verify_test`.
  - Verified 7 migrations and all 11 table record counts (15 Persons, 10 Loans, 3 Borrowings, 8 Payments, 32 Pool Transactions, 47 Audit Logs).
  - Verified pool balances: Direction IN ₹863,000.00, Direction OUT ₹235,000.00.
  - Verified mathematical reconciliation: 100% HEALTHY (0 discrepancies).
  - Verified representative live transaction: injected ₹50,000 capital; post-transaction reconciliation remained 100% HEALTHY.
  - Confirmed original `lending` database was untouched.

## Environment status

- Node: v24.12.0
- Next.js: 16.3.6
- Turbopack: active for development and production build
- Database: PostgreSQL 17 on localhost:5432 (Docker container `aure-ledger-db-1`, `lending` and `lending_test` healthy)
- Migrations: 7 migrations applied (`202609260001_initial`, `202609270001_borrowing_received`, `202609270002_borrower_repayments`, `202609270003_lender_repayments`, `202609280001_early_settlement`, `202609290001_reversals_and_reports`, `202609300001_reversal_integrity`)
- Development Database Verification: 15 Persons, 10 Loans, 3 Borrowings, 8 Payments, 0 Reversals, 32 Pool Transactions, 0 Adjustments, 47 Audit Logs, 15 Person Operations, 0 Settlement Operations, 11 Equity Entries; 0 verification command failures.
- Prisma client: generated in `src/generated/prisma`
