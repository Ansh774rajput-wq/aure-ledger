You are the lead engineer responsible for building a production-quality Loan Management System from scratch.

This is a FRESH PROJECT / FRESH REPOSITORY.

You are not continuing or repairing an older implementation.

I am not a technical user. You are responsible for making sound engineering decisions, writing the code, installing dependencies, running commands, setting up the database, testing your work, fixing errors, and keeping the repository understandable for another coding agent.

Do NOT ask me to manually write code or perform technical work unless something genuinely requires my credentials, account access, or an external action only I can perform.

Work autonomously through meaningful implementation slices instead of stopping after every tiny step.

==================================================
1. PRODUCT
==================================================

Build a professional, mobile-first personal Loan Management System.

This is NOT:

- an expense tracker
- a Khata clone
- a simple EMI calculator
- a generic accounting dashboard

The application manages:

1. Money I lend to borrowers
2. Money I borrow from lenders
3. My own capital
4. One GLOBAL FUNGIBLE CAPITAL POOL
5. Interest
6. Borrower repayments
7. Lender repayments
8. Early loan closure
9. Financial history
10. Auditability

The application should ultimately work extremely well on Android/mobile.

==================================================
2. MOST IMPORTANT ACCOUNTING RULE
==================================================

Capital is GLOBAL AND FUNGIBLE.

Do NOT permanently attach money borrowed from a lender to a specific borrower loan.

Borrower loans and lender borrowings are SEPARATE LEDGERS.

The global pool represents actual available capital.

Example:

Own capital = ₹50,000.

I lend ₹10,000 to Borrower A.

Available pool = ₹40,000.

Later Lender X lends me ₹10,000.

Pool = ₹50,000.

The ₹10,000 from X is NOT permanently tied to Borrower A.

If A later repays money, that money enters the GLOBAL capital pool.

The system may then recommend using available capital to repay X.

NEVER implement logic such as:

"Lender X cannot be repaid because Borrower A still owes money."

There is no permanent:

Borrower A ↔ Lender X

funding relationship.

==================================================
3. SECOND CAPITAL-POOL EXAMPLE
==================================================

Own capital = ₹50,000.

Loan A disbursement = ₹40,000.

Pool remaining = ₹10,000.

I need to disburse Loan B = ₹20,000.

I borrow ₹10,000 from a lender.

Pool becomes ₹20,000.

Loan B is disbursed.

Pool becomes ₹0.

Later Loan A repays ₹40,000.

Pool becomes ₹40,000.

The system can recommend repaying outstanding borrowing using that available capital.

Again:

NO permanent loan ↔ borrowing funding relationship.

==================================================
4. CORE DOMAIN
==================================================

Design around concepts approximately like:

Person
BorrowerProfile
LenderProfile
Loan
Borrowing
PoolTransaction
Payment
InterestAdjustment
EquityEntry
AuditLog

A Person may simultaneously be:

- a borrower
- a lender

Do not unnecessarily create duplicate Person records for the same human.

==================================================
5. GLOBAL CAPITAL POOL
==================================================

Do NOT implement the pool as an arbitrary manually editable balance.

The available capital should be derivable/auditable from financial transactions.

Examples:

OWN CAPITAL ADDED
→ pool IN

BORROW MONEY FROM LENDER
→ pool IN

LOAN DISBURSEMENT
→ pool OUT

BORROWER REPAYMENT
→ pool IN

LENDER REPAYMENT
→ pool OUT

EQUITY WITHDRAWAL
→ pool OUT

Every pool movement must be traceable.

The system should make it possible to reconstruct why the available capital is what it is.

==================================================
6. FINANCIAL INTEGRITY
==================================================

This is financial software.

Correctness is more important than convenience.

Use decimal-safe financial arithmetic.

NEVER use JavaScript floating-point arithmetic for monetary calculations.

Use an appropriate decimal representation such as Decimal.js / Prisma Decimal / PostgreSQL NUMERIC.

Enforce appropriate rules including:

- principal > 0
- payments > 0
- interest rates cannot be negative
- monetary amounts cannot become invalid/negative
- reject NaN/Infinity/non-finite financial inputs
- reject invalid dates
- due date must be after start date
- prevent payment above outstanding amount unless explicit overpayment support is intentionally added
- duplicate UTR/reference should WARN rather than automatically being globally unique
- do not permanently delete financial history
- protect referenced financial records from deletion
- related financial writes must be atomic
- if part of a financial operation fails, the entire operation must roll back

Never silently mutate historical financial facts.

==================================================
7. ACCOUNTING SEMANTICS
==================================================

Borrowed principal is NOT income.

Borrower principal repayment is NOT profit.

Interest received is distinct from principal returned.

Lender principal repayment is distinct from borrowing cost/interest.

