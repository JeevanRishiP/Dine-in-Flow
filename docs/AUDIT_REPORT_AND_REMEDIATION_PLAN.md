# DineFlow Security, Correctness & Massive-Scale Audit Report & Remediation Plan

**Audit Scope:** Full-stack monorepo (`apps/api`, `apps/console-web`, `apps/customer-web`, `packages/contracts`, `apps/api/src/db/migrations`, `infra/`, `.github/workflows/ci.yml`) against `docs/ARCHITECTURE.md` and `AGENTS.md`.  
**Target Scale Profile:** Multi-tenant SaaS / Agency scale (thousands of restaurant orgs, multiple outlets per org, thousands of concurrent QR scans, lunch-rush order/KDS bursts, multi-instance horizontal API scaling).

---

## Executive Summary

The codebase already has solid architectural foundations in several domain primitives (for example, integer-paise monetary units, Zod `.strict()` DTO schemas in several modules, pure state-machine/pricing modules, tenant RLS migration policies, and an outbox pattern). However, an end-to-end audit uncovered **P0 remote payment/order/profile takeover vulnerabilities**, **systemic RLS failures masked by local `postgres` superuser configuration**, **database connection-pool deadlock patterns in AI/messaging**, **multi-instance scaling blockers**, and **client-side authentication backdoors in the frontends**.

Deploying the codebase as-is to agency or public multi-tenant production would allow unauthenticated attackers to:
1. Mark arbitrary orders across any tenant as `PAID` & `CONFIRMED` without paying.
2. Mutate live kitchen order/item states across tenants via `@Public()` KDS endpoints.
3. Steal/overwrite customer profiles, diner preferences, and feedback across tenants (IDOR).
4. Forge table sessions by passing plain table numbers (`T01`, UUIDs) instead of signed HMAC QR tokens.
5. Bypass MFA (`verifyMfa` accepts raw `{ orgId, userId, code }` with plaintext TOTP secrets and no rate limiting or replay guard).
6. Exhaust the PostgreSQL connection pool under light concurrent AI chat traffic via nested connections held across external Gemini HTTP calls.
7. Trigger account bans on WhatsApp via the unofficial WhatsApp-Web (`EvolutionAdapter`) single-instance bridge, breaking agency-scale multi-tenancy and violating `AGENTS.md` §2 rule 11.

---

## Part 1 — Verified Audit Findings

### 1. P0 Critical Security Loopholes & Exploits

