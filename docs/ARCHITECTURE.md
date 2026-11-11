# DineFlow — Architecture & Engineering Specification

> Working codename: `dineflow` (rename freely). Status: v1.0 — source of truth for all implementation work.
> Audience: the AI coding agent AND the human founder. If code and this spec disagree, STOP and ask; do not silently diverge.

---

## 0. How to use this document

1. Read `AGENTS.md` first (rules of engagement), then this file, then the phase prompt in `PROMPTS.md`.
2. Items marked **[MUST]** are non-negotiable. **[SHOULD]** are strong defaults. **[LATER]** are explicitly out of the current phase.
3. Numbers marked *(assumption)* are design targets, not facts. Re-validate with real pilots.
4. Anything touching **money, auth, tenant isolation, table sessions, webhooks** is "security-critical" and must be flagged `NEEDS_HUMAN_REVIEW` in the PR/summary.

---

## 1. Product scope and principles

**Product:** multi-tenant SaaS for restaurant dine-in ordering. Guests scan a QR/NFC tag on a table, the menu opens immediately (no login wall), they order, optionally pay, and the kitchen/staff see live tickets. Owners get analytics, loyalty/CRM and reputation tools.

**Surfaces**
- **Customer web app** (PWA) — menu, cart, checkout, order tracking, history, profile, call-waiter, AI assistant.
- **Staff console** — live orders / kitchen display (KDS), table sessions, stock availability, waiter calls, mark-paid.
- **Owner console** — sales overview and history, menu management, coupons/loyalty, feedback & review dashboard, staff & outlet management, settings.
- **Platform admin** (internal, minimal) — tenant onboarding, support, feature flags.

**Principles**
1. **Security and correctness before features.** Money and tenant data bugs end the business.
2. **Modular monolith first.** One deployable API with strict module boundaries; split a module out only when metrics demand it.
3. **Server is the source of truth.** Prices, discounts, taxes, availability, eligibility are computed server-side. Client values are hints.
4. **Every state change is an event.** Orders/payments have explicit state machines and append-only event logs.
5. **Idempotent everything** that creates money or orders.
6. **Compliance by design:** India DPDP Act + Rules, GST invoicing, Google review policy, WhatsApp Business policy.
7. **Boring tech.** Prefer mature, well-documented tools. No unofficial/reverse-engineered APIs.
8. **Provider abstraction** for payments, messaging, AI, storage, SMS — so India and global markets use different providers behind the same interfaces.

---

## 2. Decision log (so the agent doesn't re-litigate)

| # | Decision | Reason |
|---|---|---|
| D1 | TypeScript everywhere (strict) | One language, shared types/contracts, fastest delivery for a small team |
| D2 | NestJS on Node (Fastify adapter) | Enforced module structure, DI, guards; good for AI-assisted codegen |
| D3 | PostgreSQL + Row-Level Security | Tenant isolation enforced in the database, not only in app code |
| D4 | Drizzle ORM + **hand-written SQL migrations** for RLS/policies | ORM can't express RLS; SQL is explicit and reviewable |
| D5 | REST + OpenAPI + Zod (no GraphQL) | Simple, cacheable, contract-first |
| D6 | Redis (managed) from day one | ≥2 API instances for availability need shared rate limits, pub/sub, queues |
| D7 | BullMQ for jobs, transactional **outbox** for events | Reliable delivery without dual-write bugs |
| D8 | SSE for customer updates, WebSocket for staff/KDS | SSE is simpler/proxy-friendly; staff needs bidirectional acks |
| D9 | Official WhatsApp Cloud API via a BSP | Unofficial APIs risk number bans and ToS violations |
| D10 | **No reward may be tied to a public Google review** | Google policy prohibits incentivized reviews |
| D11 | Never hold merchant funds; use gateway split settlement | Avoids payment-aggregator regulatory exposure (confirm with counsel) |
| D12 | Customer identity is **per organization (brand)**, keyed by phone | Limits data-fiduciary scope; supports DPDP |
| D13 | Money = integer minor units (paise) + ISO currency | No floating point, ever |
| D14 | Containers on AWS ECS Fargate; Kubernetes only if justified later | Lower ops burden |
| D15 | Monorepo with pnpm workspaces + Turborepo | Shared packages, single CI |

---

## 3. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js current Active LTS (verify at build time) | Pin in `.nvmrc` and Docker image |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true` | No `any` without a justified `// eslint-disable-next-line` comment |
| API | NestJS + Fastify adapter | Modules, guards, interceptors, pipes |
| Validation | Zod (+ `nestjs-zod`) | Every request/response/env var validated |
| API contract | OpenAPI 3.1 generated from Zod schemas | Published at `/v1/openapi.json` (non-prod only exposes UI) |
| DB | PostgreSQL (managed, e.g. RDS/Aurora), extensions: `pgcrypto`, `citext`, `pg_trgm`, `vector` (pgvector) | Region: ap-south-1 (Mumbai) for India stack |
| ORM / query | Drizzle ORM; raw SQL migrations | Parameterized queries only |
| Cache / queue | Redis (managed) + BullMQ | Rate limits, OTP, codes, pub/sub, jobs |
| Realtime | `ws`/Socket.IO (staff), SSE (customers) | Redis pub/sub fan-out |
| Customer web | Next.js (App Router) + React + Tailwind, PWA via Serwist | Mobile-first, i18n via `next-intl` |
| Consoles | Next.js (App Router) single app `console-web`, role-gated routes | Tablet-first for staff |
| State/data fetching | TanStack Query + generated typed client from OpenAPI | |
| Auth | Own implementation per section 12 (argon2id, JOSE JWT, TOTP via `otplib`) | Alternative: managed IdP later |
| Payments | `PaymentProvider` interface; adapters: Razorpay / Cashfree (India), Stripe Connect (global) | Hosted checkout only (no card data touches us) |
| Messaging | `MessagingProvider`: WhatsApp Cloud API (via BSP), SMS (DLT-registered, India) | |
| Object storage | S3 + CloudFront | Presigned uploads, image processing with `sharp` |
| Video | Managed video service (Cloudflare Stream or Mux) | No self-hosted transcoding |
| Edge | Cloudflare (DNS, WAF, bot management, Turnstile) in front of CloudFront/ALB | |
| IaC | Terraform | Separate state per env |
| CI/CD | GitHub Actions → ECR → ECS (blue/green) | |
| Observability | OpenTelemetry, pino (JSON logs), Sentry, Grafana/CloudWatch | |
| Testing | Vitest, Testcontainers, Supertest, Playwright, k6 | |
| Lint/format | ESLint (typescript-eslint strict + security plugins), Prettier | |

---

## 4. Repository structure

