# PROMPTS.md — Prompts to give the AI agent

How to use: paste **Prompt 0 (master kickoff)** once at the start of a session. Then paste one **phase prompt** at a time. Review each report before moving on. Use the **review prompts** (R1–R4) after security-critical phases. Replace `{{…}}` placeholders.

Tip: keep `AGENTS.md` and `docs/ARCHITECTURE.md` in the repo root/docs so the agent can always re-read them. When the agent drifts, say: *"Re-read AGENTS.md and ARCHITECTURE.md §X and redo the plan."*

---

## Prompt 0 — Master kickoff (paste once)

```
You are a senior staff engineer building "dineflow", a production multi-tenant SaaS for restaurant dine-in ordering (QR/NFC at the table, customer PWA, staff console, owner console). It will be sold to real restaurants in India first, then globally. Security, correctness, and scalability are top priorities; the product handles money, personal data, and many tenants.

Source of truth:
- /AGENTS.md  (rules of engagement — follow strictly)
- /docs/ARCHITECTURE.md  (full specification — follow strictly)
- /docs/PROMPTS.md  (phase prompts)

Operating mode:
1. Read AGENTS.md and ARCHITECTURE.md fully now. Then reply with:
   a) a 10-line summary of the system in your own words,
   b) the 8 riskiest areas you see and how the spec mitigates each,
   c) any ambiguity, contradiction, or missing decision you notice (do not guess — list them),
   d) the exact list of tools/versions you propose (Node LTS, pnpm, Turborepo, NestJS, Drizzle, Next.js, Vitest, Playwright, k6) after verifying they are current and compatible.
2. Do NOT write code in this first response.
3. From now on, for each task I give you: plan → implement in small slices with tests → run checks → report using the template in AGENTS.md §9.
4. Never skip tests, never weaken security rules, never invent dependencies, never guess on money/auth/tenancy/compliance. Ask instead.
5. Anything touching auth, tables/QR/sessions, payments, webhooks, pricing, state machine, loyalty, RLS, compliance, messaging consent, or AI guardrails must be flagged NEEDS_HUMAN_REVIEW.

Acknowledge by completing step 1.
```

---

## Phase 0 — Foundations

```
TASK: Phase 0 — Foundations (ARCHITECTURE §3, §4, §5, §24, §26, §27, §29 Phase 0).

Goal: a monorepo skeleton that is production-grade from day one, with CI, local dev, config validation, error format, logging, health checks, and the RLS test harness — but NO business features.

Do:
1. Initialize pnpm workspaces + Turborepo with the structure in §4 (apps/api, apps/customer-web, apps/console-web, packages/contracts, packages/api-client, packages/ui, packages/config, infra/docker, infra/terraform skeleton).
2. Shared TS config (strict, noUncheckedIndexedAccess), ESLint (typescript-eslint strict + security plugin + module-boundary rule via eslint-plugin-boundaries or dependency-cruiser), Prettier, Husky pre-commit (lint-staged + gitleaks if available).
3. NestJS app with Fastify adapter: Zod-validated config (crash on invalid), request-id middleware, pino logging with centralized redaction, RFC 7807 exception filter with error-code registry in packages/contracts, /healthz and /readyz, global validation pipe via nestjs-zod, OpenAPI generation endpoint (non-prod), graceful shutdown.
4. Drizzle setup + migration runner for hand-written SQL migrations; DB "tx helper" that sets `app.org_id` via set_config(..., true) per transaction; separate DB roles (migrator vs app, app without BYPASSRLS) created in an initial migration.
5. docker-compose.dev.yml: Postgres (with pgcrypto, citext, pg_trgm, pgvector), Redis, MinIO, Mailpit. `pnpm dev` starts everything.
6. GitHub Actions CI per ARCHITECTURE §27 (typecheck, lint, unit, integration w/ Testcontainers, build, CodeQL/semgrep, gitleaks, dependency audit, Trivy for Docker build). Make the pipeline real and runnable.
7. RLS test harness: a sample tenant table `_sample_items` with forced RLS + policy, and an integration test that (a) creates two orgs, (b) proves cross-tenant SELECT/UPDATE/DELETE return zero rows and cross-tenant INSERT fails, (c) enumerates all public tables from pg_catalog and FAILS if any table with an `org_id` column lacks forced RLS.
8. Minimal Next.js shells for customer-web and console-web (health page only) with security headers (CSP with nonce, HSTS, etc.).
9. Write docs/adr/0001-record-architecture-decisions.md and docs/threat-model.md skeleton (STRIDE table from §22).

Acceptance criteria: `pnpm i --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm test:int` all pass; CI green; `pnpm dev` boots; RLS harness test fails if I add a tenant table without RLS (demonstrate by a temporary failing example, then remove).

Out of scope: any business features. Report using AGENTS.md §9.
```