| ID | Area | File(s) | Vulnerability & Exploit Scenario |
|---|---|---|---|
| **SEC-01** | Payments (`simulate-success` & counter modes) | `apps/api/src/modules/payments/payments.controller.ts`, `payments.service.ts` | `CustomerPaymentsController` exposes `@Public()` endpoints `POST /v1/customer/payments/:id/simulate-success`, `POST /v1/customer/payments/simulate-order-success`, `GET /v1/customer/payments/:id`, `GET /v1/customer/payments/:id/verify`, and `GET /v1/customer/payments/verify-order` with zero `NODE_ENV` guard and zero tenant/session auth. Furthermore, `POST /v1/customer/payments` is `@Public()`, derives `org_id` directly from `orders` via unauthenticated pool lookup, and lets `CUSTOMER` actors call `CASH` / `DIRECT_UPI_STAFF` / `PAY_AT_COUNTER`, which `PaymentsService.createPayment` immediately marks as `PAID` and sets the order to `CONFIRMED`. `CustomerPaymentsController` is also missing from `security-audit.spec.ts`. |
| **SEC-02** | Public KDS & Unbound Customer Order/SSE Endpoints | `apps/api/src/modules/orders/orders.controller.ts`, `orders.service.ts`, `realtime/sse.controller.ts`, `realtime/kds.gateway.ts` | `ConsoleOrdersController` exposes `@Public()` `/v1/console/orders/feed`, `PATCH /v1/console/orders/:id/status/public`, and `PATCH /v1/console/orders/:id/items/:itemId/status/public` — enabling anonymous cross-tenant KDS snooping and order state tampering. When `orgId` is empty, `OrdersService` falls back to `SELECT id FROM organizations LIMIT 1`. `CustomerOrdersController` and `SseController` are `@Public()` without enforcing a signed guest table-session JWT tying the caller to `{ org, outlet, table, sessionId }`. |
| **SEC-03** | MFA Verification Bypass, Weak Secrets & Membership Fallback | `apps/api/src/modules/auth/staff-auth.controller.ts`, `staff-auth.service.ts` | `POST /v1/staff/auth/mfa/verify` is `@Public()` and accepts raw `{ orgId, userId, code }` instead of a short-lived cryptographic `pre_mfa` token issued by `login()`. It lacks MFA rate limiting, lacks TOTP replay prevention (within the 30s time window), stores/reads `totp_secret_enc` without AES-256-GCM envelope encryption, and falls back to `{ role: 'WAITER', outlet_id: null }` in `_getMembership` when no active membership row exists. `login()` does not enforce MFA for `OWNER` / `MANAGER` and refresh-token rotation lacks atomic `UPDATE ... WHERE is_revoked = false RETURNING *`. |
| **SEC-04** | Table QR Forgery & Cross-Tenant Collision | `apps/api/src/modules/tables/tables.service.ts` | `TablesService.openSession` has an unverified fallback branch when `qr_token` is not HMAC-signed: it strips `"Table "` and queries `WHERE (id::text = $1 OR table_number ILIKE $1) AND is_active = true LIMIT 1` **without `org_id`**. An attacker can forge sessions for `"T01"`/`"T04"` without scanning a QR code and collide across tenants sharing table numbers. `openSession` also fails to return a signed guest session JWT for subsequent customer API calls. |
| **SEC-05** | Customer Profile & Diner-Profile IDOR + Hardcoded Org | `apps/api/src/modules/auth/customer-auth.controller.ts`, `customer-otp.service.ts` | `/v1/customer/auth/profile` and `/diner-profiles*` (`GET`, `POST`, `DELETE`) are `@Public()`, trust query/body `customerId`, `orgId`, and `profileId`, default missing `orgId` to a hardcoded UUID `'7762b6af-...'`, and pass raw untyped body to `deleteDinerProfile`. Any caller can enumerate, overwrite, or delete another user's or tenant's profiles. |
| **SEC-06** | Feedback IDOR & Insecure Dev Token Key Fallback | `apps/api/src/modules/feedback/feedback.controller.ts`, `feedback.service.ts` | `submitFeedbackGuest` (`@Public()`) looks up any `orderId` globally on the raw pool and attaches feedback without proving table-session or customer ownership. `FeedbackService` contains a hardcoded encryption fallback key in code when env is absent, and `listReviews` accepts untyped query parameters instead of a `.strict()` Zod DTO. |
| **SEC-07** | Unauthenticated WhatsApp Webhook & Consent Spoofing | `apps/api/src/modules/messaging/messaging.controller.ts`, `messaging.service.ts` | `WhatsAppWebhookController` (`POST /v1/webhooks/whatsapp`) has no signature or secret verification, allowing forged inbound messages/opt-outs. `CustomerConsentController.recordConsent` does not verify that `dto.phone === user.phone`. |
| **SEC-08** | Console & Customer Web Client-Side Auth Backdoors | `apps/console-web/app/lib/restaurant-db.ts`, `apps/console-web/app/{page,staff/page,owner/page}.tsx`, `apps/customer-web/app/{page,scan/page,payment/phonepe/return/page}.tsx` | `console-web` relies on client-side mock auth leaking credentials in client state (`StaffPass@2026`, `PilotLaunch2026!`, plaintext PINs), honors `?role=OWNER` URL query bypasses, and accepts any 6-digit TOTP code. `customer-web` hardcodes Royal Spice Bistro UUIDs/VPA, calls `/simulate-success` for cash/UPI flows, ignores QR HMAC signatures, and stores JWTs in `localStorage` without sending `Authorization: Bearer` headers. |

---

### 2. P1 Multi-Tenancy, RLS & Authorization Defects