```
dineflow/
├─ AGENTS.md
├─ docs/
│  ├─ ARCHITECTURE.md            # this file
│  ├─ PROMPTS.md
│  ├─ adr/                       # architecture decision records (one file per change to a D-item)
│  ├─ runbooks/                  # incident, breach (72h), restore drill, key rotation
│  └─ threat-model.md
├─ apps/
│  ├─ api/                       # NestJS modular monolith
│  │  └─ src/
│  │     ├─ main.ts
│  │     ├─ app.module.ts
│  │     ├─ common/              # guards, interceptors, filters, pipes, decorators, request-context
│  │     ├─ config/              # zod-validated env
│  │     ├─ db/                  # drizzle client, tx helper (sets app.org_id), migrations runner
│  │     └─ modules/
│  │        ├─ tenancy/          # organizations, outlets
│  │        ├─ identity/         # customers, staff users, memberships
│  │        ├─ auth/             # otp, sessions, tokens, mfa, rbac
│  │        ├─ menu/             # categories, items, modifiers, media, availability/stock
│  │        ├─ tables/           # tables, QR tokens, table sessions, verification
│  │        ├─ orders/           # cart pricing, orders, state machine, events
│  │        ├─ payments/         # provider adapters, webhooks, reconciliation, refunds
│  │        ├─ invoicing/        # GST invoices, numbering
│  │        ├─ loyalty/          # ledger, coupons, referrals, gift/store credit
│  │        ├─ feedback/         # ratings, review dashboard, Google Business Profile
│  │        ├─ messaging/        # whatsapp/sms providers, templates, consent
│  │        ├─ ai/               # chatbot, RAG, guardrails
│  │        ├─ analytics/        # owner reports, aggregates
│  │        ├─ realtime/         # SSE + WS gateways
│  │        ├─ jobs/             # BullMQ processors, outbox relay, schedulers
│  │        ├─ compliance/       # consent log, export, deletion, retention
│  │        └─ admin/            # platform admin endpoints
│  ├─ customer-web/              # Next.js PWA
│  └─ console-web/               # Next.js staff + owner (+ admin) consoles
├─ packages/
│  ├─ contracts/                 # Zod schemas, enums, error codes, shared types (single source)
│  ├─ api-client/                # generated typed client from OpenAPI
│  ├─ ui/                        # shared React components
│  └─ config/                    # tsconfig, eslint, prettier presets
├─ infra/
│  ├─ terraform/                 # modules: network, rds, redis, ecs, s3-cdn, waf, secrets, observability
│  └─ docker/                    # Dockerfiles, docker-compose.dev.yml
└─ .github/workflows/
```

**Module boundary rule [MUST]:** a module may import only another module's *public service interface* (`modules/x/index.ts`). No cross-module table access; use the owning module's service. Enforce with `eslint-plugin-boundaries` or `dependency-cruiser` in CI.

---

## 5. Environments and local development

- **local:** `docker compose` → Postgres, Redis, MinIO (S3), Mailpit, a fake payment/WhatsApp provider (in-repo mocks implementing the same interfaces). One command: `pnpm dev`.
- **staging:** production-like, separate AWS account/project, test-mode payment keys, sandbox WhatsApp.
- **production:** separate account, WAF on, deletion protection on DB, MFA-protected cloud access only.
- Config via environment variables, **validated with Zod at boot**; the process must crash on invalid config. Secrets from AWS Secrets Manager (prod/staging), `.env.local` (gitignored) for local only.
- Feature flags: table `feature_flags(org_id nullable, key, enabled)`; evaluated server-side.

---

## 6. Multi-tenancy and Row-Level Security

**Hierarchy:** `organization` (brand/owner account) → `outlet` (physical location) → `table`.

**Rules [MUST]**
1. Every tenant-owned table has `org_id uuid NOT NULL` (and `outlet_id` where relevant), indexed, and is part of composite unique/foreign keys where applicable.
2. RLS is **enabled and forced** on every tenant-owned table:
   ```sql
   ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
   ALTER TABLE orders FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON orders
     USING (org_id = current_setting('app.org_id', true)::uuid)
     WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
   ```
3. The application connects as a **non-superuser role without `BYPASSRLS`**. Migrations run under a separate privileged role used only in CI/deploy.
4. Every request runs inside a DB transaction helper that executes `SELECT set_config('app.org_id', $1, true)` (transaction-local) before any query. If no org context exists, queries must return zero rows (`current_setting(..., true)` returns NULL → policy fails closed).
5. Cross-tenant operations (platform admin, background jobs) use an explicit, audited `withSystemContext()` that uses a dedicated role/policy, never a blanket bypass.
6. Customer-owned reads (order history) additionally filter by `customer_id` in the query layer; for extra depth, add policy using `app.customer_id` on customer-facing tables.
7. **CI test [MUST]:** an automated test creates two orgs with data and asserts that every tenant table returns zero rows across tenants for SELECT/UPDATE/DELETE and rejects cross-tenant INSERT. The test enumerates tables from `pg_catalog` so new tables without RLS fail the build.

---

## 7. Data model (logical)

Conventions: `id uuid` (UUIDv7 preferred, time-ordered), `created_at/updated_at timestamptz`, soft-delete via `deleted_at` where history matters, all money `bigint` minor units + `currency char(3)`, enums as Postgres enums or check constraints, all timestamps UTC.

**Tenancy & identity**
- `organizations(id, name, legal_name, gstin?, country, default_currency, default_locale, status, settings jsonb)`
- `outlets(id, org_id, name, address, geo, timezone, gstin?, tax_config jsonb, verification_mode enum[PAY_FIRST|VERIFIED_PAY_LATER|HYBRID], payment_modes jsonb, status)`
- `staff_users(id, email citext unique, password_hash, mfa_secret_enc?, mfa_enabled, status)`
- `memberships(id, user_id, org_id, outlet_id?, role enum[OWNER|MANAGER|CAPTAIN|KITCHEN|CASHIER])`
- `customers(id, org_id, phone_e164, phone_verified_at, name?, email?, marketing_consent_at?, referred_by_customer_id?, created_at)` **UNIQUE(org_id, phone_e164)**
- `customer_identities(id, org_id, customer_id, provider enum[GOOGLE|EMAIL|APPLE], subject, email, verified_at)` — secondary login methods, always linked to a phone-verified customer
- `devices(id, org_id, customer_id?, device_hash, first_seen, last_seen, risk_flags)` — hashed fingerprint for abuse detection only

