# ADR 0001: Record Architecture Decisions

Date: 2026-10-25
Status: Accepted
Deciders: Founder + AI agent

## Context

For a long-lived SaaS product, it's important to capture why key technical decisions were made so future contributors understand the context and don't re-litigate settled questions.

## Decision

We will maintain Architecture Decision Records (ADRs) in `docs/adr/`.

Each ADR is a short markdown file numbered sequentially (`NNNN_title.md`) and contains:
- **Context** — what problem or constraint drove the decision
- **Decision** — what we chose
- **Consequences** — trade-offs accepted

ADRs are **append-only**. A superseded decision is marked `Superseded by: NNNN` and a new ADR explains the replacement. Never delete or edit a past ADR.

## Consequences

- Agents must create an ADR in `docs/adr/` whenever a decision in `docs/ARCHITECTURE.md` Section 2 (Decision Log) is changed.
- All D-items from ARCHITECTURE.md §2 are implicitly captured here as the initial set; this ADR records the convention itself.
