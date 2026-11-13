# ADR 0002: Temporary Dev-Only Isolated Evolution API for WhatsApp OTP

Date: 2026-11-12
Status: Accepted (Temporary Local Development Exception — Superseded in Staging/Production by Meta Cloud API)
Deciders: Founder + AI agent

## Context

`docs/ARCHITECTURE.md` §2 D9 and `AGENTS.md` §2 rule 11 mandate official WhatsApp Cloud API via a BSP and prohibit unofficial WhatsApp-Web bridges to eliminate production account ban and ToS risk.

For local development testing before BSP credentials are provisioned, the Founder requested using the already-pulled `evoapicloud/evolution-api:latest` Docker image in an isolated container/instance (`dineflow_evolution` / instance `dineflow_otp`, completely separate from any other local project's Evolution container `wcos-evolution`).

## Decision

1. **Dev-Only Exception:** Permit `WHATSAPP_PROVIDER=evolution_dev` exclusively in `apps/api/src/modules/auth/whatsapp-otp.provider.ts` when `NODE_ENV !== 'production'`.
2. **Production Hard Fail:** `apps/api/src/config/config.ts` validates at boot and **exits with error** if `NODE_ENV === 'production'` sets `WHATSAPP_PROVIDER=evolution_dev`.
3. **Isolation:** `infra/docker/docker-compose.dev.yml` runs `dineflow_evolution` on dedicated port `8085` and dedicated Postgres database `dineflow_evolution` + Redis DB `5`, and the adapter only calls `/message/sendText/{instance}` (never modifying instances).
4. **General Messaging Unaffected:** Customer campaigns/webhooks (`apps/api/src/modules/messaging/`) remain strictly Meta Cloud API (`WhatsAppCloudAdapter`) only.

## Consequences

- Local developers can test real WhatsApp OTP delivery safely without touching external projects.
- Staging and production deployments remain strictly compliant with Meta WhatsApp Cloud API (`D9`).

