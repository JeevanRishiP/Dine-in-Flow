# Dineflow Production Launch Readiness Checklist

**Document Version:** 1.0.0  
**Phase:** Phase 11 — Hardening & Production Launch Readiness  
**Target Release:** v1.0 Pilot Launch  
**Reference:** ARCH §22–§27, AGENTS §2  

---

## 1. Executive Summary & Launch Status

| Evaluation Category | Total Checks | Passed | Pending / Blocked | Category Sign-Off |
| :--- | :---: | :---: | :---: | :---: |
| **1. Security & Authentication** | 8 | 8 | 0 | APPROVED |
| **2. Multi-Tenancy & Data Isolation** | 6 | 6 | 0 | APPROVED |
| **3. DPDP Act & Statutory Compliance** | 6 | 6 | 0 | APPROVED |
| **4. Performance & Load Saturation** | 5 | 5 | 0 | APPROVED |
| **5. Observability & SLO Alerting** | 5 | 5 | 0 | APPROVED |
| **6. Disaster Recovery & Backups** | 4 | 4 | 0 | APPROVED |
| **7. Pilot Restaurant Readiness** | 5 | 5 | 0 | APPROVED |
| **TOTAL** | **39** | **39** | **0** | **ALL CHECKS PASSED** |

---

## 2. Detailed Verification Matrix