**Menu**
- `menu_categories(id, org_id, outlet_id, name_i18n jsonb, sort, active)`
- `menu_items(id, org_id, outlet_id, category_id, name_i18n, description_i18n, base_price, tax_class, veg_type enum[VEG|NON_VEG|EGG|VEGAN], allergens text[], spice_level?, prep_time_min?, active, sort, search_vector, embedding vector?)`
- `item_media(id, org_id, item_id, kind enum[IMAGE|VIDEO], storage_key|stream_uid, alt_i18n, sort)`
- `modifier_groups(id, org_id, item_id, name_i18n, min_select, max_select, required)` / `modifiers(id, org_id, group_id, name_i18n, price_delta, active)`
- `item_availability(item_id, outlet_id, status enum[AVAILABLE|OUT_OF_STOCK|HIDDEN], stock_count?, updated_by, updated_at)` — staff dashboard writes here
- `menu_versions(outlet_id, version bigint, updated_at)` — bump on any menu/availability change (cache key)

**Tables & sessions**
- `tables(id, org_id, outlet_id, label, capacity?, qr_token_version int, active)`
- `table_sessions(id, org_id, outlet_id, table_id, status enum[OPEN|CLOSED|EXPIRED], opened_by enum[STAFF|CODE|APPROVAL], opened_by_user_id?, opened_at, closed_at?, expires_at)`
- `table_session_guests(id, session_id, guest_token_hash, customer_id?, device_id?, joined_at)`
- `waiter_calls(id, org_id, outlet_id, table_session_id, reason, status enum[OPEN|ACKED|RESOLVED], created_at, acked_by?)`

**Orders**
- `orders(id, org_id, outlet_id, table_session_id, customer_id?, guest_id?, order_no (per outlet per day), status, payment_status, verification enum[SESSION|STAFF_APPROVED|PREPAID], subtotal, discount_total, tax_total, tip, grand_total, currency, notes, idempotency_key, placed_at, ...)` **UNIQUE(org_id, idempotency_key)**
- `order_items(id, org_id, order_id, item_id, name_snapshot, unit_price_snapshot, qty, tax_rate_snapshot, modifiers_snapshot jsonb, line_total, status enum[QUEUED|PREPARING|READY|SERVED|VOID], note)` — **snapshot all names/prices** so later menu edits never alter history
- `order_events(id, org_id, order_id, type, from_status, to_status, actor_type enum[CUSTOMER|STAFF|SYSTEM], actor_id, payload jsonb, created_at)` — append-only

**Payments & invoices**
- `payments(id, org_id, order_id, provider, provider_order_id, provider_payment_id?, method enum[UPI|CARD|NETBANKING|WALLET|CASH|DIRECT_UPI_STAFF], amount, currency, status enum[CREATED|PENDING|PAID|FAILED|REFUNDED|PARTIALLY_REFUNDED], fee_amount?, settled_at?, raw jsonb)`
- `webhook_inbox(id, provider, event_id, signature_valid, payload jsonb, received_at, processed_at?, status)` **UNIQUE(provider, event_id)**
- `refunds(id, org_id, payment_id, amount, reason, status, provider_refund_id, initiated_by)`
- `invoices(id, org_id, outlet_id, order_id, invoice_no, fiscal_year, issued_at, buyer_gstin?, tax_breakup jsonb, total)` **UNIQUE(outlet_id, fiscal_year, invoice_no)**, gapless per outlet/FY (use a locked counter row)

**Loyalty & promotions**
- `coupons(id, org_id, code citext, type enum[PERCENT|FLAT], value, max_discount, min_order, audience enum[ALL|SIGNED_IN|NEW|RETURNING], valid_from, valid_to, usage_limit_total, usage_limit_per_customer, stackable, outlets uuid[])` **UNIQUE(org_id, code)**
- `coupon_redemptions(id, org_id, coupon_id, customer_id?, order_id, amount, created_at)` **UNIQUE(coupon_id, order_id)**
- `loyalty_ledger(id, org_id, customer_id, entry_type enum[EARN|REDEEM|EXPIRE|ADJUST|REVERSAL], amount (signed), reason, ref_type, ref_id, expires_at?, created_at)` — **append-only; balance = SUM**; unique `(ref_type, ref_id, entry_type)` prevents double credit
- `referrals(id, org_id, referrer_customer_id, referee_customer_id UNIQUE, status enum[PENDING|QUALIFIED|REWARDED|REJECTED], qualified_order_id?, fraud_signals jsonb)`
- `gift_cards` (store-credit) — **[LATER]**; see section 18 for legal flag

**Feedback & reputation**
- `feedback(id, org_id, outlet_id, order_id UNIQUE, customer_id?, rating smallint 1-5, tags text[], comment, created_at)`
- `gbp_connections(id, org_id, outlet_id, google_account_ref, location_ref, refresh_token_enc, status)`
- `review_snapshots(id, org_id, outlet_id, review_ref, star_rating, comment, reviewer_display_name?, create_time, update_time, reply_text?)` — **no link to customers**

**Platform**
- `outbox_events(id, aggregate_type, aggregate_id, type, payload, created_at, published_at?)`
- `idempotency_keys(key, org_id, scope, request_hash, response jsonb, created_at, expires_at)`
- `message_log(id, org_id, customer_id?, channel, template, category, provider_msg_id, status, cost_minor?, created_at)`
- `consents(id, org_id, customer_id, purpose enum[ORDERING|LOYALTY|MARKETING_WHATSAPP|ANALYTICS], granted bool, notice_version, source, ip_hash, created_at)` — append-only
- `data_requests(id, org_id, customer_id, type enum[EXPORT|ERASURE|CORRECTION], status, requested_at, completed_at)`
- `audit_logs(id, org_id, actor_type, actor_id, action, entity_type, entity_id, before jsonb, after jsonb, ip, user_agent, created_at)` — append-only, no UPDATE/DELETE grants
- `feature_flags(...)`

**Index guidance [MUST]:** index all FKs; `(org_id, outlet_id, status, created_at desc)` on orders; partial index for open orders `WHERE status IN (...)`; `(org_id, customer_id, created_at desc)` for history; GIN on search vectors; HNSW/IVFFlat on embeddings. Review every query with `EXPLAIN` on realistic data volume before merging hot paths.

---

## 8. Domain state machines

Implement as explicit transition tables in code with a single `transition(order, event, actor)` function that (a) validates, (b) writes `order_events`, (c) writes outbox, all in one transaction. Illegal transitions throw `409`. Unit-test every allowed and every forbidden transition.

**Order status**
```
PENDING_APPROVAL ──approve──▶ ACCEPTED ──start──▶ PREPARING ──ready──▶ READY ──serve──▶ SERVED ──complete──▶ COMPLETED
PENDING_APPROVAL ──reject──▶ REJECTED
PENDING_PAYMENT  ──paid────▶ ACCEPTED        (pay-first orders; auto after verified payment)
PENDING_PAYMENT  ──expire──▶ CANCELLED
ACCEPTED|PREPARING ──cancel(staff)──▶ CANCELLED   (with refund flow if paid)
```
**Payment status** (separate field): `UNPAID → PENDING → PAID | FAILED`; `PAID → PARTIALLY_REFUNDED | REFUNDED`.
**Table session:** `OPEN → CLOSED` (all orders paid/settled or staff closes) or `EXPIRED` (inactivity TTL, e.g. 3h *(assumption)*).
**Item lines** can be voided by staff before `READY` (audited, adjusts totals and invoice).

