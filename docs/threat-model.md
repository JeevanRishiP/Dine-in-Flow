# DineFlow Threat Model

> Status: Skeleton — expand before Phase 11 (launch readiness).
> Reference: ARCHITECTURE §22, AGENTS §3

## Scope

- **In scope:** customer web app (PWA), staff console, owner console, API, database, payment webhooks.
- **Out of scope:** Cloudflare WAF internals, AWS infrastructure below the ECS task boundary.

## STRIDE Threat Table

| ID | Component | Threat Category | Threat | Existing/Planned Mitigation | Residual Risk | Owner |
|----|-----------|-----------------|--------|----------------------------|---------------|-------|
| T01 | QR token / table | **Spoofing** | Attacker forges a QR token for a different table/outlet | HMAC-SHA256 + `tv` (table token version) + outlet active check | Low | Phase 3 |
| T02 | QR token / table | **Tampering** | Attacker modifies token payload (change `org_id` or `table_id`) | Signature verification; tampered payload fails constant-time HMAC check | Low | Phase 3 |
| T03 | Table code | **Brute-force** | Attacker guesses 4–6 digit table code | Max 5 attempts per session/IP/15 min; exponential lockout; constant-time compare | Low | Phase 3 |
| T04 | Orders | **Tampering** | Client sends manipulated price/discount in order payload | Server re-computes all prices; client values ignored; `409 PRICE_CHANGED` if mismatch | Very Low | Phase 4/5 |
| T05 | Payments | **Spoofing** | Attacker sends a fake payment-success webhook | HMAC/signature verified on raw body; `webhook_inbox` deduplication | Low | Phase 5 |
| T06 | Payments | **Repudiation** | Merchant disputes payment events | Append-only `order_events` + `webhook_inbox` provide tamper-evident log | Low | Phase 5 |
| T07 | Multi-tenancy / DB | **Information Disclosure** | Tenant A reads Tenant B data via SQL injection or bug | RLS FORCED on all tenant tables; parameterized queries only; `BYPASSRLS` not granted | Low | Phase 0 |
| T08 | Auth | **Spoofing** | Stolen/replayed refresh token | Refresh token rotation + family revocation on reuse detection | Low | Phase 1 |
| T09 | Auth | **Elevation of Privilege** | Customer token used to call staff/owner endpoint | RBAC guard; object-level ownership checks; separate token subjects | Low | Phase 1 |
| T10 | OTP | **Denial of Service** | OTP flooding (SMS toll fraud / cost attack) | Per-phone/IP rate limits; cost budget cap per org; Turnstile; prefix blocks | Medium | Phase 1 |
| T11 | AI assistant | **Tampering** | Prompt injection via menu text or user input | Read-only tools; fixed system prompt server-side; output filtering; grounded RAG only | Medium | Phase 10 |
| T12 | File upload | **Tampering** | Polyglot file / SSRF via upload | Content-type + size enforcement; async sharp re-encode; EXIF strip; random key; no user URL fetch | Low | Phase 2 |
| T13 | Coupons / loyalty | **Elevation of Privilege** | Coupon farming or double-credit | Server-side eligibility; unique `(coupon_id, order_id)`; payout after paid+completed; velocity checks | Medium | Phase 7 |
| T14 | Google reviews | **Reputation / Compliance** | Incentivized review links (Google policy violation) | No reward gated on review; lint rule in CI; Google link shown to all equally | Very Low | Phase 8 |
| T15 | Secrets | **Information Disclosure** | Secrets in logs, code, or Git history | Pino redaction paths; `.env` in `.gitignore`; gitleaks in CI; Secrets Manager in prod | Low | Phase 0 |
| T16 | Supply chain | **Tampering** | Malicious npm package via install script | `onlyBuiltDependencies` allowlist; lockfile committed; OSV audit in CI | Low | Phase 0 |

## Key Security Controls Summary

| Control | Implementation |
|---------|---------------|
| Tenant isolation | PostgreSQL RLS (FORCE) + `app.org_id` session variable + CI enumeration test |
| Auth | argon2id passwords, TOTP MFA, short-lived JWT + rotating refresh |
| Money | Integer paise only; server-side pricing; idempotency keys |
| Webhooks | Signature verify on raw body; inbox with `UNIQUE(provider, event_id)` |
| Input validation | Zod `.strict()` on all request/response bodies; env vars at boot |
| Secrets | Never in code/logs; Pino redaction; gitleaks CI; Secrets Manager prod |
| Supply chain | Frozen lockfile; `onlyBuiltDependencies`; pnpm audit + OSV; Trivy |

## Open Items (to expand in later phases)

- [ ] Full PASTA / STRIDE per module (payments, loyalty, AI) — Phase 11
- [ ] Third-party pen test findings incorporated
- [ ] GDPR/DPDP data flow diagram
- [ ] Incident response runbooks linked from each threat