Keep these concepts explicit throughout the domain model, database, UI and reporting.

==================================================
8. INTEREST SYSTEM
==================================================

Build the interest system so that the calculation method is explicit and visible.

Initial conventions:

Interest accrual:

- start/disbursement date INCLUSIVE
- repayment date EXCLUSIVE

Day convention:

- Actual/365 fixed

Precision:

- preserve full precision internally
- official payable/statement/payment allocation values round to ₹1
- ROUND HALF UP

Payment allocation order:

1. fees
2. interest
3. principal

Monthly calculations:

- clamp to end-of-month where necessary
- anchor calculations to the original start-day convention

Do not hide the interest calculation method from the user.

If multiple interest methods exist, keep them explicitly identified.

Do not silently treat two methods as equivalent without documenting the behavior.

==================================================
9. EARLY CLOSURE
==================================================

Support early closure without destroying the original agreement.

Example:

Principal = ₹20,000

Original agreed interest = ₹1,000

System suggested early-close interest = ₹600.

Admin accepts reduction.

Store/display:

Original interest: ₹1,000
Final interest: ₹600
Interest reduction: ₹400
Final payable: ₹20,600
Status: CLOSED EARLY

Do NOT overwrite the original ₹1,000 as though it never existed.

Default early-closure suggestion:

original agreed interest
×
elapsed days
÷
original agreed term days

Use:

- original loan start date
- original agreed due date
- early closure date

If elapsed time >= original agreed term:

do not produce an early-closure reduction suggestion.

Admin must eventually be able to:

- accept suggestion
- reject suggestion
- manually override

Manual override requires a reason.

Final interest cannot be negative.

Allow multiple signed interest adjustments while preserving historical records.

==================================================
10. OVERDUE POLICY
==================================================

For the initial version:

DO NOT automatically add:

- penalties
- late fees
- additional overdue interest

unless we explicitly add such a policy later.

An overdue status may be displayed without automatically changing the financial obligation.

==================================================
11. AUDITABILITY
==================================================

Financial history matters.

Important actions should be auditable.

Preserve information such as:

- what happened
- when it happened
- who performed it
- relevant entity IDs
- transaction references
- financial meaning
- original values where appropriate
- changed/final values where appropriate

Do not allow normal UI operations to erase financial history.

==================================================
12. SECURITY / SCOPE
==================================================

Do NOT:

- initiate automatic bank transfers
- store banking passwords
- store OTPs
- store PINs
- store sensitive banking credentials

If document import/OCR is added later, extracted information must NOT automatically finalize financial transactions without confirmation.

==================================================
13. TECH STACK
==================================================

Build a modern TypeScript application.

Preferred stack:

- Next.js
- TypeScript
- PostgreSQL
- Prisma
- Zod
- Tailwind CSS
- shadcn/ui
- Vitest
- decimal.js or another appropriate decimal-safe implementation

Use current stable versions that work together.

Do not blindly use obsolete configuration from old tutorials.

The application should be a clean modular monolith.

Maintain sensible separation between:

DOMAIN
↓
APPLICATION / USE CASES
↓
INFRASTRUCTURE / DATABASE
↓
PRESENTATION / UI

Do NOT over-engineer this into unnecessary microservices.

==================================================
14. MOBILE-FIRST UX
==================================================

The application should feel like a polished modern financial mobile application.

Mobile/Android usability is the priority.

Likely primary navigation:

Dashboard
Loans
Borrowings
People
More

Use a mobile bottom navigation where appropriate.

The dashboard should eventually show useful financial information such as:

Available Capital
Money Currently Lent
Outstanding Borrowing
Interest Earned
Upcoming Dues
Overdue Loans
Recent Activity

Use:

- clean cards
- strong monetary typography
- clear information hierarchy
- subtle animation where useful
- obvious quick actions
- good spacing
- useful empty states
- search/filtering
- responsive layouts
- polished forms
- clear validation
- readable transaction history

Do NOT make it look like a generic old admin dashboard.

Aim for:

premium
minimal
modern
financial
clean
fast

However:

DO NOT sacrifice financial correctness to polish UI.

The financial foundation comes first.

==================================================
15. CREATOR SIGNATURE
==================================================

Include the exact phrase:

adonis's creation

somewhere subtly within the application as a creator signature.

THIS IS NOT A WATERMARK.

Requirements:

- it must not obstruct content
- it should NOT appear prominently on every screen
- it should feel like an intentional designer/developer signature
- keep it understated
- keep it premium
- use small/muted typography
- integrate it naturally into the interface

Potential locations include:

- bottom of the More page
- Settings/About section
- bottom of a sidebar/menu
- login/splash footer
- subtle application footer

Choose whichever location best fits the final design.

Do NOT make it large or distracting.

Do NOT write things like:

"MADE BY ADONIS!!!"