---

## Phase 1 — Identity, tenancy, RBAC

```
TASK: Phase 1 — Identity & tenancy (ARCHITECTURE §6, §7 tenancy/identity tables, §12, §13, §22).

Do:
1. Migrations + RLS for organizations, outlets, staff_users, memberships, customers, customer_identities, devices, audit_logs (append-only), consents (append-only), feature_flags.
2. Staff/owner auth: argon2id password hashing, login with throttling, TOTP MFA (enroll/verify/recovery codes; mandatory for OWNER/MANAGER), JWT access (15 min) + rotating refresh tokens stored hashed with reuse detection (revoke token family), session list + revoke, password reset with single-use hashed token.
3. Customer OTP auth: request/verify endpoints; `MessagingProvider` interface with a MOCK provider; code stored as HMAC hash with TTL 5 min, 5 attempts, 30 s resend cooldown, per-phone/hour, per-IP/subnet limits via Redis token bucket, Turnstile verification hook (interface + mock), per-org daily OTP cost budget, E.164 normalization (libphonenumber-js), blocked-prefix config. Create/find customer by (org_id, phone_e164). Email/Google linking endpoint stubs requiring a phone-verified customer.
4. RBAC: permission map from §12; `@Require(permission)` decorator; global deny-by-default guard; `@Public()` explicit; object-level ownership checks; a test that enumerates ALL registered routes and fails if any lacks a permission or @Public.
5. Audit-log interceptor for privileged actions.
6. Tests: unit (tokens, hashing, OTP logic), integration (full flows), security tests (refresh reuse detection, OTP brute force, rate limits, MFA enforcement, IDOR across customers/orgs, role matrix for every permission).

Flag NEEDS_HUMAN_REVIEW for auth + RBAC. Ask me before choosing any managed IdP; default is the in-repo implementation described in §12.

Acceptance: all tests pass; coverage ≥ 90% on auth module; route-permission test green; demonstrate a cross-tenant token being rejected.
```

---

## Phase 2 — Menu, media, stock, customer menu UI

```
TASK: Phase 2 — Menu (ARCHITECTURE §7 menu tables, §13 public/menu & console/menu, §16, §17 staff stock, §22 file upload).

Do:
1. Migrations + RLS: menu_categories, menu_items (i18n jsonb, allergens, veg_type, search_vector, embedding column reserved), item_media, modifier_groups, modifiers, item_availability, menu_versions.
2. Console APIs: CRUD (permission `menu:write`), stock update (`stock:update`, available to KITCHEN/CAPTAIN), audit logs. Any change bumps `menu_versions.version` in the same transaction.
3. Media: presigned S3/MinIO PUT with enforced content-type/size; async job that validates, re-encodes with sharp (AVIF/WebP + sizes), strips EXIF, writes to the processed bucket; video via a `VideoProvider` interface with a mock (Cloudflare Stream/Mux later).
4. Public menu endpoint with ETag + Cache-Control per §13, Redis menu cache invalidated by version; returns only public fields.
5. Customer web: menu page (no login), sticky category nav, search, veg filters, allergen tags, item sheet with image carousel and lazy video, i18n (en, hi), skeletons, PWA service worker (app shell + last menu, stale-while-revalidate), Lighthouse budget checks in CI (mobile profile).
6. Console web: menu manager UI + stock toggle UI (tablet-friendly).
7. Tests: unit/integration (incl. cross-tenant), upload validation (wrong type/oversize/polyglot), cache invalidation, e2e: owner edits item → customer menu reflects within 5 s.

Acceptance: Lighthouse mobile performance ≥ 90 on the menu page with throttled 4G (record numbers); stock change reflected ≤ 5 s; no authenticated data cached by the service worker.
```

