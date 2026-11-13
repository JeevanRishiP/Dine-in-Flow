# AGENTS.md — Rules of Engagement for AI Coding Agents

This repository is `dineflow`, a multi-tenant restaurant dine-in ordering SaaS. The source of truth is `docs/ARCHITECTURE.md`. Read it before writing code. If anything here conflicts with it, stop and ask the human.

## 1. Operating procedure (every task)

1. **Read** `docs/ARCHITECTURE.md` sections relevant to the task, and the task's phase prompt in `docs/PROMPTS.md`.
2. **Plan first.** Output a short plan: files to create/change, schema changes, endpoints, tests, risks. Wait for approval only if the task is marked "approval required" or the plan changes the spec.
3. **Work in small vertical slices.** One slice = one coherent change that builds, tests and runs. Commit after each slice with a conventional commit message (`feat(orders): …`).
4. **Write tests with the code**, not afterwards. A slice without tests is not done.
5. **Run** typecheck, lint, tests before declaring done. Paste the actual command output summary (not a claim that it passed).
6. **Report** using the template in section 9.

## 2. Hard rules (never violate)

1. **No floating-point money.** Integer minor units (paise) + ISO currency only.
2. **Never trust client-supplied prices, totals, discounts, roles, org IDs or outlet IDs.** Derive from the authenticated context and database.
3. **Every tenant-owned table has `org_id` and forced RLS.** Never use a DB role with `BYPASSRLS` in app code. New tables without RLS must fail CI.
4. **Every route declares a permission or is explicitly `@Public()`.** Default deny. Add or update the route-permission test.
5. **Validate every input and output with Zod** (`.strict()` on objects). Validate env vars at boot.
6. **Parameterized queries only.** No string-concatenated SQL.
7. **No secrets in code, logs, tests, fixtures, or prompts.** Use env vars. Redact PII/tokens/OTPs in logs.
8. **Idempotency:** `Idempotency-Key` on order placement, payment creation, refunds, coupon redemption, referral credit.
9. **Webhooks:** verify signature on the raw body, store in `webhook_inbox` (unique by provider+event_id), process async and idempotently. Never trust browser redirects for payment success.
10. **No reward, discount, points or credit may be conditional on a public Google review.** Never write code that links customers/orders to Google reviews.
11. **No unofficial WhatsApp/WhatsApp-Web libraries.** Official Cloud API via the provider interface only. *(Temporary local dev-only OTP exception recorded in `docs/adr/0002_dev_only_evolution_otp_exception.md`: `WHATSAPP_PROVIDER=evolution_dev` is allowed strictly when `NODE_ENV !== 'production'` against an isolated container; production hard-fails if enabled.)*
12. **No new dependency without justification.** Before adding a package: confirm it exists on the registry, is actively maintained, has meaningful adoption, and has no better built-in/existing alternative. List it in the report. Never invent package names.
13. **No `any`, no `@ts-ignore`** without a one-line justification comment and mention in the report.
14. **No migrations that edit or drop existing columns/tables destructively.** Use expand → migrate → contract. Migrations are forward-only SQL files.
15. **Do not weaken or delete tests to make them pass.** Fix the code or ask.
16. **Do not touch** `infra/terraform` production configuration or CI security checks without explicit instruction.

## 3. Security-critical areas → flag `NEEDS_HUMAN_REVIEW`

Any change touching: `auth`, `tables` (QR tokens/sessions/codes), `payments`, `webhooks`, `orders/pricing`, `orders/state-machine`, `loyalty` (ledger/referral/coupons), RLS/db helpers, `compliance`, `messaging` consent, `ai` guardrails. State clearly in the report which of these changed and what the reviewer should check.

## 4. Coding standards