| ID | Area | File(s) | Issue & Impact |
|---|---|---|---|
| **MT-01** | Superuser `.env` Masking Broken RLS Contexts | `apps/api/src/db/client.ts`, `apps/api/src/db/migrations/*`, `.env.example` | Dev `.env` connects as `postgres` (`BYPASSRLS`), masking runtime failures under the restricted app role `dineflow_app`. Under `dineflow_app`: (a) `StaffAuthService._getMembership` and `CustomerOtpService` call `SELECT set_config('app.org_id', ...)` on an autocommit connection (`local=true` resets immediately after that statement!), causing subsequent queries to hit RLS denial / 0 rows; (b) `OutboxRelayService`, `PaymentsService` webhook/reconciliation paths, `CustomerOrdersController` org lookup, and `MessagingService` (`'0000...0000'` org ID) query tenant tables without tenant/system RLS context. |
| **MT-02** | Role & Enum Drift (`CAPTAIN` vs `WAITER`, Outlet Scope) | `packages/contracts/src/enums.ts`, `packages/contracts/src/permissions.ts`, `apps/api/src/common/guards/rbac.guard.ts` | `StaffRole` defines `CAPTAIN` whereas `ROLE_PERMISSIONS` maps `WAITER` (risking permission denial or silent misrouting for `CAPTAIN` staff). `RbacGuard` validates `@Require(permission)` but controllers/services do not consistently enforce `user.outletId` isolation for outlet-scoped staff (`MANAGER`, `CAPTAIN`/`WAITER`, `KITCHEN`, `CASHIER`). Migrations `0004`/`0005` also diverge on status enums vs `packages/contracts/src/enums.ts`. |
| **MT-03** | OTP Brute-Force / Race & Dev-Code Exposure | `apps/api/src/modules/auth/customer-otp.service.ts` | `verifyOtp` reads attempts then updates non-atomically (race allows > max parallel attempts under concurrency); `devCode` return check must strictly require `NODE_ENV === 'development' || NODE_ENV === 'test'`. |

---

### 3. P1 Schema, Financial, Pricing, Loyalty & Compliance Bugs

| ID | Area | File(s) | Bug & Business/Financial Impact |
|---|---|---|---|
| **FIN-01** | Double-Tax in `INCLUSIVE` Pricing Mode | `apps/api/src/modules/orders/pricing.engine.ts` | In `INCLUSIVE` tax mode, tax is back-calculated from item prices for display/reporting, yet line `rawTotal = subtotalPaise + totalTaxPaise - discountPaise + tipPaise` still adds `totalTaxPaise` onto `subtotalPaise` — overcharging inclusive-menu customers. Also throws raw `Error` instead of typed `DomainError(ErrorCode.VALIDATION_FAILED / MAX_QTY_PER_LINE)` on quantity overflow. |
| **FIN-02** | Stale/Cross-Outlet Order Line & Modifier Validation + Shared Notes Bug | `apps/api/src/modules/orders/orders.service.ts` | `buildPricingInput` fails to check `is_active`, `outlet_id`, `item_availability`, `modifiers.is_available`, or `item_modifier_groups` ownership, and maps notes/modifiers dangerously across duplicate items (notes not keyed by line index). Customers could order inactive/wrong-outlet items or unavailable modifiers. |
| **FIN-03** | Loyalty `outletId` Treated as `orgId` & Wallet/Referral Races | `apps/api/src/modules/loyalty/loyalty.controller.ts`, `loyalty.service.ts` | `CustomerLoyaltyController.validateCoupon` passes `dto.outletId` as `orgId` into `LoyaltyService`. `debitWalletForOrder` lacks row locking (`FOR UPDATE`) and expiry-ledger reconciliation integrity under concurrent checkouts. `claimReferral` has missing monthly/cap enforcement atomicity and stores/compares unhashed referral claims. |
| **FIN-04** | Concurrent Refund Over-Refunding | `apps/api/src/modules/payments/payments.service.ts` | `createRefund` does not lock the parent payment row (`FOR UPDATE`) and sum existing pending/succeeded refunds atomically, allowing concurrent refund requests to exceed settled payment amount. |
| **FIN-05** | Constant-Time PhonePe Check & Split-Settlement Readiness | `apps/api/src/modules/payments/phonepe.adapter.ts`, `razorpay.adapter.ts` | `PhonePeAdapter` needs timing-safe (`crypto.timingSafeEqual`) checksum comparison and deterministic provider event IDs. Both adapters only use global merchant credentials with no per-org sub-merchant / Route split-settlement configuration field/scaffolding for agency/SaaS scale. |
| **DB-01** | Broken SQL Column/Table Names in `MenuService._auditLog` & `PrivacyService` | `apps/api/src/modules/menu/menu.service.ts`, `apps/api/src/modules/privacy/privacy.service.ts` | `MenuService._auditLog` inserts into non-existent `audit_logs` columns (`table_name, row_id, before, after`). `PrivacyService` queries non-existent `loyalty_ledger` (`balance_after_paise`, `description`), `orders.state`, and `webhook_inbox.created_at`. |
| **DB-02** | Unsafe Data-Mutating Migrations (`0014`–`0016`) | `apps/api/src/db/migrations/0014*.sql`..`0016*.sql` | Migrations mutate demo/global rows (e.g., `0016` updates `WHERE name = 'Rahul'` across all tenants). Must be neutralized/guarded in forward-only style and avoided going forward. |