---

## Phase 3 — Tables, QR tokens, sessions, verification

```
TASK: Phase 3 — Tables & sessions (ARCHITECTURE §9, §7 tables/sessions, §22 threat model rows for QR abuse).  NEEDS_HUMAN_REVIEW.

Do:
1. Migrations + RLS: tables, table_sessions, table_session_guests, waiter_calls.
2. Signed QR token service: payload {v, org, outlet, table, tv, kid}, HMAC-SHA256 (or Ed25519) with rotating key set from secrets, constant-time verify, `qr_token_version` revocation. Console endpoint to generate QR sheet PDFs per outlet.
3. `POST /v1/public/table-sessions/resolve` → validates token, outlet open, returns public outlet info + session state + short-lived guest session JWT bound to the table.
4. Verification modes per outlet (VERIFIED_PAY_LATER | PAY_FIRST | HYBRID): staff open-session endpoint; table-code verification (4–6 digits per outlet config; Redis TTL; rotates on session close and every N minutes; constant-time compare; max 5 attempts per session and per IP per 15 min with lockout); approval-based path.
5. Pure `risk engine` (orders/risk) returning {PAY_FIRST | PAY_LATER | STAFF_APPROVAL, reasons[]}; exhaustive unit tests with a decision table; property tests for monotonicity (higher risk never loosens the decision).
6. Session lifecycle jobs: expire inactive sessions; close on full settlement.
7. Call-waiter endpoint with rate limit (per session) and console queue (ack/resolve).
8. Abuse tests: forged token, tampered payload, old `tv`, replayed token after rotation, code brute force, remote scan without session, code sharing across tables, session fixation.

Acceptance: all abuse tests pass; risk-engine decision table documented in docs/adr; no tokens/codes appear in logs (assert via log capture test).
```

---

## Phase 4 — Orders, pricing, realtime, KDS

```
TASK: Phase 4 — Orders & realtime (ARCHITECTURE §8, §10, §14, §15, §7 orders). NEEDS_HUMAN_REVIEW for pricing + state machine.

Do:
1. Migrations + RLS: orders, order_items (snapshots), order_events (append-only), outbox_events, idempotency_keys.
2. Pure `pricing` module: availability validation → line price (base + modifiers) → coupon/loyalty hooks (interfaces; implemented in Phase 7) → per-line tax using outlet tax_config (inclusive/exclusive) → rounding rule with explicit adjustment line → tip → grand total. Property tests (fast-check): total = sum(parts), never negative, caps respected, rounding invariant.
3. `POST /orders/quote` and `POST /orders` (Idempotency-Key required; returns 409 PRICE_CHANGED with new quote if totals differ; caps on items/qty; respects risk-engine outcome from Phase 3).
4. Explicit order state machine (transition table + single `transition()` function writing order_events + outbox in one transaction). Unit-test every allowed and forbidden transition. Item void flow with audit.
5. Outbox relay worker (FOR UPDATE SKIP LOCKED) → Redis pub/sub; at-least-once with idempotent consumers.
6. Realtime: WebSocket for staff/KDS (JWT handshake, outlet-scoped rooms, acks for new orders), SSE for customers (heartbeat, Last-Event-ID resume), REST `since` cursor for resync, connection caps.
7. Console UI: live board (New/Approval, Preparing, Ready, Served), sound/vibration alerts until ack, table map, one-tap approve/reject, degraded-mode polling fallback. Customer UI: cart, checkout (verification path from server), tracking page.
8. Tests: concurrency (double submit → one order), outbox crash/replay, reconnect resync, authorization (customer can't see others' orders), e2e golden path up to "served" using the mock payment provider.

Acceptance: order shows on KDS < 2 s p95 in a k6 run (record); duplicate submissions create exactly one order; killing the relay mid-flight loses no events.
```