---

## 9. Table QR, sessions and order verification

**QR content:** `https://{customer-domain}/t/{token}` where `token = base64url(payload).base64url(sig)`; payload = `{ v, org, outlet, table, tv }` (`tv` = table token version). `sig` = HMAC-SHA256 (or Ed25519) with a rotating key set (`kid` in payload). No secrets in URL beyond the signature. Printing a new QR or compromise → bump `tables.qr_token_version`, old tags die.

**Flow**
1. Guest scans → `POST /v1/public/table-sessions/resolve {token}` → server verifies signature, `tv`, table active, outlet open. Returns outlet public info + current session state (`NONE | OPEN`) and a short-lived **guest session JWT** (bound to table, not to a person).
2. **Verification modes (per outlet):**
   - `VERIFIED_PAY_LATER`: ordering requires an `OPEN` table session. Session is opened by **(a)** staff tap ("Seat table"), or **(b)** guest enters the **table code** shown on the table tent (4–6 digits, rotates when a session closes and at most every N minutes *(assumption: 30)*), or **(c)** first order goes to `PENDING_APPROVAL` and staff approve with one tap.
   - `PAY_FIRST`: any guest can order; order stays `PENDING_PAYMENT` until payment confirmed by verified webhook/reconciliation.
   - `HYBRID` (default): risk engine decides per order (below).
3. **Code brute-force defense [MUST]:** max 5 wrong attempts per guest session and per IP per 15 min; exponential lockout; code compared in constant time; code stored in Redis with TTL.
4. **Risk engine** (pure function, unit-tested, in `orders/risk`): inputs = session verified?, customer verified?, order total, order type (dine-in/takeaway), customer history (completed orders, prior unpaid/cancelled), device flags, time of day, outlet config. Output ∈ `{PAY_FIRST, PAY_LATER, STAFF_APPROVAL}` + reasons (logged). Defaults: unknown guest + no verified session → `STAFF_APPROVAL` or `PAY_FIRST`; verified returning customer + verified session + under threshold → `PAY_LATER`.
5. **Abuse controls [MUST]:** per-session order rate limit (e.g. 1 pending order unless prior accepted), max items/qty caps, per-IP and per-device limits, optional Turnstile on first order for unverified guests, alert owner on anomalies (orders from table with no staff-opened session).
6. Staff console shows a banner for unverified orders; one-tap approve/reject with reason.
7. **Geolocation is NOT a trust signal** (unreliable indoors). May be recorded as a soft risk input only with consent.

---

## 10. Pricing, discounts, tax and money

- All pricing happens in `orders/pricing` (pure functions, 100% unit + property-tested): inputs = cart lines (item_id, qty, modifier ids), outlet tax config, coupon/loyalty selection, tip → output = full breakup. The client never sends prices.
- Steps: validate availability → line price (base + modifier deltas) → apply coupon (per eligibility rules and caps) → apply loyalty redemption (cap % of bill) → compute tax per line (inclusive or exclusive per outlet config) → rounding rule (configurable, default round-half-up on the invoice total, rounding adjustment line shown) → tip → grand total.
- Tax config is data (`tax_config`): rate per `tax_class`, inclusive flag, registration details. GST rates and applicable rules change — **do not hardcode**; confirm with the owner's CA. Invoice shows GSTIN, invoice no., tax breakup.
- Order totals must be re-computed server-side at placement AND when payment is created; reject if the client-displayed total differs (return `409 PRICE_CHANGED` with new quote).
- Property tests: total == sum of parts; discounts never exceed caps; totals never negative; rounding invariant.

---

## 11. Payments

**Interface**
```ts
interface PaymentProvider {
  createPayment(input: { orderId; amount; currency; customer?; returnUrl; metadata }): Promise<{ providerOrderId; checkoutPayload }>;
  verifyWebhook(rawBody: Buffer, headers: Headers): { valid: boolean; eventId: string; event: NormalizedEvent };
  fetchPayment(providerRef: string): Promise<NormalizedPayment>;
  refund(input: { paymentId; amount; reason; idempotencyKey }): Promise<NormalizedRefund>;
}
```
**Modes (per outlet)**
1. **Gateway checkout** (UPI intent/QR, cards, netbanking) using hosted checkout; **never collect/store card data** (SAQ-A scope).
2. **Direct UPI to restaurant (staff-confirmed):** show restaurant VPA deep link/QR with an order reference; the order stays `payment_status=PENDING` until staff presses "Mark paid" (audited, reason, amount). No automatic verification → risk accepted by the owner; show in reports as `DIRECT_UPI_STAFF`.
3. **Pay at counter** (cash/card terminal): staff records tender, audited.

**Rules [MUST]**
- **Split settlement:** use the gateway's marketplace/route/split feature with the restaurant as a linked account so funds settle directly to them; the platform fee is deducted by the gateway or invoiced separately. Do not pool merchant money in the platform's own account. *(Confirm structure with a fintech lawyer before launch.)*
- **Webhooks:** receive raw body, verify signature, insert into `webhook_inbox` with `UNIQUE(provider,event_id)`, return 200 fast, process async idempotently. Never trust browser redirects for payment success.
- **Reconciliation job:** every N minutes fetch status for `PENDING` payments older than X and settle them; daily settlement report vs provider.
- **Idempotency** on create-payment and refund. **Amount check:** webhook amount/currency must equal order grand_total or flag as `MISMATCH` (no auto-accept).
- Fees: record provider fee when available; owner reports show gross, fees, net. Display note: UPI MDR rules changed in Oct 2026 (0.4% on eligible merchant payments above ₹2,000, capped) — **make fee models data-driven**, not hardcoded.
- Refunds: partial/full, owner/manager permission, reason mandatory, audit logged, reverses loyalty earn and coupon usage accordingly.

---

## 12. Authentication, authorization and sessions

**Customers (phone-first)**
- Guest ordering allowed without account (subject to risk rules). Sign-in/up is optional; the prompt appears at checkout and from the profile page.
- **OTP:** `POST /v1/auth/otp/request {phone}` → 6-digit code via WhatsApp *authentication* template (primary) or SMS fallback. Store `hash(code)` (HMAC with pepper) with TTL 5 min, max 5 verify attempts, resend cooldown 30 s, per-phone 5/hour, per-IP and per-subnet limits, **Turnstile** required after threshold, **daily cost budget cap** per org (OTP pumping defense; alert on spikes), E.164 normalization, block premium-rate/high-risk prefixes by config.
- On verify: find/create `customers(org_id, phone_e164)`; issue **access token** (JWT, 15 min, in memory) + **refresh token** (opaque, 30 days, stored hashed, rotation on use with reuse detection → revoke family; delivered as `HttpOnly; Secure; SameSite=Lax` cookie).
- Email/Google/other providers are **linking methods only** after phone verification (phone remains unique identity).
- Referral code field is accepted only at first sign-up/first order.