The exact visible text must be:

adonis's creation

Treat it like a subtle easter egg / creator signature.

==================================================
16. FUTURE FEATURES
==================================================

Design the architecture so we can later implement:

- borrower statements
- lender statements
- repayment schedules
- reminders
- reconciliation
- search/filtering
- attachments/documents
- backup/restore
- financial reports
- capital recommendations
- borrowing repayment recommendations
- due-date notifications
- PWA installation
- Android-friendly installation/UX

Do NOT try to implement all of these in the first execution.

==================================================
17. FIRST EXECUTION
==================================================

I want you to actually BUILD THE APPLICATION.

Do NOT respond with only:

- an architecture proposal
- a roadmap
- pseudocode
- a list of files you would create

Inspect the fresh repository and start implementing.

Establish the project and foundational configuration.

Then implement the first meaningful vertical slice.

Build:

1. Project/application foundation

2. Core domain/value objects required for:
   - money
   - dates
   - interest

3. PostgreSQL/Prisma schema for the core entities

4. Initial database migration

5. Global PoolTransaction model

6. Interest calculation engine

7. First end-to-end financial use case:

DISBURSE LOAN

==================================================
18. DISBURSE LOAN
==================================================

Disburse Loan should accept approximately:

- borrower
- principal
- rate
- interest method
- start date
- due date
- performedBy

Validate everything before financial I/O.

Validation must include:

- borrower reference required
- principal > 0
- principal valid monetary amount
- rate >= 0
- rate finite
- valid interest method
- valid start date
- valid due date
- due date > start date
- performedBy non-empty/non-whitespace

Do not perform a separate borrower existence pre-check if doing so introduces a race condition.

The database FK can enforce borrower existence.

==================================================
19. DISBURSEMENT TRANSACTION
==================================================

A valid loan disbursement must atomically perform:

CREATE LOAN

+

CREATE POOL TRANSACTION

PoolTransaction:

direction = OUT

type = LOAN_DISBURSEMENT_OUT

amount = principal

loan reference = newly created Loan

borrowing reference = null

transaction date = loan start date

These writes MUST execute inside ONE REAL PostgreSQL transaction.

If Loan creation succeeds but PoolTransaction creation fails:

THE LOAN MUST ROLL BACK.

Do not fake atomicity using in-memory behavior.

Do not claim atomicity is proven merely because application unit tests pass.

==================================================
20. AUDIT BEHAVIOR
==================================================

Create a sensible audit abstraction.

Financial correctness takes priority over best-effort audit writing.

Avoid designs where retrying an operation after an audit failure could accidentally disburse a loan twice.

If you choose best-effort auditing for this first slice:

- clearly document that decision
- audit failure must not falsely report that the financial transaction failed if it actually committed
- do not automatically retry the financial operation merely because audit writing failed

If you believe an outbox approach is necessary immediately, justify it before adding substantial complexity.

Do not gold-plate this first version.

==================================================
21. TESTING
==================================================

Write meaningful tests.

INTEREST / DOMAIN tests should cover:

- money precision
- negative-value rejection
- invalid values
- date boundaries
- Actual/365 behavior
- monthly end-of-month behavior
- rounding
- payment allocation
- early closure
- interest adjustments

DISBURSEMENT APPLICATION tests should cover:

- valid request
- invalid principal
- invalid rate
- non-finite rate
- invalid dates
- due date before/equal to start
- empty performedBy
- whitespace performedBy
- gateway called exactly once on valid input
- gateway never called when validation fails
- audit behavior where applicable

==================================================
22. REAL DATABASE INTEGRATION TESTS
==================================================

Do not stop at mocked database tests.

Use REAL PostgreSQL + REAL Prisma behavior to prove the first financial operation.

TEST A — SUCCESSFUL DISBURSEMENT

Confirm:

- Loan exists
- PoolTransaction exists
- amount is correct
- direction = OUT
- type = LOAN_DISBURSEMENT_OUT
- loan reference is correct
- borrowing reference is null
- transaction date is correct

TEST B — INVALID BORROWER

Use a nonexistent borrowerProfileId.

Confirm:

- PostgreSQL FK rejects the operation
- no Loan remains
- no PoolTransaction remains

TEST C — REAL TRANSACTION ROLLBACK

Force PoolTransaction creation to fail AFTER Loan creation inside the transaction.

Confirm:

- Loan creation occurred within the transaction
- second write fails
- PostgreSQL rolls the transaction back
- no Loan remains
- no PoolTransaction remains

The failure mechanism should be deterministic and test-only.

Do NOT permanently modify the production schema merely to force this failure.

Do NOT use an in-memory fake and claim PostgreSQL rollback has been proven.

==================================================
23. DATABASE CONSTRAINTS
==================================================

Use PostgreSQL constraints where they provide valuable financial protection.