---

### 4. P1 Massive & Agency-Scale Bottlenecks

| ID | Area | File(s) | Scale Failure Mode |
|---|---|---|---|
| **SCL-01** | Connection Pool Deadlock in AI & Messaging | `apps/api/src/modules/ai/ai.service.ts`, `menu-retrieval.service.ts`, `gemini.adapter.ts`, `messaging/messaging.service.ts` | `AiService.chat` acquires a DB connection (`withTenantContextRaw`), makes two slow Gemini HTTP calls inside the open transaction, AND calls `MenuRetrievalService.hybridSearch` which calls `withTenantContextRaw` again (checking out a nested 2nd connection from `max: 20` pool). Under >= 10–20 concurrent chat requests, every request blocks waiting for a 2nd connection, permanently deadlocking the API pool! `MessagingService.sendMessage` similarly holds DB transactions open across outbound HTTP calls. Additionally, `GeminiAdapter` sends API keys in query URLs (`?key=...`), and neither controller catches `ZodError` cleanly via domain/validation pipe. |
| **SCL-02** | Multi-Instance Polling Storms & Missing BullMQ Workers | `apps/api/src/modules/orders/outbox-relay.service.ts`, `payments/reconciliation.service.ts`, `analytics/analytics.service.ts` | `OutboxRelayService` and `ReconciliationService` use uncoordinated `setInterval` loops on every API pod without Redis leader lock / BullMQ and without `FOR UPDATE SKIP LOCKED` + batching (`OutboxRelayService` updates rows one-by-one). CSV exports build large datasets synchronously inside HTTP request handlers (`analytics-calc.ts` also allows CSV formula injection `=`, `+`, `-`, `@`). |
| **SCL-03** | Realtime Pub/Sub Fan-Out, Missing Outlet Rooms & Memory Leaks | `apps/api/src/modules/realtime/realtime.service.ts`, `kds.gateway.ts`, `sse.controller.ts` | `PSUBSCRIBE dineflow:orders:*` broadcasts all tenants' events to every pod. `KdsGateway` lacks authenticated per-org/per-outlet rooms and heartbeat/TTL cleanup on in-memory `Map` structures (unbounded heap growth). `SseController` does not handle `reply.hijack()` properly on Fastify / `Last-Event-ID` replay. |
| **SCL-04** | Menu Hot-Path Uncached & Missing Vector Index | `apps/api/src/modules/menu/public-menu.controller.ts`, `orders/orders.service.ts`, migrations | Public menu reads (highest QPS during QR scans) hit Postgres without Redis cache or HTTP `ETag`/`If-None-Match` 304 support. `OrdersService.listOrders` has N+1 item queries. `menu_items.embedding` lacks a pgvector HNSW index. |
| **SCL-05** | Unofficial WhatsApp Adapter (Ban Risk) | `apps/api/src/modules/messaging/evolution.adapter.ts` | Uses unofficial WhatsApp-Web bridge (`EvolutionAdapter`) with a single global `dineflow` instance — banned immediately at multi-tenant volume and forbidden by `AGENTS.md` §2 rule 11 & `ARCH §2 D9`. Must replace with official WhatsApp Cloud API adapter (`whatsapp-cloud.adapter.ts`) + HMAC-SHA256 `X-Hub-Signature-256` webhook verification. |
| **SCL-06** | HTTP Edge, Rate Limiting, Proxy Trust & Raw Body Parsing | `apps/api/src/main.ts`, `config/config.ts` | Missing `@fastify/helmet`, missing `@fastify/rate-limit` (with `trustProxy: true` for LB/Nginx X-Forwarded-For), unguarded webhook raw-body parsing without size limits, and `config.ts` permits unsafe fallback secrets/CORS in production. |