---

## Phase 5 — Payments, webhooks, invoices

```
TASK: Phase 5 — Payments & invoices (ARCHITECTURE §11, §10 tax, §7 payments/invoices). NEEDS_HUMAN_REVIEW (money).

Before coding: ask me which gateway to implement first ({{Razorpay | Cashfree}}) and confirm sandbox keys exist. Do not proceed with a guessed provider.

Do:
1. Migrations + RLS: payments, webhook_inbox, refunds, invoices (+ gapless counter per outlet/FY with row lock).
2. `PaymentProvider` interface + MOCK adapter (for tests/e2e) + the chosen real adapter (sandbox). Hosted checkout only; no card data touches our servers.
3. Create-payment (idempotent, amount re-validated server-side). Webhook endpoint: raw-body signature verification, insert into webhook_inbox (unique provider+event_id), 200 fast, async processing, amount/currency match check else flag MISMATCH (no auto-accept), idempotent state transitions.
4. Reconciliation job for stale PENDING payments + daily settlement report scaffolding.
5. Modes: gateway checkout, DIRECT_UPI_STAFF (staff "mark paid" with reason + audit), counter tender. Outlet config selects allowed modes; owner can see fees/net (fee model data-driven, no hardcoded rates).
6. Refunds (partial/full) with permission `refunds:create`, mandatory reason, audit, reversal of loyalty/coupon effects (interfaces now).
7. Split-settlement integration points (linked account IDs per outlet) behind the provider interface; document the onboarding steps; do NOT pool funds.
8. GST invoice generation (data-driven tax breakup, gapless numbering per outlet/FY, PDF render job).
9. Tests: forged/duplicate/out-of-order/replayed webhooks, amount mismatch, concurrent invoice numbering (no gaps/dupes under parallel load), idempotent create/refund, redirect-success-without-webhook must NOT mark paid.

Acceptance: all above tests pass; webhook endpoint fuzz test (malformed bodies) never 5xx; coverage ≥ 90% on payments.
```

---

## Phase 6 — Owner analytics

```
TASK: Phase 6 — Owner analytics (ARCHITECTURE §17 owner, §15 rollups, §25).

Do: rollup tables (daily/hourly by outlet, item, payment method, customer cohort) populated by jobs; analytics endpoints (`analytics:view`) for: today vs comparison, revenue/orders/AOV/tips/discounts/refunds, top/bottom items, hourly heatmap, payment mix + fees + net, new vs returning, repeat rate; async CSV/XLSX export with signed expiring links and audit entries for PII-bearing exports; console UI charts + filters + date ranges with timezone correctness per outlet.
Tests: reconcile rollups against raw orders/payments on a seeded dataset (property test: rollup sum == raw sum); timezone/DST edge cases; cross-tenant isolation; performance check with 1M-order seed (record EXPLAIN + p95).
Acceptance: numbers reconcile exactly; dashboard queries p95 < 500 ms on the seed.
```

---

## Phase 7 — Loyalty, coupons, referrals