### 2.1 Security & Authentication
- [x] **Default-Deny Routing:** 100% of controller routes have explicit `@Require(Permission)` decorators or are declared `@Public()`. Verified via automated reflection scan in `security-audit.spec.ts`.
- [x] **Cryptographic Password Hashing:** All staff credentials hashed using `Argon2id` (64 MiB memory, 3 iterations, 4 parallelism per OWASP 2024).
- [x] **Server-Side OTP Pepper:** Customer OTPs hashed using HMAC-SHA256 with server-side secret pepper; brute-force protected with constant-time comparison.
- [x] **Stateless QR HMAC Verification:** Table QR tokens verified using HMAC-SHA256 and constant-time comparison; version bump invalidates tokens instantly.
- [x] **Payment Webhook Verification:** Razorpay & PhonePe signatures verified on the raw unmodified request body before ingestion.
- [x] **Security Headers & CSP:** Production reverse-proxy / Fastify configured with `helmet`: strict `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- [x] **Log Redaction:** `pino` logger configured with PII masks for customer phone numbers, auth tokens, passwords, and payment IDs.
- [x] **Zero Secrets in Git:** Scanned repository history; all credentials loaded via environment variables with boot-time Zod schema validation.

### 2.2 Multi-Tenancy & Data Isolation
- [x] **Forced Row-Level Security:** 100% of tables containing `org_id` have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- [x] **No DB Role Bypass:** Application role `dineflow_app` operates strictly without `BYPASSRLS`. Verified in static migration analysis.
- [x] **Transaction-Local Context:** Every query executes within `withTenantContextRaw` setting `set_config('app.org_id', $1, true)`.
- [x] **Cross-Tenant Integration Tests:** Test suite asserts that Tenant A can never read, update, or delete data belonging to Tenant B.
- [x] **Append-Only Table Protection:** Tables `consents`, `audit_logs`, `loyalty_ledger`, `order_events` grant only `INSERT, SELECT` to `dineflow_app` (no `UPDATE` or `DELETE`).
- [x] **Ephemeral Retention Grants:** Tables `customer_otp_codes` and `ai_chat_transcripts` explicitly granted `DELETE` for scheduled privacy retention sweeps.

### 2.3 DPDP Act 2023 & Statutory Tax Compliance
- [x] **DSAR Data Export:** Data subjects and compliance officers can export all customer personal records, orders, and consent history in machine-readable JSON format (`POST /v1/me/privacy/export`).
- [x] **Right to Erasure / Anonymization:** Right to be forgotten permanently scrubs customer name, email, Google ID, and replaces phone with unique pseudo-id (`+ANON-...`).
- [x] **GST Section 36 Tax Invariant:** Financial transactions and invoice records preserved for 72 months without violating unique phone constraints or tax retention laws.
- [x] **Pending Order Erasure Guard:** Anonymization is strictly blocked if the customer has active dine-in orders currently in flight.
- [x] **72-Hour Breach Runbook:** Documented protocol in `docs/runbooks/dpdp-breach.md` for CERT-In and Data Protection Board of India notification within 72 hours.
- [x] **ROPA Data Inventory:** Documented Record of Processing Activities in `docs/privacy-data-inventory.md` outlining data fiduciary vs processor roles.

### 2.4 Performance & Load Saturation (ARCH §24, §25)
- [x] **QR Scan Burst (500 VUs):** Validated in `infra/load-tests/qr-scan-burst.js`; menu fetch p95 < 200 ms with ETag 304 caching.
- [x] **Lunch-Rush Order Storm (25 orders/sec):** Validated in `infra/load-tests/lunch-rush-order-storm.js`; order creation p95 < 500 ms with error rate < 1%.
- [x] **Concurrent Checkout Idempotency:** Validated in `infra/load-tests/checkout-idempotency.js`; 20 concurrent VUs with identical idempotency keys yield zero duplicates and 0% errors.
- [x] **Database Pool Sizing:** Configured with 20 connections per API instance; PgBouncer transaction pooling planned for multi-replica deployments.
- [x] **Monetary Precision:** 100% of monetary calculations use integer paise (minor units) and ISO currency. Zero floating-point money math.

### 2.5 Observability & SLO Alerts (ARCH §24)
- [x] **Latency Alerts:** Configured alert trigger when menu fetch p95 > 200ms or order placement p95 > 500ms over 5-minute sliding window.
- [x] **5xx Error Rate Alert:** Alert trigger when 5xx HTTP response rate exceeds 0.1% over 10 minutes.
- [x] **Payment Webhook Dead-Letter Alert:** Notification alert if any webhook retry reaches maximum attempts in `webhook_inbox`.
- [x] **KDS Live Sync Health:** Kitchen Display System WebSocket connection dropped rate monitored; auto-reconnect heartbeat within 5 seconds.
- [x] **Audit Log Ingestion:** All sensitive operations (refunds, staff creation, privacy erasure) generate immutable audit records.

### 2.6 Disaster Recovery & Backups (ARCH §26)
- [x] **Continuous WAL Archiving:** WAL segments shipped to S3/MinIO every 60 seconds (`archive_timeout = 60s`).
- [x] **Recovery Point Objective (RPO):** Verified RPO ≤ 1 minute.
- [x] **Recovery Time Objective (RTO):** Verified RTO ≤ 30 minutes.
- [x] **Point-In-Time-Recovery (PITR) Drill:** Restored staging test cluster to T-1 minute in `docs/runbooks/restore-drill.md` with zero data loss and valid RLS policies.

### 2.7 Pilot Restaurant Onboarding Readiness
- [x] **Automated Seeder Tool:** CLI script `apps/api/src/tools/seed-pilot-restaurant.ts` tested and verified (`pnpm seed:pilot`).
- [x] **Menu CSV Importer:** Production menu seed dataset `infra/seeds/pilot-menu.csv` parsed accurately with verified category groupings and allergen tags.
- [x] **Table & QR Token Generation:** 20 tables generated with HMAC-signed QR tokens and deep-link scan URLs.
- [x] **AI Assistant Vector Indexing:** Menu embeddings populated for hybrid vector & full-text customer search.
- [x] **Owner Account Provisioning:** Initial `OWNER` staff account created with verified status.

---

## 3. Residual Risks & Mitigations

| Risk ID | Description | Severity | Probability | Mitigation Strategy | Owner |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **RSK-01** | Payment gateway upstream latency spike (Razorpay/PhonePe API delay). | Low | Med | Asynchronous webhook ingestion with client-side polling; UI displays pending state rather than timing out. | Core API Team |
| **RSK-02** | Wi-Fi dead-zone at dining tables in pilot restaurant. | Med | Low | Dine-in customer web app functions as a cached PWA; scan URL stores session in localStorage. | Mobile/Web Team |
| **RSK-03** | Google Review API rate limits during bulk review sync. | Low | Low | Exponential backoff with jitter and 6-hour sync interval; anti-incentive guards prevent customer-facing blockers. | Loyalty Team |

---

## 4. Final Sign-off

- **Engineering Lead:** APPROVED (All 39 checklist requirements verified)
- **Security & Compliance:** APPROVED (Zero RLS leaks, DPDP technical requirements met)
- **Operations / SRE:** APPROVED (k6 load suites verified, restore drill tested)
- **Status:** **READY FOR PILOT LAUNCH**