---

### 5. P2 CI/CD, Linting, Load Tests & Tooling Gaps

| ID | Area | File(s) | Gap |
|---|---|---|---|
| **OPS-01** | Dummy Lint & Broken CI Enforcement | `package.json`, `apps/*/package.json`, `.github/workflows/ci.yml` | Workspace `lint` scripts echo `'... lint passed'` instead of running ESLint/TypeScript rules; CI skips actual lint and RLS migration/security gates. |
| **OPS-02** | Stale Load Tests & Frontend Next.js Config | `infra/load-tests/*.js`, `apps/*/next.config.ts` | k6 load tests target mismatched/old routes or miss guest session/QR signatures; `next.config.ts` hardcodes localhost rewrites instead of env-driven URLs + strict CSP headers. |

---

## Part 2 — Phased Remediation Plan (Vertical Slices)

Each slice is self-contained, includes tests written alongside code, and runs `pnpm typecheck && pnpm test` before completion. Changes touching `auth`, `tables`, `payments`, `webhooks`, `orders/pricing`, `orders/state-machine`, `loyalty`, RLS/db helpers, `compliance`, `messaging` consent, and `ai` guardrails are flagged `NEEDS_HUMAN_REVIEW`.

### Slice 1 — P0 Endpoint Lockdown & Security Audit Guardrails (Immediate Stop-Bleeding)
- **Payments Lockdown (`apps/api/src/modules/payments/`):**
  - Remove public availability of `simulate-success` & `simulate-order-success` outside `NODE_ENV === 'test'` (throw 404/403 in all non-test environments, and disable route registration unless test env).
  - Restrict `CustomerPaymentsController`: require verified caller auth (Customer JWT or Guest Table-Session JWT matching order ownership & `org_id`); forbid `CUSTOMER` actors from calling `CASH` / `DIRECT_UPI_STAFF` / `PAY_AT_COUNTER` as settled `PAID` — `CUSTOMER` creating counter/cash requests may only record `PENDING` payment intent awaiting staff confirmation via `ConsolePaymentsController`.
  - Add `CustomerPaymentsController` to `ALL_CONTROLLERS` in `apps/api/src/common/__tests__/security-audit.spec.ts`.
- **Orders & KDS Lockdown (`apps/api/src/modules/orders/`):**
  - Remove `@Public()` `/feed`, `PATCH /:id/status/public`, and `PATCH /:id/items/:itemId/status/public` from `ConsoleOrdersController` (all KDS routes require `@Require(Permission.ORDERS_READ)` / `@Require(Permission.ORDERS_UPDATE_STATUS)` + tenant/outlet isolation).
  - Remove `SELECT id FROM organizations LIMIT 1` fallback in `OrdersService`.
  - Protect `CustomerOrdersController` with verified Guest Session or Customer auth matching `org`, `outlet`, `table`, and `sessionId`/`customerId`.
  - Update `orders.service.spec.ts` to verify locked-down behavior instead of public KDS backdoor.
- **Customer Profiles & Feedback Lockdown (`apps/api/src/modules/auth/`, `feedback/`):**
  - Protect `/v1/customer/auth/profile` and `/v1/customer/auth/diner-profiles*` with `@Require(Permission.CUSTOMER_READ)` / `@Require(Permission.CUSTOMER_UPDATE)` deriving `customerId = user.sub` and `orgId = user.org`; replace untyped delete body with `.strict()` Zod DTO; remove hardcoded `'7762b6af-...'` fallback.
  - Lock down `CustomerFeedbackController.submitFeedbackGuest` / `submitFeedback` with session/customer ownership verification; validate `listReviews` query via `.strict()` Zod DTO; forbid hardcoded encryption key fallback in production (`FeedbackService`).