```
TASK: Phase 7 — Loyalty (ARCHITECTURE §18, §7 loyalty tables, §10). NEEDS_HUMAN_REVIEW.

Do:
1. Migrations + RLS: coupons, coupon_redemptions, loyalty_ledger (append-only, unique (ref_type, ref_id, entry_type)), referrals.
2. Coupon engine (pure rules + atomic redemption): audience (ALL/SIGNED_IN/NEW/RETURNING), min order, max discount, validity window, per-customer and global limits, outlet scope, stacking. Guests: "enter coupon code" only; signed-in customers: eligible coupons/credit list.
3. Wallet as non-cashable store credit/points via ledger (balance = SUM), redemption cap % of bill, expiry job, reversal on refund.
4. Referral: configurable per org (defaults: referrer 10% up to ₹500 as wallet credit; referee 10% up to ₹100 instant discount on first order). Referrer credited ONLY after the referee's first order is PAID and COMPLETED. Fraud: block self-referral by phone/device/payment-instrument hash, per-referrer monthly cap, velocity limits, fraud_signals, manual-review queue.
5. Integrate into pricing (Phase 4 hooks) and checkout rules (guest vs signed-in; "Referred by" only on first signup/first order).
6. Tests: property tests (never double-credit, balance never negative, caps hold), concurrency tests (parallel redemption of the same coupon/order), fraud scenarios, refund reversal.
7. Static check: fail the build if any code in loyalty/coupons references review/feedback-to-Google entities (rule from ARCHITECTURE §19).

Acceptance: all tests pass; double-credit impossible under concurrent load test.
```

---

## Phase 8 — Feedback & reputation

```
TASK: Phase 8 — Feedback & Google reviews (ARCHITECTURE §19). NEEDS_HUMAN_REVIEW.

Do: feedback table + endpoints (rating 1–5, tags, comment; one per order); reward = points for giving feedback regardless of rating, with caps and one reward per order; show Google review link to ALL customers equally after feedback (no rating-based gating, no reward wording); alerts to owner/manager for ratings ≤ 3 with order context; Google Business Profile owner-initiated OAuth (tokens encrypted), review sync via Pub/Sub notifications with polling fallback, `review_snapshots` with NO linkage to customers/orders, rating trend + reply tools in the owner console.
Tests: reward only once per order; rating-independent reward; link shown for all ratings (UI test); lint/test guard that no reward code references review data; token encryption; permission checks.
Do not implement any "verify that the customer posted a Google review" logic — it is intentionally out of scope and prohibited.
```

---

## Phase 9 — Messaging

```
TASK: Phase 9 — Messaging (ARCHITECTURE §20, §7 message_log/consents). NEEDS_HUMAN_REVIEW for consent logic.

Ask me first: which WhatsApp BSP and which approved template names to use.
Do: real `MessagingProvider` adapter for the official WhatsApp Cloud API via the chosen BSP; template registry (category, language, status); consent enforcement (transactional vs marketing opt-in), STOP/unsubscribe handling via inbound webhook, quiet hours, frequency caps; cost tracking per message and per-org budgets with alerts; delivery-status webhooks; retry/backoff; SMS fallback for OTP only (DLT template config placeholder).
Use utility templates for receipts/order status, authentication templates for OTP; marketing only with explicit consent. Never use unofficial libraries.
Tests: opt-out honored immediately; budget cap blocks sends; template category mismatch rejected; webhook signature verification; idempotent status updates.
```

---

## Phase 10 — AI assistant

```
TASK: Phase 10 — AI menu assistant (ARCHITECTURE §21). NEEDS_HUMAN_REVIEW for guardrails.

Ask me first which model provider to start with; implement behind an `AiProvider` interface.
Do: embeddings job for menu items (pgvector) + hybrid search (keyword + vector); chat endpoint (session-scoped, rate-limited, per-session and per-org token budgets, max input length, timeouts, caching of frequent Q&A); system rules fixed server-side; read-only tools (`search_menu`, `get_item`) only; answers grounded in retrieved data, otherwise say "I'm not sure — please ask staff" and offer waiter call; allergy answers always include "confirm with staff" and never claim an item is safe; cart suggestions are proposals the UI confirms; redacted transcript logging with short retention; no PII in prompts; graceful degradation when provider is down.
Eval suite in CI (fixed prompts): allergen questions, off-topic, prompt-injection attempts ("ignore previous instructions", menu-text injection), data-exfiltration attempts, multilingual (en/hi). Define pass thresholds and fail the build below them.
```

