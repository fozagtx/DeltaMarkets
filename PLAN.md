# DeltaMarkets — BuildX AI Season Hackathon Plan

**Event:** OKX BuildX AI Season Hackathon — AI-powered onchain app on X Layer
**Deadline:** Aug 21, 23:59 UTC (applications close)
**Today:** Aug 12 → ~9 days
**One-liner:** An AI agent that runs a delta-neutral DeFi position (LP + perp hedge) and explains every decision.

---

## What we're actually shipping (hackathon scope, NOT the 6-gate prod system)

The design docs (`arc.md`, `strat.md`, `reaction..md`) describe a cautious, production-grade
6-gate rollout. That is the wrong scope for a 9-day hackathon. For BuildX we ship a
**demoable vertical slice** that a judge can watch work end-to-end:

> An **AI agent** observes a Uniswap-V3-style LP position on X Layer, computes its true
> delta, decides the hedge, and places/adjusts an **OKX perpetual** hedge — narrating the
> reasoning in natural language.

Fits the three judging hooks: **AI agent**, **onchain**, **X Layer / OKX**.

### Fixed decisions
- **Chain:** X Layer (required to qualify).
- **DEX:** Uniswap-V3-style concentrated-liquidity pool on X Layer. *(RISK — verify a CL DEX
  exists on X Layer; fallback: OKX DEX / OnchainOS API for onchain data + swaps.)*
- **Hedge venue:** OKX perpetuals (**demo trading** for the hackathon — no real capital).
- **AI layer:** an agent (Claude) that reads portfolio state and emits the hedge decision +
  a plain-English rationale. This is the "AI" in AI-agent.

---

## Milestones (9 days)

- **M1 — Math core (Days 1–3).** The one piece that must be correct: Uniswap V3 LP delta.
  - Domain types, Decimal/bigint utils (no JS floats).
  - sqrtPriceX96 / tick math, LP amounts (3 regimes), LP value, analytical delta.
  - Independent finite-difference reference delta + convergence test. **This is the crux.**
- **M2 — Portfolio + hedge (Days 3–4).** Net delta = LP delta + perp delta. Hedge calc to
  target ~0. Venue-agnostic `HedgeVenue` interface (no OKX import in core).
- **M3 — OKX demo adapter (Days 4–6).** Auth, read account/positions/mark/funding, place +
  cancel demo orders, reconcile. `x-simulated-trading` demo env only.
- **M4 — X Layer read (Days 5–6).** Read a real pool + LP position via viem (or OKX DEX API).
- **M5 — AI agent loop (Days 6–7).** Agent ingests portfolio snapshot → outputs HedgeDecision
  + natural-language explanation. This is the demo's "wow".
- **M6 — Demo + submission (Days 7–9).** CLI/dashboard that shows: LP value, LP delta, perp
  delta, net delta, required hedge, agent rationale, analytical≈finite-diff PASS. README,
  demo video, submit before Aug 21 23:59 UTC.

## Non-goals for the hackathon
Live capital, cross-chain, multi-venue, strategy allocator, full reconciliation/circuit-breaker
suite, production security boundary. Interfaces stay clean so these are addable later.

## Open items to verify first
1. Concentrated-liquidity DEX available on X Layer? (else OKX DEX API fallback)
2. OKX demo-trading perp instrument for the chosen asset (ETH-USDT-SWAP or similar).
3. X Layer RPC endpoint + a known pool address to read.
