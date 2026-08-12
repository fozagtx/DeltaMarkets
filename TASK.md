# TASK — Hackathon build checklist (target: Aug 21)

## M1 — Math core (the crux) ✅
- [x] Scaffold: strict TS, Vitest, decimal.js (single package for hackathon speed)
- [x] Domain types: Asset, PoolState, LiquidityPosition, LinearPosition, DeltaResult
- [x] Decimal/bigint utils — no JS floating point in financial math
- [x] Uniswap V3 price/tick math (sqrtPriceX96 ↔ price, tick, token ordering)
- [x] LP amount calculator (below / inside / above range, clamped form)
- [x] LP valuation + analytical LP delta (dV/dP)
- [x] Independent finite-difference reference delta
- [x] Delta convergence test suite (boundaries, narrow/wide, extreme prices, decimals)
- [x] Property tests (non-negative amounts, boundary continuity, additive delta)
- [x] 21/21 tests pass, typecheck clean

## M2 — Portfolio + hedge ✅
- [x] Portfolio aggregator + perp delta model (linear delta = quantity)
- [x] Net delta engine (LP + linear, additive, with breakdown)
- [x] Hedge calculation to target ~0 (hysteresis band + min-size dust guard)
- [x] HedgeVenue interface (no venue-specific import in core)
- [x] Deterministic Gate-1 report (`pnpm demo`) — amounts, value, deltas, hedge, PASS
- [x] 31/31 tests pass, typecheck clean

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
