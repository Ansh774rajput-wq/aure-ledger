# Project context

Fresh implementation from the user's supplied 31-section brief, preserved verbatim in REQUIREMENTS.md. Product working name: Aure Ledger. A personal, single-owner loan-management application primarily for Android/mobile; not an expense tracker or an EMI calculator.

Capital is global and fungible. Separate Loan and Borrowing ledgers have no funding link between them. A Person can hold both roles. Financial history is preserved and pool balance is derived from movements.

Current scope: first financial slice, Disburse Loan, plus the people and own-capital prerequisites needed to use it. Financial correctness precedes visual polish. No transfers or banking credentials. No ongoing older repository has been reused.

Current verification is mixed: application/domain/auth tests and UI checks pass, but real PostgreSQL execution is blocked. Never describe this delivery as production ready or claim rollback is proven. See DEVELOPMENT_STATUS.md and HANDOFF.md for exact results and continuation instructions.