**Staff/owner**
- Email + password (**argon2id**, tuned params, breach-password check), **mandatory TOTP MFA for OWNER/MANAGER**, recommended for others; staff on shared tablets use outlet-registered devices + PIN with short idle lock.
- Login throttling per account and IP; generic error messages; session list and remote revoke; password reset via single-use hashed token (15 min).

**Authorization [MUST]**
- RBAC via a central permission map `role → permissions[]`; every controller method declares `@Require('orders:approve')` etc. A global guard denies by default when a handler has no declared permission. An automated test enumerates all routes and fails if any lacks a permission or an explicit `@Public()`.
- Object-level checks: resource must belong to the caller's org/outlet (RLS + explicit check). Customer endpoints verify `customer_id == token.sub`.
- Permission matrix (initial):

| Permission | OWNER | MANAGER | CAPTAIN | KITCHEN | CASHIER |
|---|---|---|---|---|---|
| menu:write | ✔ | ✔ | | | |
| stock:update | ✔ | ✔ | ✔ | ✔ | |
| orders:view | ✔ | ✔ | ✔ | ✔ | ✔ |
| orders:approve / table:open | ✔ | ✔ | ✔ | | ✔ |
| orders:status | ✔ | ✔ | ✔ | ✔ | |
| payments:mark_paid | ✔ | ✔ | | | ✔ |
| refunds:create | ✔ | ✔ | | | |
| analytics:view | ✔ | ✔ | | | |
| coupons:write | ✔ | ✔ | | | |
| staff:manage / settings:write | ✔ | | | | |
| audit:view | ✔ | | | | |

---

## 13. API design

- Base `/v1`; JSON; **RFC 7807 `application/problem+json`** errors with stable `code` values defined in `packages/contracts`.
- Cursor pagination (`limit`, `cursor`); filters via explicit query params, validated.
- **`Idempotency-Key` header required** on: place order, create payment, refund, redeem coupon, referral credit.
- Rate limiting via Redis token bucket, keyed by IP + subject + route class; return `429` with `Retry-After`.
- Request size limits; reject unknown fields (`.strict()`); consistent `request-id` header; CORS allowlist; no wildcard.
- OpenAPI generated from Zod; `packages/api-client` regenerated in CI; breaking changes require `/v2` or additive evolution.

**Endpoint catalogue (initial)**

*Public/guest*
- `GET /v1/public/outlets/{outletSlug}/menu` (ETag, `Cache-Control: public, max-age=30, stale-while-revalidate=300`; keyed by `menu_version`)
- `POST /v1/public/table-sessions/resolve`, `POST /v1/public/table-sessions/{id}/code`
- `POST /v1/public/orders/quote`, `POST /v1/public/orders` (idempotent)
- `GET /v1/public/orders/{id}` + `GET /v1/public/orders/{id}/events` (SSE)
- `POST /v1/public/waiter-calls`
- `POST /v1/public/ai/chat` (rate-limited, session-scoped)

*Customer (authenticated)*
- `POST /v1/auth/otp/request|verify`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `POST /v1/auth/link/{provider}`
- `GET /v1/me`, `PATCH /v1/me`, `GET /v1/me/orders`, `GET /v1/me/wallet`, `GET /v1/me/coupons`
- `POST /v1/me/feedback`, `POST /v1/me/consents`, `POST /v1/me/data-requests`
- `POST /v1/orders/{id}/tip` (post-order tip)

*Staff/Owner console*
- `GET /v1/console/orders?status=…`, `POST /v1/console/orders/{id}/transition`, `POST /v1/console/orders/{id}/mark-paid`, `POST /v1/console/orders/{id}/void-item`
- `POST /v1/console/tables/{id}/open-session`, `POST /v1/console/table-sessions/{id}/close`, `GET /v1/console/waiter-calls`
- `PUT /v1/console/stock/{itemId}`, menu CRUD under `/v1/console/menu/*`, media presign `POST /v1/console/media/presign`
- `GET /v1/console/analytics/*` (sales, items, hours, customers, payment mix, fees)
- `CRUD /v1/console/coupons`, `/staff`, `/outlets`, `/tables` (+ QR export PDF)
- `GET /v1/console/feedback`, `GET /v1/console/reviews`, `POST /v1/console/reviews/{id}/reply`
- `GET /v1/console/audit-logs`

*Webhooks (signature-verified, no auth)*
- `POST /v1/webhooks/payments/{provider}`, `/webhooks/whatsapp`, `/webhooks/google-pubsub`

*Health:* `GET /healthz` (liveness), `GET /readyz` (DB+Redis).

---

## 14. Realtime

- **Staff/KDS:** WebSocket namespace per outlet; authenticated at handshake (JWT) and authorized by outlet membership; room = `org:{id}:outlet:{id}`. Events: `order.created|updated`, `waiter.called`, `table.session.updated`, `stock.updated`. Client acks critical events (new order sound until acked).
- **Customer:** SSE `GET /v1/public/orders/{id}/events` scoped by guest/customer token; heartbeat every 15–25 s; supports `Last-Event-ID` to resume.
- **Delivery guarantees:** events originate from the **outbox** (written in the same DB transaction as the state change), relayed to Redis pub/sub by a worker. Clients must be able to **resync via REST** (`since` cursor) after reconnect; never rely on realtime alone.
- Cap connections per IP/account; backpressure and per-connection queue limits.
- **Fallback:** if realtime fails, consoles poll every 5–10 s and show a "degraded" indicator.

---

## 15. Background jobs and outbox

- **Outbox relay** (poll `outbox_events WHERE published_at IS NULL` with `FOR UPDATE SKIP LOCKED`) → publishes to Redis/BullMQ. At-least-once; consumers idempotent.
- **Queues:** `notifications` (WhatsApp/SMS), `payments-reconcile`, `invoices`, `analytics-rollups`, `loyalty-expiry`, `ai-embeddings`, `gbp-sync`, `data-requests`, `retention`.
- Retries with exponential backoff + jitter; dead-letter queue with alert; every job has a timeout; payload contains IDs, not PII.
- Schedulers (cron-like via BullMQ repeatable jobs): session expiry, pending-payment expiry, daily rollups, retention purge, GBP polling fallback.

---

## 16. Customer web app (PWA)