- **Tests:** Update `security-audit.spec.ts`, `orders.service.spec.ts`, add authz/IDOR tests for payments, orders, customer auth, feedback.

### Slice 2 — Auth, MFA, RBAC, Outlet Scoping & Transactional RLS Enforcement
- **Staff Auth & MFA (`apps/api/src/modules/auth/staff-auth.*`, `token.service.ts`):**
  - `login()` returns a signed short-lived `pre_mfa` token (purpose-scoped JWT) when MFA is required, and enforces MFA for `OWNER` / `MANAGER` roles.
  - `verifyMfa()` requires valid `pre_mfa` token + TOTP code, enforces rate limiting + Redis replay protection (one-time use per 30s step), and decrypts TOTP secrets via AES-256-GCM.
  - Remove default `{ role: 'WAITER', outlet_id: null }` fallback in `_getMembership`; deny login if no active membership exists.
  - Refresh token rotation uses atomic `UPDATE ... WHERE id = $1 AND is_revoked = false RETURNING *` inside `withTenantContextRaw`.
  - Wrap **all** DB calls in `StaffAuthService` and `CustomerOtpService` in `withTenantContextRaw` (fixing autocommit `set_config` bug).
- **Customer OTP (`customer-otp.service.ts`):**
  - Atomic attempt tracking (`FOR UPDATE` / single-statement increment) to eliminate concurrent OTP brute-force race; emit `devCode` strictly when `NODE_ENV === 'development' || NODE_ENV === 'test'`.
- **RBAC & Outlet Isolation (`packages/contracts`, `rbac.guard.ts`):**
  - Align `CAPTAIN` & `WAITER` permissions in `ROLE_PERMISSIONS`; support `GUEST_SESSION` token type cleanly (`RbacGuard` strictly blocks guest-session tokens from staff/console/customer-account endpoints while allowing guest dine-in actions scoped to `tableSessionId`).
  - Enforce `user.outletId` assertion helpers across outlet-scoped controllers/services.
- **Tests:** Comprehensive unit specs for `staff-auth`, `customer-otp`, `rbac.guard` outlet/guest isolation.

### Slice 3 — Tables QR Security, Guest Session JWT & Financial/Pricing/Schema/Privacy Fixes
- **Tables QR & Guest Session (`apps/api/src/modules/tables/`):**
  - Remove raw `table_number`/`id` lookup fallback in `TablesService.openSession` (strictly require HMAC QR signature + active `qr_token_version` + `org_id`/`outlet_id` match).
  - Return a signed `guestSessionToken` (`type: 'guest_session'`, `{ org, outlet, table, sessionId }`) and verify it cleanly on customer order/payment/SSE/feedback calls.
- **Pricing & Orders (`pricing.engine.ts`, `orders.service.ts`):**
  - Fix `INCLUSIVE` tax double-addition in `PricingEngine.computeQuote`; return `DomainError` on max line quantity overflow.
  - In `OrdersService.buildPricingInput`, validate `is_active`, `outlet_id`, `item_availability`, `modifiers.is_available`, and `item_modifier_groups`, and key item notes per line index.
  - Fix `N+1` item queries in `OrdersService.listOrders`.
- **Loyalty, Refunds & PhonePe (`loyalty.*`, `payments.*`):**
  - Fix `CustomerLoyaltyController.validateCoupon` (`dto.outletId` -> resolve `org_id` from `outlets` table, never pass `outletId` as `orgId`).
  - Lock wallet row (`FOR UPDATE`) in `debitWalletForOrder` and keep balance-after/expiration consistency; harden `claimReferral` cap checks & code hashing.
  - Lock payment row (`FOR UPDATE`) and check cumulative refund total in `PaymentsService.createRefund`.
  - Use `crypto.timingSafeEqual` in `PhonePeAdapter` & add split-settlement / sub-merchant config hook on payment provider interface.
