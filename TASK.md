# TASK — Hackathon build checklist (target: Aug 21)

## M1 — Math core (the crux)
- [ ] Monorepo scaffold: pnpm workspace, strict TS, Vitest
- [ ] Domain types: Asset, Market, Position, LiquidityPosition, Portfolio
- [ ] Decimal/bigint utils — no JS floating point in financial math
- [ ] Uniswap V3 price/tick math (sqrtPriceX96 ↔ price, tick, token ordering)
- [ ] LP amount calculator (below / inside / above range)
- [ ] LP valuation + analytical LP delta (dV/dP)
- [ ] Independent finite-difference reference delta
- [ ] Delta convergence test suite (boundaries, narrow/wide, extreme prices, decimals)
- [ ] Property tests (non-negative amounts, boundary continuity, additive delta)

## M2 — Portfolio + hedge
- [ ] Portfolio aggregator + perp delta model
- [ ] Net delta engine
- [ ] Hedge calculation to target ~0 (with hysteresis / min-size guard)
- [ ] HedgeVenue interface (no venue-specific import in core)

## M3 — OKX demo adapter
- [ ] Auth + demo (`x-simulated-trading`) config, reject prod endpoints in demo
- [ ] Read: account, positions, mark/index, funding
- [ ] Place + cancel demo order
- [ ] Reconcile db vs venue

## M4 — X Layer read
- [ ] viem provider for X Layer (RPC + failover)
- [ ] Read pool state (slot0, liquidity, ticks) + LP position

## M5 — AI agent loop
- [ ] Portfolio snapshot → agent → HedgeDecision + natural-language rationale
- [ ] Decision logging / auditability

## M6 — Demo + submission
- [ ] CLI/dashboard: LP value, deltas, net delta, required hedge, agent rationale, PASS status
- [ ] README + .env.example
- [ ] Demo video
- [ ] Submit before Aug 21 23:59 UTC

## Verify first
- [ ] CL DEX on X Layer? (fallback: OKX DEX / OnchainOS API)
- [ ] OKX demo perp instrument id for chosen asset
- [ ] X Layer RPC + known pool address