- **No-login menu:** `/t/{token}` resolves then redirects to `/m/{outletSlug}?s=…`; menu renders from cached/ETag'd data; skeleton UI; target **LCP < 2.0 s on mid-range Android over 4G** *(assumption)*.
- Menu UX: sticky category nav, search, veg/non-veg filters, allergen tags, item sheet with image carousel + optional video (poster first, lazy-load HLS), modifiers, notes. Images: AVIF/WebP, responsive `srcset`, CDN-cached.
- Cart persisted locally (versioned); revalidated on each quote; handles price/availability changes gracefully.
- Checkout: quote → shows verification path chosen by server → payment options allowed by outlet config → place order. Sign-in/up offered but optional; coupon box for guests only; coupons/wallet/gift cards list for signed-in only; "Referred by" only on first signup/first order.
- Order tracking page with SSE; call-waiter button (rate-limited); post-meal feedback + tip prompts shown in order history for signed-in orders.
- Profile page: sign in/up, linked methods, consents, data export/delete requests.
- PWA: service worker caches app shell and last menu (stale-while-revalidate); offline banner; never cache authenticated API responses beyond session.
- i18n: `en`, `hi`, plus configurable regional languages; menu fields are `*_i18n`; RTL-ready layout.
- Accessibility: WCAG 2.1 AA, touch targets ≥ 44 px, reduced-motion support.
- Security: strict CSP (nonce-based), no inline event handlers, `Referrer-Policy`, `Permissions-Policy`, no third-party scripts except Turnstile and analytics-lite (consent-gated).

---

## 17. Staff and owner consoles