---

## Phase 11 — Hardening & launch readiness

```
TASK: Phase 11 — Hardening (ARCHITECTURE §22, §23, §24, §25, §26, §27). 

Do:
1. k6 load suite for all §25 scenarios; produce a report with p50/p95/p99, error rates, saturation points, and fixes made; tune pools/indexes.
2. Security pass: run OWASP ZAP baseline against staging; fix findings; verify headers/CSP; verify rate limits; confirm no secrets/PII in logs; dependency/SBOM/container scan clean; verify RLS test covers all tables; run the full authz matrix test.
3. DPDP readiness: consent flows, export/erasure/correction jobs, retention job, breach runbook (72-hour workflow), data inventory doc, processor list. Leave legal wording to counsel; produce the technical evidence.
4. Backups and DR: verify PITR, perform and document a restore drill in docs/runbooks.
5. Observability: dashboards + alerts for SLOs in §24; synthetic checks for the golden path.
6. Pilot onboarding tooling: seed script for a restaurant (menu import CSV, tables + QR sheet, staff accounts), owner onboarding checklist, support runbook.
7. Produce a launch-readiness checklist with pass/fail per item and a list of residual risks.
Acceptance: no open High/Critical findings; restore drill documented; load targets met or gaps documented with owners.
```

---

## R1 — Adversarial security review (use after Phases 1, 3, 5, 7)

```
Act as a hostile penetration tester and a paranoid staff engineer reviewing the {{module}} code and tests in this repo against ARCHITECTURE §22 and AGENTS.md §2.
1. List every way you could: read another tenant's data, place or alter an order without authorization, get an order marked paid without paying, double-spend loyalty/coupons, brute-force or pump OTP/table codes, forge QR tokens or webhooks, escalate roles, or cause money/data loss.
2. For each, point to the exact code/test that prevents it, or state "NOT PREVENTED" with severity and a concrete fix.
3. Write the missing tests as failing tests first, then fix.
4. Do not claim safety without evidence from a test you ran. Output a table: Threat | Evidence (file:line / test name) | Status | Fix.
```

## R2 — Spec conformance audit

```
Compare the current implementation of Phase {{N}} to ARCHITECTURE.md and AGENTS.md line by line. Output: (1) requirements met with evidence, (2) requirements missing or partial, (3) deviations (with justification or "unjustified"), (4) risky shortcuts (TODOs, mocks left in production paths, disabled tests), (5) a prioritized fix list. Then implement fixes for all "missing" and "unjustified deviation" items with tests.
```

## R3 — Performance review

```
Review hot paths (menu fetch, order placement, KDS updates, analytics queries). For each: show the SQL, EXPLAIN (ANALYZE, BUFFERS) on a realistic seeded dataset, identify N+1s, missing/unused indexes, lock contention, and connection-pool risks. Propose and implement fixes, then re-measure and report before/after numbers.
```

## R4 — Bug-fix prompt template

```
BUG: {{what happened, expected vs actual, steps to reproduce, logs with PII removed}}
Procedure: (1) write a failing test that reproduces it, (2) find the root cause (explain it), (3) fix minimally, (4) check whether the same class of bug exists elsewhere (search and list), (5) run the full suite, (6) report using AGENTS.md §9. Do not change unrelated code. If the fix touches a security-critical area, flag NEEDS_HUMAN_REVIEW.
```

---

## Conversation hygiene for long agent sessions

- One phase per session/thread where possible; start each with: "Re-read AGENTS.md and ARCHITECTURE.md §{{sections}}. Confirm constraints in 5 bullets, then plan."
- If the agent proposes a different design: ask for an ADR in `docs/adr/` with trade-offs; you decide.
- Never paste production secrets, real customer data, or live payment keys into any agent session.
- After each phase: merge only after CI is green AND you've read the report's NEEDS_HUMAN_REVIEW items. For auth/payments/tables/loyalty, get an experienced engineer or a paid security reviewer to read the diff before real money flows.