- TypeScript `strict`; ES modules; Node LTS per `.nvmrc`.
- NestJS: one module per domain under `apps/api/src/modules/*`; controllers thin (parse → authorize → call service → map); services hold business logic; repositories wrap Drizzle queries; no cross-module table access (use public service interface from `index.ts`).
- Naming: files `kebab-case.ts`; classes `PascalCase`; DB `snake_case`; JSON API `camelCase`; enums `UPPER_SNAKE`.
- Errors: throw typed domain errors mapped to RFC 7807 problem responses with stable `code` from `packages/contracts`. Never leak stack traces or internal IDs.
- Logging: `pino` with request id; no PII.
- Time: store UTC; never use local time on the server; inject a clock for testability.
- Functions: pure where possible; pricing, risk engine, state machine, coupon rules must be pure and heavily tested.
- Comments explain **why**, not what. Reference spec sections (`// ARCH §9`).
- Frontend: Next.js App Router, server components where useful, client components only when needed; TanStack Query with the generated API client; Tailwind; accessible components; no inline styles for layout; no secrets in client bundles; only `NEXT_PUBLIC_*` vars that are safe to expose.

## 5. Testing requirements

- Vitest unit + property tests (fast-check) for pure logic.
- Integration tests with Testcontainers (real Postgres + Redis). **Never mock the database for RLS/authz tests.**
- Required for every endpoint: success, validation failure, unauthorized, forbidden (wrong role), cross-tenant attempt, idempotent replay (where applicable), rate-limit behavior (where applicable).
- E2E with Playwright for the golden path as phases complete.
- Coverage gates ≥ 90% on pricing, payments, auth, tables, loyalty, order state machine, RLS helpers.
- Provide deterministic tests (no real network, no sleeping; use fake timers/clock).

## 6. Database rules

- Migrations in `apps/api/src/db/migrations/NNNN_description.sql`. Each new tenant table includes: `org_id`, indexes on FKs, `ENABLE`+`FORCE ROW LEVEL SECURITY`, policy `tenant_isolation`, grants for the app role only to the allowed verbs.
- Append-only tables (`order_events`, `audit_logs`, `loyalty_ledger`, `consents`): grant `INSERT, SELECT` only — no `UPDATE/DELETE` to the app role.
- Use transactions for multi-step state changes; write `order_events` and `outbox_events` in the same transaction as the state change.
- Check query plans (`EXPLAIN`) for hot paths; add the needed indexes.

## 7. Git and review

- Branch per phase/slice: `feat/<phase>-<slice>`; PR description from the report template.
- CODEOWNERS routes security-critical paths to the human reviewer; agent must not self-approve.
- Never force-push to shared branches. Never commit generated secrets or `.env*` (except `.env.example`).

## 8. When uncertain

- If the spec is ambiguous, missing, or contradictory: **stop and ask** with the specific question and 2–3 options with trade-offs. Do not guess on money, auth, tenancy, or legal/compliance behavior.
- If a requirement seems wrong or unsafe: say so, explain why, propose an alternative. Do not silently implement an unsafe version.
- If a test fails for a reason you can't explain after two attempts: stop, summarize what you tried, and ask.

## 9. Report template (end of every task)

```
## Summary
<2–4 sentences>

## Changes
- files created/changed (grouped by module)
- migrations added (names)
- endpoints added/changed (method + path + permission)

## Tests
- commands run + results (typecheck / lint / unit / integration / e2e)
- new tests added (list)

## Security-critical flags
- NEEDS_HUMAN_REVIEW: <areas> — <what to check>

## Dependencies
- added: <name, version, why, verified-exists>  (or "none")

## Deviations from spec
- <none | list with reason>

## Risks / follow-ups / open questions
- …
```

## 10. Definition of Done (per slice)

- Builds, typechecks, lints clean; all tests pass, including RLS isolation and route-permission tests.
- Coverage gates met for touched critical modules.
- OpenAPI regenerated; API client updated; no breaking contract changes.
- Docs updated (`docs/adr/` if a decision changed; runbook if operational behavior changed).
- Report delivered in the template above.

## 11. Local setup (for the agent to keep working)

- `pnpm i --frozen-lockfile`, `pnpm dev` (docker compose brings up Postgres, Redis, MinIO, Mailpit, mock providers), `pnpm test`, `pnpm test:int`, `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`, `pnpm db:migrate`.
- Keep these scripts working; if you change them, update this file.

> Note for the human: if your IDE has a dedicated "rules" or "workflows" feature, paste sections 1–10 there as well so the agent always loads them.