**Staff:** tablet-first live board (columns: New/Approval, Preparing, Ready, Served) with sound/vibration alerts, table map with session states, waiter calls queue, stock toggle (AVAILABLE/OUT_OF_STOCK, optional count), mark paid, void item, print KOT/bill (browser print stylesheet first; **[LATER]** local print bridge for ESC/POS thermal printers).
**Owner:** overview (today vs last week, revenue, orders, AOV, tips, discounts, refunds), sales history with filters/export (CSV/XLSX), top/bottom items, hourly heatmap, payment mix & fees, customer cohort (new vs returning, repeat rate), feedback & ratings trend, review feed, coupon performance, staff activity & audit log, outlet and table management with printable QR sheets.
- Analytics read from rollup tables updated by jobs (not heavy live aggregates); allow near-real-time "today" via lightweight queries on indexed partial data.
- Exports are async jobs with signed, expiring download links; PII columns require `analytics:view` + audit entry.
- **Detailed UI/UX specifications:** See [docs/STAFF_AND_OWNER_PLANS.md](file:///Users/jeevanriship/Resturant%20Dine-in%20Ordering%20System/docs/STAFF_AND_OWNER_PLANS.md) for full screen-by-screen specifications for the Staff Web App and Owner Web App.


---

## 18. Loyalty, coupons, referrals, store credit

- **Coupons:** evaluated only by the server (`loyalty/coupons`), atomic redemption with unique `(coupon_id, order_id)`; guests may use "enter coupon code" only; signed-in customers see eligible coupons/cards. Enforce min order, max discount, validity, per-customer and global limits, outlet scope, stacking rules.
- **Wallet/credit:** implement as **non-cashable store credit / loyalty points** in the append-only ledger with expiry. Redemption cap % per bill configurable. Reversal entries on refund.
- **Referral (example offers from founder):** *Existing customer → 10% up to ₹500 to wallet; new customer → 10% up to ₹100 instant discount.* Make all values **configurable per org**.
  - Reward the referrer **only after** the referee's first order is **PAID and COMPLETED** (not at signup).
  - Fraud controls: unique referee; block self-referral (same phone/device/payment instrument hash); per-referrer monthly cap; velocity checks; manual review queue; `fraud_signals` stored.
- **Legal flag:** cash-loaded gift cards/wallets may fall under RBI prepaid-instrument rules; keep v1 to promotional store credit/points with no cash-out, and obtain legal/CA advice before any paid gift card. Also confirm GST treatment of discounts/vouchers with a CA.
- **Review rewards: FORBIDDEN.** No code path may grant any reward conditional on a public Google review (see section 19).

---

## 19. Feedback and Google review handling

- After an order completes (signed-in or phone-linked), prompt **private feedback** (1–5 + tags + comment). **Reward the act of giving feedback** (points) **regardless of rating**, with caps and one reward per order.
- Show the Google review link to **all** customers equally after feedback (no gating by rating, no reward attached, copy must not imply a reward).
- Rating ≤ 3 → immediate owner/manager alert (WhatsApp/console) with order context, so service recovery happens privately.
- **Google Business Profile integration (owner-initiated OAuth):** poll/subscribe for reviews (Pub/Sub notifications where available, polling as fallback), store `review_snapshots`, show rating trend and reply tools. Reviewer display name may be absent/anonymous; **never attempt to match reviewers to customers or orders.**
- Add an automated test/lint rule that fails the build if any ledger/coupon creation references a review entity.
- WhatsApp request for review (if none given) is a neutral reminder under **utility/marketing template rules with consent**, no incentive wording.

---

## 20. WhatsApp and SMS messaging

- `MessagingProvider` interface; implementation: **WhatsApp Cloud API through a BSP** (official). **No unofficial/Web-based libraries.**
- Template registry in code + DB: category (UTILITY/AUTHENTICATION/MARKETING), language variants, approved status; the sender picks the template, never free text outside the 24-h service window.
- **Consent:** transactional messages tied to ordering; marketing requires explicit opt-in recorded in `consents`; honor STOP/unsubscribe immediately; quiet hours; per-customer frequency caps.
- Cost control: log `cost_minor` per message; per-org budgets and alerts; prefer utility templates for receipts/order status; ration marketing.
- Webhooks for delivery status; retry/backoff; fallback to SMS only for OTP/critical.
- Message content must avoid sensitive data; links are signed and short-lived where they expose orders.

---

## 21. AI assistant (menu chatbot)

- Scope: answer questions about **this outlet's menu** (ingredients as recorded, veg/non-veg, spice, allergens as recorded, recommendations, pairings, language help) and suggest items. It can propose cart additions that the **user confirms in the UI**; it never places orders or touches payments.
- **Grounding:** retrieval over the outlet's menu via pgvector + keyword search; the prompt contains only retrieved items + outlet rules. If the data doesn't contain the answer, say so and offer to call staff. Never invent ingredients.
- **Allergy safety:** always include "ask staff to confirm allergens" and never claim an item is "safe" for an allergy.
- **Prompt-injection defense:** treat user text and menu text as untrusted; system rules fixed server-side; tool calls restricted to read-only functions (`search_menu`, `get_item`); output filtered; ignore instructions to reveal prompts or change role.
- Limits: per-session message and token budgets, per-org daily budget, max input length, response caching for common questions, timeouts, graceful degradation if the AI provider is down.
- Privacy: no phone numbers/emails in prompts; log redacted transcripts with short retention; provider adapter allows swapping model vendors.
- Evaluation: a fixed test set (allergen questions, injection attempts, off-topic) run in CI against the prompt/retrieval pipeline with pass/fail thresholds.

---

## 22. Security specification

**Targets:** OWASP ASVS Level 2 for the API and consoles; OWASP Top 10 and API Security Top 10 mapped in `docs/threat-model.md`.

**Application**
- Parameterized queries only; no string-built SQL. Strict Zod on every boundary. Output encoding by React; no `dangerouslySetInnerHTML` without sanitizer.
- Headers: HSTS (preload when ready), CSP (nonce), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`; cookies `HttpOnly; Secure; SameSite`.
- CSRF: access token in `Authorization` header (not cookie); refresh endpoint protected by SameSite + custom header + origin check.
- SSRF: the server never fetches user-supplied URLs; outbound allowlist for providers.
- File upload: presigned S3 PUT with enforced content-type/size, then async validation, `sharp` re-encode, EXIF strip, random keys, separate bucket, no public listing, CDN serves processed outputs only.
- Rate limits and bot controls on OTP, login, order placement, coupon, AI endpoints.
- **Server-side authorization on every object** (BOLA/IDOR defense) — tested.
- Secrets: Secrets Manager + KMS; rotate on schedule; never log secrets/OTPs/tokens; pino redaction paths configured centrally; pre-commit and CI secret scanning (gitleaks).
- Crypto: use platform libraries; AES-256-GCM via KMS envelope for sensitive fields (`mfa_secret`, `refresh_token_enc`); constant-time comparisons for codes/signatures.

**Supply chain**
- `pnpm install --frozen-lockfile`; lockfile committed; pin versions; `onlyBuiltDependencies` allowlist (block arbitrary install scripts); Renovate/Dependabot with review; `pnpm audit` + OSV scan in CI; avoid new dependencies unless justified in the PR; SBOM generation; container scan (Trivy); base images pinned by digest.
- **Do not add packages suggested by hallucination:** verify every new package exists, is maintained, and has reasonable adoption before adding.

**Infrastructure**
- Private subnets for DB/Redis, security groups least-privilege, no public DB, TLS everywhere, IAM least privilege with per-service roles, CloudTrail, GuardDuty, WAF managed rules + rate rules, Cloudflare in front, deletion protection, encrypted storage and backups, MFA on all human cloud access, break-glass procedure documented.
- Backups: automated + PITR (target RPO ≤ 5 min, RTO ≤ 1 h *(assumption)*); **quarterly restore drill** recorded in `docs/runbooks`.

**Detection & response**
- Audit log for all privileged actions; alerts on: failed-login spikes, OTP cost spikes, webhook signature failures, RLS violations, unusual refund volume, impossible state transitions, 5xx rate.
- Incident runbooks: general incident, **personal-data breach (72-hour notification workflow)**, key rotation, provider outage.
- Third-party **penetration test before first paying customer** and annually; bug-report contact (`security.txt`).

**Threat model highlights (expand in docs/threat-model.md)**

| Threat | Mitigation |
|---|---|
| Remote/prank orders via photographed QR | Signed token + table session/code + risk engine + staff approval + rate limits |
| Cross-tenant data leak | RLS forced + non-bypass role + CI isolation test |
| Price tampering | Server-side pricing, quote/409 on mismatch |
| Forged payment webhook | Signature verify + inbox idempotency + amount check + reconciliation |
| OTP pumping / SMS toll fraud | Cost budget, Turnstile, per-IP/phone limits, prefix blocks, alerts |
| Coupon/referral farming | Server-side eligibility, device/payment-instrument signals, payout only after paid+completed order, caps |
| Session theft | Short access token, refresh rotation + reuse detection, device list/revoke |
| Insider misuse | RBAC, audit logs, least privilege, MFA, approval for refunds |
| Supply-chain compromise | Lockfile, allowlisted scripts, audits, review, pinned digests |
| AI prompt injection / data leak | Grounded RAG, read-only tools, no PII in prompts, output filters, budgets |

---

## 23. Privacy and compliance (India first)

**DPDP Act 2023 / DPDP Rules 2025 readiness** (rules notified Nov 2025; consent-manager provisions from ~13 Nov 2026; core duties from ~13 May 2027 — **verify dates with counsel before launch**):
- Clear **notice + purpose-specific consent** at signup (ordering vs loyalty vs marketing separately); `consents` log is append-only with notice version.
- **Data minimization:** collect phone (required for account), name/email optional; no DOB; no children-targeted features.
- **Rights:** endpoints/jobs for access/export, correction, erasure (anonymize orders while retaining invoice data legally required for tax), grievance contact in settings.
- **Retention policy:** configurable; default purge/anonymize inactive customer PII after a defined period *(set with counsel/CA)*; invoice/tax records retained per law.
- **Breach readiness:** detection alerts, runbook, template notifications, 72-hour reporting workflow.
- **Roles:** the restaurant (organization) is typically the data fiduciary for its customers and DineFlow a processor — document in the DPA/terms; confirm with counsel. Because customers are per-org, no cross-restaurant profile sharing.
- **Data residency:** India stack hosted in Mumbai; avoid sending personal data to AI/analytics vendors without a contract and minimization.
- **Logs:** PII-free application logs; access to production data audited.

**Other:** GST invoice format/numbering per outlet; Google Business Profile policy compliance (section 19); WhatsApp Business policy (section 20); consumer-protection norms for pricing display (taxes, service charge disclosure clear to guests); accessibility.

---

## 24. Observability and SLOs

- **Logs:** pino JSON, fields: `ts, level, req_id, org_id, outlet_id, user_id_hash, route, status, latency_ms`; no PII.
- **Traces:** OpenTelemetry across API → DB → Redis → providers.
- **Metrics:** orders/min, order placement p95/p99, payment success rate, webhook lag, outbox lag, queue depth/age, SSE/WS connections, OTP sends & cost, DB pool saturation, error rate by route, AI latency/cost.
- **SLOs *(assumption)*:** API availability 99.9% monthly; order placement p95 < 500 ms; menu fetch p95 < 200 ms (cache hit); order-to-kitchen-display p95 < 2 s.
- **Alerts:** page on SLO burn, payment failure spike, queue stuck, DB CPU/connections, certificate expiry, webhook signature failures.
- **Product analytics:** privacy-respecting, consent-gated, first-party events (menu_view, add_to_cart, order_placed, payment_success, feedback_given).

---

## 25. Performance and scale targets *(assumptions — validate with k6)*

- Design for **1,000 outlets**, **~20 orders/s platform peak**, **~5,000 concurrent realtime connections**, 50k menu views/min cached.
- Techniques: PgBouncer/RDS Proxy, tuned pool sizes, covering/partial indexes, no N+1 (use dataloader/joins), CDN for media, menu cache (Redis + HTTP ETag), cursor pagination, rollup tables for analytics, partition `orders`/`order_events` by month **[LATER]**, read replica for analytics **[LATER]**.
- Horizontal scale: stateless API (≥2 tasks), autoscale on CPU + request latency; WebSocket sticky routing not required thanks to Redis fan-out.
- Load test scenarios (k6): lunch-rush order storm, QR-scan burst on menu, OTP flood (must be throttled), webhook replay, reconnect storm after deploy.

---

## 26. Testing strategy

| Level | Tooling | Must cover |
|---|---|---|
| Unit | Vitest | pricing, risk engine, state machines, coupon rules, token signing, permission map |
| Property | fast-check | pricing invariants, ledger sums, idempotency |
| Integration | Testcontainers (Postgres+Redis), Supertest | every endpoint happy/sad paths, RLS isolation, webhook idempotency, outbox → realtime |
| Contract | OpenAPI diff in CI | no breaking changes accidentally |
| E2E | Playwright | scan → order → pay (mock provider) → kitchen sees → complete → feedback |
| Security | custom suite + ZAP baseline | authz matrix, IDOR attempts, rate limits, OTP abuse, CSRF, header checks |
| Load | k6 | section 25 scenarios |
| AI eval | fixed prompt set | allergen safety, injection resistance, grounding |
| Accessibility | axe + manual | customer flows |

**Coverage gates [MUST]:** ≥ 90% line/branch on `pricing`, `payments`, `auth`, `tables`, `loyalty`, `orders/state-machine`, RLS helpers. Mutation testing on pricing/state machine is recommended.

---

## 27. CI/CD

Pipeline on every PR: install (frozen) → typecheck → lint (incl. boundaries, security rules) → unit → integration (containers) → RLS isolation test → OpenAPI diff → build → SAST (CodeQL/semgrep) → secret scan → dependency/OSV audit → container scan → Playwright smoke (on preview) → required human review for `NEEDS_HUMAN_REVIEW` areas (CODEOWNERS).
Deploy: merge to `main` → staging auto → smoke + e2e → manual approval → production blue/green via ECS with automatic rollback on health/SLO failure. DB migrations use **expand → migrate → contract**, are forward-only, run before app rollout, and must be backward compatible with the previous app version.
Branching: trunk-based, short-lived branches, conventional commits, protected `main`, signed commits recommended.

---

## 28. Global expansion design hooks

- `organizations.country/default_currency/default_locale`; all formatting via `Intl`. Prices in minor units with per-currency exponent table.
- Tax engine as pluggable strategy per country (GST India, VAT EU/UK, sales tax US) — data-driven; no tax logic in controllers.
- Payment providers by country behind the interface (Stripe/Adyen etc.); UPI-specific features gated by country.
- Messaging providers by country (WhatsApp availability varies; SMS/email alternatives).
- Data residency via **regional stacks ("cells")** with no cross-region customer data; global control plane holds only non-personal tenant routing metadata.
- Compliance modules per region (GDPR: lawful basis, DSAR, DPAs; CCPA).

---

## 29. Delivery phases and acceptance criteria

**Phase 0 — Foundations (week 1–2):** monorepo, tooling, CI, docker-compose, config validation, error format, logging, health checks, RLS test harness. *Done when:* CI green with an empty feature; tenant-isolation test runs against a sample table; `pnpm dev` boots everything.

**Phase 1 — Identity & tenancy (week 2–3):** orgs/outlets/staff, auth (staff + customer OTP w/ mock provider), RBAC guard + route-permission test. *Done when:* every route has permissions; OTP limits tested; refresh rotation + reuse detection tested.

**Phase 2 — Menu (week 3–4):** menu CRUD, media presign/processing, stock availability, public menu endpoint with ETag/cache, customer menu UI. *Done when:* menu opens from a QR URL in < 2 s on throttled 4G in Lighthouse; stock change reflects ≤ 5 s.

**Phase 3 — Tables & sessions (week 4–5):** QR tokens, resolve, staff-open, code verify, risk engine, QR sheet PDF export. *Done when:* abuse tests (brute-force, forged/old token, remote scan) pass.

**Phase 4 — Orders & realtime (week 5–7):** quote, place (idempotent), state machine, outbox, SSE/WS, KDS UI, waiter call. *Done when:* order appears on KDS < 2 s p95; duplicate submissions create one order; reconnect resync works.

**Phase 5 — Payments & invoices (week 7–9):** provider interface + first adapter, webhooks/inbox, reconciliation, direct-UPI staff mode, refunds, GST invoice. *Done when:* replayed/forged webhooks are harmless; amount mismatch flagged; invoice numbering gapless under concurrency test.

**Phase 6 — Owner analytics (week 9–10):** rollups, dashboards, exports. *Done when:* numbers reconcile with payments/orders in a test dataset.

**Phase 7 — Loyalty, coupons, referrals (week 10–12):** ledger, coupons, referral rules with fraud controls, checkout rules (guest vs signed-in). *Done when:* property tests pass; double-credit impossible; referral pays only after paid+completed order.

**Phase 8 — Feedback & reputation (week 12–13):** feedback flow, alerts, GBP read integration, dashboard. *Done when:* lint rule blocks review-linked rewards; Google link shown to all.

**Phase 9 — Messaging (week 13–14):** WhatsApp provider, templates, consent, cost tracking. *Done when:* opt-out honored, budget caps enforced.

**Phase 10 — AI assistant (week 14–15):** RAG, guardrails, budgets, eval suite. *Done when:* eval thresholds met; injection tests pass.

**Phase 11 — Hardening & launch readiness (week 15–17):** load tests, pen test, DPDP checklist, runbooks, backups restore drill, pilot onboarding tooling. *Done when:* no open High/Critical findings; restore drill documented; pilot restaurants live.

**Phase 12 — POS/KOT integrations & multi-outlet chains** [LATER]; **global stacks** [LATER].

---

## 30. Open questions for the human (agent: do not guess; ask)

1. Which payment gateway for India first (Razorpay vs Cashfree) and do we have KYC-approved merchant test accounts?
2. WhatsApp BSP choice and approved template names.
3. Preferred domain structure (`{slug}.domain` vs `domain/{slug}`) for outlet URLs.
4. Table code policy: digits (4 vs 6) and rotation interval.
5. Default tax setup per outlet (inclusive vs exclusive, service charge handling) — confirm with a CA.
6. Retention periods for customer PII and logs — confirm with counsel.
7. Which POS systems to integrate first (needs pilot restaurant input).
8. Pricing plan structure for owners (not needed for code, but affects entitlements/feature flags).