- **Schema & Privacy (`menu.service.ts`, `privacy.service.ts`, migrations):**
  - Fix `MenuService._auditLog` column names to match `0001_init.sql` (`audit_logs`).
  - Fix `PrivacyService` SQL queries (`loyalty_ledger`, `orders.status`, `webhook_inbox.received_at`).
  - Add forward-only migration aligning enum values, RLS system-context support for trusted background/webhook lookup, and pgvector HNSW index on `menu_items.embedding`.
- **Tests:** `fast-check` property tests on `INCLUSIVE`/`EXCLUSIVE` tax invariants, modifier availability rejection, wallet/refund concurrency, privacy query tests, tables HMAC rejection tests.

### Slice 4 — Scale Architecture: Pool Deadlock Fix, BullMQ/Coordinator, Realtime Rooms, Caching, WhatsApp Cloud API, Security Headers
- **AI Pool Deadlock & Guardrails (`apps/api/src/modules/ai/`):**
  - Never hold DB connections across Gemini HTTP calls in `AiService.chat`; read context -> release DB connection -> run embedding/Gemini/hybrid search sequentially without nesting `withTenantContextRaw` -> persist audit/usage in short post-call DB write.
  - Move Gemini API key from query string to `x-goog-api-key` header; enforce per-org/per-session Redis rate limit and daily token/cost budget; replace raw `ZodError` in `AiController`/`PrivacyController` with `DomainError` / validation error mapping.
- **Messaging Official Cloud API & Consent (`apps/api/src/modules/messaging/`):**
  - Replace/retire `EvolutionAdapter` usage (violates `AGENTS.md` §2 rule 11) with official Meta WhatsApp Cloud API `WhatsAppCloudAdapter` implementing `MessagingProvider`; verify `X-Hub-Signature-256` raw-body HMAC on `WhatsAppWebhookController`; bind `CustomerConsentController.recordConsent` strictly to authenticated `user.phone` (or verified OTP). Release DB TX before external messaging HTTP calls (`sendMessage` outbox/short-TX pattern).
- **Realtime & Menu Caching (`apps/api/src/modules/realtime/`, `menu/`):**
  - Scope Redis pub/sub channels per org/outlet (stop global `PSUBSCRIBE` fan-out), implement authenticated per-outlet `KdsGateway` rooms, prune idle connection/rate Maps, use proper `reply.hijack()` + `Last-Event-ID` support in `SseController`.
  - Add Redis menu cache with invalidation on menu mutations + HTTP `ETag`/`If-None-Match` 304 support in `PublicMenuController`.
- **Workers, CSV & Edge Hardening (`main.ts`, `config.ts`, `outbox-relay`, `reconciliation`, `analytics`):**
  - Guard `OutboxRelayService` and `ReconciliationService` with Postgres `FOR UPDATE SKIP LOCKED` + batch updates + distributed Redis lock / coordinated scheduler so multi-replica deployments never double-process outbox/reconciliation; fix RLS system-context execution.
  - Fix CSV formula injection in `analytics-calc.ts`.
  - Register `@fastify/helmet`, `@fastify/rate-limit`, `trustProxy: true`, bounded raw-body capture for webhook verification, and fail-fast production secret validation in `config.ts`.
- **Tests:** Run unit + real Postgres/Redis integration tests (`pnpm test:int`) against non-superuser `dineflow_app`.

### Slice 5 — Frontends Real-Auth/Multi-Tenant Refactor, ESLint, CI/CD & Load Tests
- **`apps/console-web`:** Strip client-side hardcoded passwords/PINs/`?role=` bypass and mock TOTP verification; integrate real JWT login + pre-MFA TOTP flow + bearer token propagation and server-verified KDS/console API calls.
- **`apps/customer-web`:** Remove hardcoded Royal Spice Bistro UUIDs/VPA, `/simulate-success` calls, and raw table-number fallback; pass signed QR tokens (`qr`, `sig`, `v`) to `/sessions/open`, persist guest session JWT cleanly, and attach `Authorization: Bearer` headers.
- **Next.js, Lint & CI:** Configure env-driven API URLs and CSP headers in `next.config.ts`; install/configure real ESLint checks across workspace packages (replacing echo stubs); update `.github/workflows/ci.yml` to enforce real lint, typecheck, unit, and RLS integration gates; align `infra/load-tests/*.js` with signed QR/auth flows.
- **Final Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:int`, `pnpm build`.