Examples include:

- positive/non-negative amounts as appropriate
- non-negative interest rates
- valid date relationships
- valid target relationships
- referential integrity
- deletion restrictions for financial records

Do not rely exclusively on frontend validation.

Use defense in depth:

UI validation
+
application validation
+
database constraints

where appropriate.

==================================================
24. UTR / TRANSACTION REFERENCES
==================================================

Support transaction references/UTRs.

Duplicate references should generate a WARNING.

Do NOT automatically make them globally unique unless there is a clearly justified business rule requiring it.

Real financial data may contain duplicates, mistakes or corrections that need investigation rather than silent rejection.

==================================================
25. DELETION / HISTORY
==================================================

Do NOT permanently delete financial history through normal application behavior.

Prefer:

- status changes
- cancellation/reversal records
- audit entries
- immutable historical references

over destructive deletion.

Referenced financial records should generally use restrictive foreign-key behavior.

==================================================
26. SOURCE-OF-TRUTH DOCUMENTATION
==================================================

Create and maintain:

PROJECT_CONTEXT.md
REQUIREMENTS.md
ARCHITECTURE.md
DOMAIN_RULES.md
DECISIONS.md
DEVELOPMENT_STATUS.md
HANDOFF.md

These files are important.

They allow another AI coding agent to continue the project if this conversation loses context.

HANDOFF.md should always include:

- current phase
- current task
- what has been completed
- repository structure
- important architectural decisions
- database state
- migrations
- tests
- exact test results
- known blockers
- unfinished work
- exact next recommended development step

DEVELOPMENT_STATUS.md should accurately distinguish:

COMPLETE
IN PROGRESS
BLOCKED
NOT STARTED

Never mark something complete merely because code exists.

If it has not been tested where testing is required, say so.

==================================================
27. DEVELOPMENT SETUP
==================================================

Make the repository reproducible on another developer machine.

Provide clear setup documentation including:

- Node requirements
- dependency installation
- PostgreSQL setup
- required environment variables
- DATABASE_URL
- Prisma generation
- migration/database setup
- test commands
- development server command

Do not commit secrets.

Provide `.env.example` if appropriate.

==================================================
28. HOW YOU SHOULD WORK
==================================================

You have autonomy to:

- create files
- edit files
- install dependencies
- initialize the application
- run commands
- create the database structure
- run migrations
- run tests
- inspect errors
- debug failures
- fix your implementation
- refactor when genuinely necessary

Do NOT stop after every tiny action and ask me permission.

Work through the first implementation slice autonomously.

If a normal implementation detail is ambiguous, choose a sensible conservative solution and document the decision.

Ask me only when:

- a major business rule is genuinely ambiguous
- credentials/access are required
- an irreversible external action requires approval
- two substantially different product directions require my decision

==================================================
29. DO NOT FAKE SUCCESS
==================================================

This requirement is extremely important.

If something fails:

SAY IT FAILED.

If PostgreSQL is unavailable:

say PostgreSQL is unavailable.

If Prisma generation fails:

show the actual failure.

If a test doesn't execute:

say it did not execute.

If database rollback has not been empirically tested:

say rollback has not been proven.

Do NOT:

- create fake generated clients
- invent fake Prisma typings
- replace database integration tests with mocks and call them integration tests
- report tests as passing when they did not run
- suppress errors just to make output green

Preserve working code and clearly report blockers.

==================================================
30. DELIVERY PRIORITY
==================================================

We need a usable product quickly.

Therefore:

BUILD, TEST, THEN MOVE FORWARD.

Avoid:

- architecture astronautics
- unnecessary abstraction
- premature microservices
- implementing ten unfinished features simultaneously
- endless planning documents
- unnecessary rewrites
- polishing screens before financial logic works

Prefer meaningful vertical slices.

The goal is not merely beautiful source code.

The goal is a working, trustworthy Loan Management System.

==================================================
31. WHEN THIS FIRST EXECUTION ENDS
==================================================

Give me a concise but complete report containing:

1. WHAT YOU BUILT

2. REPOSITORY STRUCTURE

3. EXACT FILES CREATED/CHANGED

4. DATABASE/SCHEMA STATUS

5. MIGRATION STATUS

6. TESTS RUN

7. EXACT PASS/FAIL COUNTS

8. REAL DATABASE TEST RESULTS

9. WHETHER TRANSACTION ROLLBACK WAS ACTUALLY PROVEN

10. ANYTHING THAT COULD NOT BE TESTED

11. BLOCKERS

12. SCREENS/FEATURES CURRENTLY USABLE

13. WHERE "adonis's creation" WAS PLACED

14. EXACT NEXT RECOMMENDED IMPLEMENTATION SLICE

Do not merely tell me what you intend to build.

START BUILDING THE PROJECT NOW.