Absolutely. I’d make the follow-up **the actual engineering specification that sits underneath the PRD**, rather than another high-level document.

I’ve also tightened a few things based on the current OKX API: OKX supports REST/WebSocket trading, private account/order/position channels, perpetual `SWAP` instruments, order prechecks in supported margin modes, and demo trading via its simulated-trading environment. ([OKX][1]) For the LP math, the implementation needs to follow Uniswap V3’s concentrated-liquidity model rather than treating an LP as a static spot position. ([atiselsts.github.io][2])

# Delta-Neutral DeFi Engine

## Technical Architecture & Gate 1 Engineering Specification

**Version:** 1.0
**Status:** Implementation Specification
**Language:** TypeScript
**Runtime:** Node.js
**Chain:** Base
**DEX:** Uniswap V3
**Hedge Venue:** OKX Perpetuals
**Initial Asset:** ETH/USDC
**Primary Objective:** Correct portfolio accounting and delta-neutral hedge calculation before live execution

---

# 1. Purpose

This document converts the Product Requirements Document into an implementation specification.

The first engineering objective is **not** to build a complete autonomous trading bot.

The first objective is to build a mathematically correct portfolio engine capable of answering:

> What positions do I actually have, what are they worth, what is their current delta, and what hedge would bring the portfolio back toward its target?

Everything else depends on this.

The implementation will therefore proceed in gates:

```text
GATE 1
Mathematics + Portfolio State
        ↓
GATE 2
Backtester
        ↓
GATE 3
Base Fork
        ↓
GATE 4
OKX Demo
        ↓
GATE 5
Shadow Trading
        ↓
GATE 6
Limited Production
```

No production execution is part of Gate 1.

---

# 2. Design Principles

## 2.1 Strategy does not execute

Incorrect:

```text
strategy.rebalance()
→ okx.placeOrder()
```

Correct:

```text
Strategy
   ↓
Target Portfolio
   ↓
Portfolio Engine
   ↓
Risk Engine
   ↓
Execution Plan
   ↓
Execution Venue
```

---

## 2.2 Portfolio is authoritative

The strategy must never independently maintain a second representation of positions.

The portfolio engine owns:

```text
balances
positions
LP state
hedges
PnL
fees
funding
delta
exposure
```

---

## 2.3 Risk can veto strategy

The strategy can propose an action.

The risk engine can reject it.

The execution layer must never bypass the risk engine.

---

## 2.4 Execution is asynchronous

Orders and transactions are not assumed to succeed merely because an API returned successfully.

Every action has:

```text
intent
submission
acknowledgement
fill
confirmation
reconciliation
```

---

## 2.5 Fail closed

If the system cannot establish what the portfolio currently contains, it must not increase risk.

---

# 3. Technology Stack

Recommended:

```text
TypeScript
Node.js
viem
PostgreSQL
Redis
Pino
Zod
Vitest
Fastify
Docker
Prometheus
Grafana
Foundry / Anvil
```

Use `viem` for EVM interaction.

Use `decimal.js` or an equivalent arbitrary-precision decimal library for financial calculations where integer fixed-point arithmetic is not practical.

Do not use JavaScript floating-point arithmetic for financial state.

---

# 4. Numerical Precision

This is mandatory.

Never do:

```ts
const value = 0.1 + 0.2;
```

for financial calculations.

Use:

```text
bigint
```

for raw blockchain quantities.

Use:

```text
Decimal
```

for normalized financial calculations.

All calculations must explicitly define:

```text
input unit
output unit
decimal precision
rounding mode
```

---

# 5. Unit System

Every financial quantity must have an explicit unit.

Examples:

```text
ETH
USDC
USD
ETH/USD
ETH delta
USD delta
token0 raw units
token1 raw units
liquidity
sqrtPriceX96
ticks
basis points
```

Avoid generic:

```ts
number
```

where a domain type is appropriate.

---

# 6. Domain Model

## 6.1 Asset

```ts
interface Asset {
  id: string;
  symbol: string;
  chainId?: number;
  address?: string;
  decimals: number;
}
```

Example:

```text
ETH
USDC
```

---

# 7. Market

```ts
interface Market {
  id: string;
  baseAsset: Asset;
  quoteAsset: Asset;

  spotPrice: Decimal;
  markPrice?: Decimal;
  indexPrice?: Decimal;

  timestamp: number;
}
```

---

# 8. Position

```ts
interface Position {
  id: string;

  venue: string;
  venuePositionId?: string;

  asset: Asset;

  quantity: Decimal;
  entryPrice: Decimal;
  markPrice: Decimal;

  notional: Decimal;

  delta: Decimal;

  unrealizedPnl: Decimal;
  realizedPnl: Decimal;

  fees: Decimal;
  funding: Decimal;

  timestamp: number;
}
```

---

# 9. LP Position

```ts
interface LiquidityPosition {
  id: string;

  chainId: number;

  protocol: "uniswap-v3";

  poolAddress: string;

  token0: Asset;
  token1: Asset;

  tickLower: number;
  tickUpper: number;
  currentTick: number;

  liquidity: bigint;

  amount0: Decimal;
  amount1: Decimal;

  valueUsd: Decimal;

  deltaToken0: Decimal;
  deltaToken1: Decimal;

  feesToken0: Decimal;
  feesToken1: Decimal;

  timestamp: number;
}
```

---

# 10. Portfolio

```ts
interface Portfolio {
  id: string;

  balances: Balance[];

  spotPositions: Position[];

  lpPositions: LiquidityPosition[];

  derivativePositions: Position[];

  netDelta: Decimal;
  grossDelta: Decimal;

  totalValueUsd: Decimal;

  realizedPnl: Decimal;
  unrealizedPnl: Decimal;

  fundingPnl: Decimal;
  feePnl: Decimal;

  marginUtilization?: Decimal;

  timestamp: number;
}
```

---

# 11. Target Portfolio

Strategies produce target state.

```ts
interface TargetPortfolio {
  strategyId: string;

  targetDelta: Map<string, Decimal>;

  maxDelta: Map<string, Decimal>;

  targetCapital?: Decimal;

  timestamp: number;
}
```

Example:

```text
ETH target delta:
0

Maximum allowed:
±0.05 ETH
```

---

# 12. Delta Model

The central equation is:

```text
Net Delta =
    Spot Delta
  + LP Delta
  + Perpetual Delta
  + Other Derivative Delta
```

For V1:

```text
Net ETH Delta =
    ETH Spot
  + ETH LP Delta
  + ETH Perpetual Delta
```

The objective is:

```text
|Net ETH Delta| <= configured tolerance
```

---

# 13. Uniswap V3 Price Representation

Uniswap V3 uses:

```text
sqrtPriceX96
```

rather than directly storing the price as a floating-point number.

The normalized square-root price is:

```text
sqrtP = sqrtPriceX96 / 2^96
```

Price must then be normalized according to token decimals and token ordering.

This normalization must be implemented once in a dedicated price module.

---

# 14. Tick Representation

For a tick:

```text
sqrtP = 1.0001^(tick / 2)
```

The implementation should use the protocol's tick math rather than calculating this using ordinary floating-point arithmetic.

Use the canonical fixed-point representations whenever possible.

---

# 15. LP Amount Calculation

For a position with:

```text
L = liquidity

Pa = lower sqrt price

Pb = upper sqrt price

P = current sqrt price
```

there are three regimes.

## Price below range

```text
P <= Pa
```

The position is entirely token0.

```text
amount0 =
L * (Pb - Pa)
----------------
Pa * Pb
```

The exact implementation should use fixed-point-safe arithmetic.

---

## Price inside range

```text
Pa < P < Pb
```

The position contains both assets.

```text
amount0 =
L * (Pb - P)
----------------
P * Pb
```

and:

```text
amount1 =
L * (P - Pa)
```

with appropriate decimal normalization.

---

## Price above range

```text
P >= Pb
```

The position is entirely token1.

```text
amount0 = 0

amount1 =
L * (Pb - Pa)
```

The concentrated-liquidity formulation and its implementation details are described in the Uniswap V3 liquidity math literature and the protocol's corresponding library model. ([atiselsts.github.io][2])

---

# 16. Critical Delta Insight

For a V3 LP position, the local first-order price exposure is not simply:

```text
amount0
```

or:

```text
amount1
```

The portfolio engine should calculate delta from the position's current value/composition and the pool invariant mechanics.

For the active range, a useful local representation is based on the derivative of position value with respect to the underlying price.

The implementation must define:

```text
dV / dP
```

explicitly.

For a token0/token1 pair where token1 is the numeraire:

```text
V(P) =
amount0(P) * P
+
amount1(P)
```

and:

```text
delta = dV/dP
```

The implementation must test this analytical delta against a finite-difference approximation:

```text
delta_fd =
(V(P + ε) - V(P - ε))
----------------------
2ε
```

The analytical and finite-difference deltas should converge within a defined tolerance.

---

# 17. Why This Test Is Mandatory

The largest mathematical risk in the project is a plausible-looking but incorrect LP delta calculation.

A unit test such as:

```text
expectedDelta = 1.25
```

is insufficient.

The system needs invariant tests:

```text
analytical delta ≈ finite difference delta
```

across:

```text
price below range
price at lower boundary
price inside range
price near upper boundary
price above range
very narrow ranges
very wide ranges
extreme prices
different decimal combinations
```

---

# 18. Token Ordering

The implementation must never assume:

```text
token0 = ETH
token1 = USDC
```

The pool can have either ordering.

Create:

```ts
interface TokenOrdering {
  token0: Asset;
  token1: Asset;

  priceToken0InToken1: Decimal;

  priceToken1InToken0: Decimal;
}
```

All delta calculations must normalize into a common reporting asset.

For V1:

```text
reportingAsset = ETH
```

---

# 19. Price Oracle Abstraction

```ts
interface PriceProvider {
  getSpotPrice(asset: Asset): Promise<Price>;
  getMarkPrice(asset: Asset): Promise<Price>;
  getIndexPrice(asset: Asset): Promise<Price>;
}
```

A price must contain:

```ts
interface Price {
  asset: Asset;
  value: Decimal;
  source: string;
  timestamp: number;
}
```

---

# 20. Price Freshness

Every price must have:

```text
timestamp
age
source
```

If:

```text
now - price.timestamp > maxPriceAge
```

the price becomes invalid.

The risk engine must reject actions relying on stale prices.

---

# 21. Price Divergence

The system should compare independent price sources.

Example:

```text
Uniswap-derived ETH price
OKX index price
external oracle price
```

If divergence exceeds:

```text
maxOracleDeviation
```

the system enters:

```text
DEGRADED
```

or:

```text
HEDGE_ONLY
```

depending on configuration.

---

# 22. Perpetual Delta

For a linear ETH-USDT perpetual:

```text
delta ≈ position quantity
```

A short:

```text
-2 ETH
```

contributes approximately:

```text
-2 ETH delta
```

The implementation must confirm contract-specific sizing conventions from the venue instrument metadata rather than assuming that every exchange represents quantity identically.

---

# 23. Hedge Calculation

Given:

```text
LP delta = +2.40 ETH

Spot delta = 0

Existing perp delta = -1.80 ETH
```

then:

```text
netDelta = +0.60 ETH
```

If:

```text
targetDelta = 0
```

then:

```text
required hedge = -0.60 ETH
```

But the execution engine must still apply:

```text
minimum rebalance size
maximum rebalance size
cost threshold
risk limits
venue liquidity
```

---

# 24. Hysteresis

Do not continuously trade around zero.

Example:

```text
enter hedge:
|delta| > 2%

target after hedge:
|delta| < 0.5%
```

The exact values are configurable.

---

# 25. Minimum Rebalance

Do not execute tiny adjustments.

Example:

```yaml
rebalance:
  triggerDeltaPercent: 0.02
  targetDeltaPercent: 0.005
  minimumNotionalUsd: 25
```

If the required hedge is below the minimum economic threshold:

```text
NO_ACTION
```

---

# 26. Cost-Aware Hedge

The hedge decision must calculate:

```text
expectedRiskReduction
executionCost
fundingImpact
slippage
```

The engine should not rebalance merely because:

```text
delta != 0
```

Decision:

```text
if expectedBenefit <= expectedCost:
    NO_ACTION
```

---

# 27. Hedge Decision Model

```ts
interface HedgeDecision {
  asset: Asset;

  currentDelta: Decimal;
  targetDelta: Decimal;

  requiredDelta: Decimal;
  proposedDelta: Decimal;

  expectedExecutionCost: Decimal;
  expectedFundingImpact: Decimal;

  reason: string;

  action:
    | "NO_ACTION"
    | "OPEN"
    | "INCREASE"
    | "DECREASE"
    | "CLOSE";
}
```

---

# 28. Strategy Interface

```ts
interface Strategy {
  id: string;

  evaluate(
    portfolio: Portfolio,
    market: MarketState
  ): Promise<StrategyDecision>;
}
```

The strategy returns:

```ts
interface StrategyDecision {
  strategyId: string;

  targetPortfolio: TargetPortfolio;

  action:
    | "ENTER"
    | "MAINTAIN"
    | "REBALANCE"
    | "EXIT"
    | "NO_ACTION";

  reason: string;
}
```

---

# 29. V1 Strategy

```text
UniswapV3DeltaNeutralStrategy
```

Inputs:

```text
pool
LP range
capital allocation
minimum yield
delta limits
hedge venue
funding limits
risk limits
```

Outputs:

```text
target LP state
target ETH delta
entry/exit decision
```

It must not place orders.

---

# 30. Portfolio Valuation

Every portfolio snapshot must calculate:

```text
LP value
spot value
perpetual value
cash
fees
funding
total NAV
```

P&L must be decomposed into:

```text
price P&L
LP fee P&L
funding P&L
trading fee P&L
gas
slippage
incentives
```

---

# 31. P&L Attribution

Every realized/unrealized P&L change should have a category.

```text
PNL_PRICE
PNL_LP_FEES
PNL_FUNDING
PNL_INCENTIVES
PNL_GAS
PNL_TRADING_FEES
PNL_SLIPPAGE
PNL_OTHER
```

This prevents the dashboard from reporting an attractive APR while hiding expensive rebalancing.

---

# 32. Position Lifecycle

LP:

```text
DISCOVERED
→ ACTIVE
→ ADJUSTING
→ ACTIVE
→ EXITING
→ CLOSED
```

Perpetual:

```text
DISCOVERED
→ OPENING
→ OPEN
→ ADJUSTING
→ REDUCING
→ CLOSED
```

---

# 33. Portfolio Snapshot

Persist a snapshot whenever material state changes.

```ts
interface PortfolioSnapshot {
  id: string;

  timestamp: number;

  navUsd: Decimal;

  netDelta: Record<string, Decimal>;
  grossDelta: Record<string, Decimal>;

  lpValueUsd: Decimal;
  hedgeNotionalUsd: Decimal;

  realizedPnlUsd: Decimal;
  unrealizedPnlUsd: Decimal;

  fundingPnlUsd: Decimal;
  feesUsd: Decimal;

  marginUtilization?: Decimal;
}
```

---

# 34. Reconciliation

Two separate reconciliation systems are required.

## 34.1 On-chain reconciliation

Compare database state against:

```text
wallet balances
LP NFT ownership
LP liquidity
token balances
pending transactions
```

## 34.2 OKX reconciliation

Compare database state against:

```text
balances
positions
orders
fills
funding
margin
```

OKX exposes account and position information through private WebSocket channels, and its API supports order/fill/position retrieval for reconciliation. ([OKX][1])

---

# 35. Reconciliation Frequency

WebSocket events provide the low-latency path.

REST is the authoritative reconciliation fallback.

Example:

```text
WebSocket:
continuous

REST:
every 15–60 seconds

Full reconciliation:
configurable
```

The exact production interval must be tuned against venue limits and operational requirements.

---

# 36. OKX Adapter

```ts
interface DerivativesVenue {
  getInstruments(): Promise<Instrument[]>;

  getAccount(): Promise<AccountState>;

  getPositions(): Promise<Position[]>;

  getOpenOrders(): Promise<Order[]>;

  getFundingRate(
    instrument: string
  ): Promise<FundingRate>;

  getOrderBook(
    instrument: string
  ): Promise<OrderBook>;

  placeOrder(
    request: OrderRequest
  ): Promise<OrderResult>;

  cancelOrder(
    request: CancelOrderRequest
  ): Promise<void>;

  amendOrder(
    request: AmendOrderRequest
  ): Promise<OrderResult>;

  closePosition(
    request: ClosePositionRequest
  ): Promise<OrderResult>;
}
```

OKX's current API exposes perpetuals as `SWAP` instruments and provides REST and WebSocket trading/account/position functionality. ([OKX][1])

---

# 37. OKX WebSocket Architecture

Use separate logical streams for:

```text
market data
account
orders
positions
```

The OKX documentation recommends WebSocket for market data and provides private account, order and position channels. ([OKX][1])

The application must handle:

```text
connect
authenticate
subscribe
heartbeat
disconnect
reconnect
resubscribe
sequence/recovery where applicable
```

A WebSocket disconnect must never cause the system to assume that the previous state remains correct indefinitely.

---

# 38. OKX Demo Mode

V1 must support:

```text
OKX_DEMO=true
```

and reject production endpoints when running in demo mode.

OKX currently documents demo trading through its simulated environment, including the `x-simulated-trading: 1` header and separate WebSocket services. ([OKX][1])

Production and demo credentials must never be mixed.

---

# 39. Execution Intent

Strategies create:

```ts
interface ExecutionIntent {
  id: string;

  strategyId: string;

  portfolioVersion: number;

  createdAt: number;

  targetDelta: Record<string, Decimal>;

  requiredChanges: PositionChange[];

  reason: string;
}
```

---

# 40. Risk Approval

```ts
interface RiskDecision {
  approved: boolean;

  state:
    | "NORMAL"
    | "DEGRADED"
    | "HEDGE_ONLY"
    | "EXIT_ONLY"
    | "EMERGENCY_EXIT"
    | "HALTED";

  violations: RiskViolation[];

  approvedNotional?: Decimal;
}
```

The execution engine cannot proceed unless:

```text
approved == true
```

---

# 41. Execution Plan

```ts
interface ExecutionPlan {
  id: string;

  intentId: string;

  steps: ExecutionStep[];

  estimatedCost: Decimal;

  maximumCost: Decimal;

  expiresAt: number;
}
```

Example:

```text
1. Open/increase OKX short
2. Confirm fill
3. Refresh portfolio
4. Recalculate delta
5. Confirm delta within target
```

---

# 42. Why Hedge First?

For a strategy whose LP exposure is already live, hedge-first is generally the safer rebalance ordering when increasing protection.

Example:

```text
LP:
+2.0 ETH delta

Current hedge:
-1.5 ETH

Need:
-0.5 ETH
```

The safer sequence is:

```text
increase hedge
→ confirm
→ change LP
```

rather than:

```text
change LP
→ hope hedge succeeds
```

The exact ordering may differ for entry/exit operations and must be represented by an explicit strategy-specific execution policy.

---

# 43. Partial Failure

Example:

```text
LP transaction succeeds

OKX hedge fails
```

The system must transition to:

```text
HEDGE_ONLY
```

and attempt a risk-reducing hedge.

It must not continue with normal strategy operations.

---

# 44. Circuit Breaker

```ts
enum SystemState {
  NORMAL,
  DEGRADED,
  HEDGE_ONLY,
  EXIT_ONLY,
  EMERGENCY_EXIT,
  HALTED
}
```

Triggers include:

```text
stale price
oracle divergence
OKX unavailable
LP state unknown
unexpected position
reconciliation failure
large loss
liquidation proximity
execution failure
```

---

# 45. Risk Rules

V1 minimum rules:

```text
MAX_CAPITAL
MAX_POSITION_NOTIONAL
MAX_LEVERAGE
MAX_NET_DELTA
MAX_DELTA_PERCENT
MAX_SLIPPAGE
MAX_PRICE_IMPACT
MAX_DAILY_LOSS
MAX_DRAWDOWN
MAX_MARGIN_UTILIZATION
MIN_LIQUIDATION_DISTANCE
MAX_UNHEDGED_TIME
MAX_FUNDING_RATE
MAX_GAS
```

---

# 46. Risk Evaluation Order

Before execution:

```text
1. System state
2. Market-data health
3. Position reconciliation
4. Portfolio valuation
5. Delta
6. Requested notional
7. Leverage
8. Margin
9. Liquidation distance
10. Slippage
11. Liquidity
12. Funding
13. Gas
14. Strategy constraints
15. Execution expiration
```

Any critical failure rejects execution.

---

# 47. Liquidation Distance

The risk engine must use venue-specific liquidation data where available.

It should not invent a universal liquidation formula.

Store:

```text
liquidationPrice
markPrice
distanceAbsolute
distancePercent
```

For example:

```text
distancePercent =
abs(markPrice - liquidationPrice)
/
markPrice
```

The exact risk interpretation must account for long/short direction.

---

# 48. Backtester Architecture

The live strategy must be reusable in simulation.

```text
Strategy
   ↓
Interfaces
   ↓
Simulation Adapters
```

Simulation adapters:

```text
SimulatedPriceProvider
SimulatedDexVenue
SimulatedDerivativesVenue
SimulatedExecutionEngine
```

Production adapters:

```text
LivePriceProvider
UniswapVenue
OKXVenue
LiveExecutionEngine
```

The strategy itself should not know which environment it is running in.

---

# 49. Backtest Event Loop

```text
Historical Event
       ↓
Update Market State
       ↓
Update LP State
       ↓
Update Funding
       ↓
Update Portfolio
       ↓
Calculate Delta
       ↓
Evaluate Strategy
       ↓
Evaluate Risk
       ↓
Simulate Execution
       ↓
Update Positions
       ↓
Record Snapshot
```

---

# 50. Backtest Execution Model

The simulator must model:

```text
spread
slippage
fees
gas
latency
partial fills
funding
price impact
```

A backtest that assumes:

```text
executionPrice = midPrice
```

is insufficient for production decision-making.

---

# 51. Finite-Difference Delta Test

For each LP state:

```text
P_minus = P * (1 - epsilon)

P_plus = P * (1 + epsilon)
```

Calculate:

```text
V_minus
V_plus
```

Then:

```text
delta_fd =
(V_plus - V_minus)
/
(P_plus - P_minus)
```

Compare against:

```text
delta_analytic
```

Acceptance:

```text
abs(delta_analytic - delta_fd)
<= configured tolerance
```

The tolerance must be relative to portfolio size and numerical precision.

---

# 52. Property-Based Tests

Generate randomized:

```text
price
tickLower
tickUpper
liquidity
token decimals
```

Then assert:

```text
amount0 >= 0
amount1 >= 0
liquidity >= 0
```

and:

```text
price below range
→ amount1 ≈ 0

price above range
→ amount0 ≈ 0
```

Also test continuity around range boundaries.

---

# 53. Delta Invariants

At the lower boundary:

```text
inside-range delta
≈ below-range delta
```

At the upper boundary:

```text
inside-range delta
≈ above-range delta
```

Within numerical tolerance.

These are extremely valuable tests.

---

# 54. Portfolio Invariants

The system must enforce:

```text
NAV =
cash
+ spot value
+ LP value
+ derivative equity
```

within accounting tolerance.

Also:

```text
netDelta =
sum(position deltas)
```

within numerical tolerance.

---

# 55. Accounting Event Model

Every financial change becomes an event.

Examples:

```text
DEPOSIT
WITHDRAWAL
LP_MINT
LP_INCREASE
LP_DECREASE
LP_FEE_COLLECTION
PERP_OPEN
PERP_INCREASE
PERP_DECREASE
PERP_CLOSE
FUNDING_PAYMENT
TRADING_FEE
GAS_PAYMENT
REWARD_RECEIVED
```

This provides an auditable P&L history.

---

# 56. Database Schema

Minimum tables:

```text
assets
markets
pools
lp_positions
derivative_positions
balances
orders
fills
transactions
funding_events
fees
rewards
portfolio_snapshots
strategy_decisions
execution_intents
execution_plans
risk_events
reconciliation_events
system_events
```

---

# 57. Immutable Execution Records

Once an execution is submitted, its core fields must not be mutated.

Store:

```text
original intent
original parameters
risk approval
simulation result
submission timestamp
venue response
fills
final state
```

Corrections should be represented as new events.

---

# 58. Idempotency

Every execution receives:

```text
operationId
```

Every venue order receives:

```text
clientOrderId
```

Retries must reuse the same logical operation identity.

The system must prevent duplicate execution caused by:

```text
network timeout
process restart
duplicate WebSocket event
REST retry
```

---

# 59. Locking

Only one strategy execution may mutate the same portfolio/asset concurrently.

Example lock:

```text
strategy:univ3-eth-usdc:ETH
```

Use PostgreSQL advisory locks or Redis distributed locks with careful failure handling.

Database state remains authoritative.

---

# 60. State Recovery

On startup:

```text
1. Load latest portfolio snapshot.
2. Load unfinished executions.
3. Query blockchain.
4. Query OKX.
5. Reconcile.
6. Resolve unknown states.
7. Only then enable strategy evaluation.
```

The bot must never resume trading immediately after restart.

---

# 61. Startup State Machine

```text
STARTING
   ↓
LOADING_STATE
   ↓
RECONCILING
   ↓
MARKET_DATA_HEALTH_CHECK
   ↓
RISK_HEALTH_CHECK
   ↓
READY
```

Failure:

```text
RECONCILIATION_FAILED
→ HALTED
```

---

# 62. Market Data Health

Health checks:

```text
source freshness
source divergence
WebSocket connected
RPC latency
block freshness
OKX connectivity
```

Expose:

```text
marketDataHealthy: boolean
```

---

# 63. Blockchain Provider

The Base provider must support:

```text
latest block
logs
contract reads
transaction simulation
gas estimation
transaction submission
receipt tracking
```

Use multiple RPC endpoints where possible.

Provider failover must be tested.

---

# 64. Reorg Handling

The blockchain layer must distinguish:

```text
observed
confirmed
finalized
```

LP/accounting state should not be considered irreversible merely because a transaction received a receipt.

The confirmation policy must be configurable.

---

# 65. Uniswap V3 Adapter

Required read functions:

```text
getPool()
getSlot0()
getLiquidity()
getTickSpacing()
getTicks()
getPosition()
getTokenMetadata()
```

Required write functions for later gates:

```text
mint()
increaseLiquidity()
decreaseLiquidity()
collect()
burn()
```

Gate 1 only needs read/math functionality.

---

# 66. Pool State

```ts
interface PoolState {
  address: string;

  token0: Asset;
  token1: Asset;

  feeTier: number;
  tickSpacing: number;

  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;

  timestamp: number;
  blockNumber: bigint;
}
```

---

# 67. LP Calculator

```ts
interface LiquidityCalculator {
  amounts(
    position: LiquidityPosition,
    pool: PoolState
  ): {
    amount0: Decimal;
    amount1: Decimal;
  };

  value(
    position: LiquidityPosition,
    pool: PoolState,
    prices: PriceState
  ): Decimal;

  delta(
    position: LiquidityPosition,
    pool: PoolState,
    prices: PriceState
  ): DeltaResult;
}
```

---

# 68. Delta Result

```ts
interface DeltaResult {
  asset: Asset;

  delta: Decimal;

  method:
    | "ANALYTICAL"
    | "FINITE_DIFFERENCE";

  confidence: Decimal;

  timestamp: number;
}
```

For Gate 1:

```text
ANALYTICAL
```

is the production value.

Finite difference is used as an independent test/reference implementation.

---

# 69. Independent Reference Implementation

This is important.

Create two implementations:

```text
productionDelta()
referenceDelta()
```

They should not share the same internal formulas.

The reference version can be slower and use finite differences.

This helps detect bugs in the production implementation.

---

# 70. Hedge Router

Future abstraction:

```ts
interface HedgeRouter {
  quote(
    requirement: HedgeRequirement
  ): Promise<HedgeQuote[]>;

  select(
    quotes: HedgeQuote[]
  ): Promise<HedgeQuote>;
}
```

Potential venues:

```text
OKX
Hyperliquid
GMX
dYdX
```

V1 only implements:

```text
OKX
```

---

# 71. Hedge Quote

```ts
interface HedgeQuote {
  venue: string;
  instrument: string;

  side: "BUY" | "SELL";

  quantity: Decimal;

  expectedPrice: Decimal;

  spreadCost: Decimal;
  feeCost: Decimal;

  expectedFunding: Decimal;

  liquidityScore: Decimal;

  timestamp: number;
}
```

---

# 72. Future Multi-Venue Optimization

Eventually:

```text
minimize:

execution cost
+
funding cost
+
venue risk
+
liquidation risk
```

subject to:

```text
required delta
max venue exposure
max leverage
minimum liquidity
```

But this optimization is explicitly **not part of Gate 1**.

---

# 73. Strategy Entry Model

The V1 strategy should calculate:

```text
expected LP fee yield
expected funding
expected gas
expected rebalance cost
expected slippage
expected IL
```

Then:

```text
expectedNetYield
```

must exceed:

```text
minimumExpectedNetYield
```

before entry.

---

# 74. No APR-Only Decisions

The system must never accept:

```text
APR = 80%
→ ENTER
```

Instead:

```text
LP fees
+ incentives
+ funding
- gas
- fees
- slippage
- expected rebalance costs
- expected adverse selection
```

must be evaluated.

---

# 75. Risk Budget

The strategy receives a capital budget.

Example:

```yaml
capital:
  maxUsd: 10000
```

The strategy cannot allocate more than this regardless of its internal calculation.

---

# 76. Capital Reservation

Before submitting a multi-step execution:

```text
reserve capital
```

The reservation remains active until:

```text
execution completes
or
execution expires
```

This prevents concurrent strategies from spending the same capital.

---

# 77. Emergency Exit

Emergency exit must be deterministic.

Example:

```text
1. Stop strategy entries.
2. Cancel eligible open orders.
3. Increase/reduce hedge as necessary.
4. Remove LP liquidity.
5. Collect available fees where safe.
6. Convert residual risk toward configured base asset.
7. Reconcile.
8. Halt.
```

The exact sequence must be tested on a fork before production.

---

# 78. Emergency Exit Is Not Guaranteed

The system must explicitly recognize:

```text
liquidity risk
gas risk
RPC failure
venue outage
slippage
smart-contract failure
```

"Emergency exit" means:

> attempt configured risk-reduction actions.

It must never be presented as a guarantee of liquidation-free exit.

---

# 79. Secrets

Required environment variables:

```text
BASE_RPC_URL
OKX_API_KEY
OKX_SECRET_KEY
OKX_PASSPHRASE
DATABASE_URL
REDIS_URL
```

Never commit:

```text
.env
private keys
API credentials
seed phrases
```

---

# 80. OKX API Permissions

Production API credentials should have the minimum permissions required.

Trading and withdrawal capabilities must be separated.

If withdrawals are unnecessary, the trading API must not have withdrawal permissions.

OKX's current documentation explicitly distinguishes API permissions and authenticated usage, so deployment configuration should reflect least privilege. ([OKX][1])

---

# 81. Logging

Every strategy decision:

```text
strategyId
portfolioVersion
delta
targetDelta
riskState
decision
reason
```

Every execution:

```text
executionId
operationId
venue
instrument
side
quantity
expectedPrice
actualPrice
fees
slippage
result
```

---

# 82. Metrics

Prometheus metrics:

```text
portfolio_nav_usd
portfolio_net_delta
portfolio_gross_delta
portfolio_drawdown
lp_value_usd
hedge_notional_usd
funding_pnl_usd
fees_usd
gas_usd
rebalance_count
rebalance_cost_usd
time_unhedged_seconds
risk_breach_total
execution_failure_total
reconciliation_failure_total
```

---

# 83. Alerts

Critical:

```text
LIQUIDATION_RISK
RECONCILIATION_FAILURE
UNEXPECTED_POSITION
LARGE_DRAWDOWN
ORACLE_DIVERGENCE
EXECUTION_FAILURE
SYSTEM_HALTED
```

Warning:

```text
HIGH_FUNDING
HIGH_GAS
LOW_LIQUIDITY
HIGH_SLIPPAGE
WEBSOCKET_DISCONNECTED
```

---

# 84. REST Control API

Minimal internal API:

```text
GET  /health
GET  /status
GET  /portfolio
GET  /positions
GET  /risk
GET  /strategies
GET  /executions

POST /control/pause
POST /control/resume
POST /control/kill
POST /control/exit
```

Control endpoints require authentication.

---

# 85. Dashboard

V1 dashboard:

```text
NAV
Net Delta
LP Value
Hedge Value
Funding
Fees
P&L
Drawdown
Risk State
Liquidation Distance
Last Reconciliation
Last Execution
```

The dashboard is observational.

It should not be the only control plane.

---

# 86. Repository Structure

```text
delta-neutral-engine/

├── apps/
│   ├── worker/
│   ├── api/
│   ├── backtester/
│   └── cli/
│
├── packages/
│   ├── domain/
│   ├── math/
│   ├── portfolio/
│   ├── risk/
│   ├── strategy/
│   ├── execution/
│   ├── market-data/
│   ├── venues/
│   │   ├── uniswap-v3/
│   │   └── okx/
│   ├── persistence/
│   ├── monitoring/
│   └── config/
│
├── tests/
│   ├── unit/
│   ├── property/
│   ├── integration/
│   └── fork/
│
├── infra/
│   ├── docker/
│   ├── postgres/
│   └── monitoring/
│
├── docs/
│
├── .env.example
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

# 87. Package Boundaries

`domain`

Contains pure types.

Must have zero infrastructure dependencies.

`math`

Contains deterministic financial mathematics.

Must be pure.

`portfolio`

Combines positions and valuations.

`strategy`

Determines desired state.

`risk`

Vetoes unsafe state changes.

`execution`

Converts approved intents into actions.

`venues`

Talk to external protocols.

`persistence`

Stores state.

`monitoring`

Observability only.

---

# 88. Dependency Direction

Allowed:

```text
domain
  ↑
math
  ↑
portfolio
  ↑
strategy
  ↑
risk
  ↑
execution
  ↑
venues
```

But strategy should not directly depend on:

```text
OKX SDK
Uniswap SDK
database
Redis
```

Instead it depends on interfaces.

---

# 89. Pure Math Requirement

These functions must be pure:

```text
tickToSqrtPrice
sqrtPriceToPrice
liquidityAmounts
lpValue
lpDelta
perpDelta
netDelta
finiteDifferenceDelta
```

Given identical inputs:

```text
same output
```

No network calls.

No database.

No clock.

---

# 90. Gate 1 Test Suite

Minimum:

```text
tick conversion
price normalization
token decimals
below-range LP
inside-range LP
above-range LP
lower boundary
upper boundary
LP value
LP delta
perp delta
net delta
finite difference
delta convergence
portfolio aggregation
```

---

# 91. Gate 1 Property Tests

At minimum:

```text
amounts are non-negative
price normalization round-trips
tick conversion remains monotonic
delta finite-difference convergence
boundary continuity
portfolio delta is additive
```

---

# 92. Gate 1 Acceptance Test

Given a known:

```text
pool
tick
liquidity
range
token decimals
```

the engine must produce:

```text
amount0
amount1
value
delta
```

and:

```text
analyticalDelta ≈ finiteDifferenceDelta
```

within the documented tolerance.

No OKX execution is required for Gate 1.

---

# 93. Gate 2 Backtester Acceptance

The backtester must run the same strategy implementation against simulated market data.

It must produce:

```text
NAV curve
delta curve
drawdown
funding
fees
gas
rebalance events
```

The backtest must be deterministic given:

```text
same data
same configuration
same seed
```

---

# 94. Gate 3 Fork Acceptance

The Base fork must demonstrate:

```text
read real pool
read real LP position
simulate LP changes
simulate token transfers
simulate swaps
```

All transaction paths must be tested against realistic state.

---

# 95. Gate 4 OKX Demo Acceptance

The OKX adapter must demonstrate:

```text
authenticate
read account
read position
read instrument
read mark/index
read funding
submit demo order
receive order update
receive position update
cancel order
reconcile
```

OKX's current API exposes the relevant REST and private WebSocket primitives, including order, position, account and trading functionality. ([OKX][1])

---

# 96. Gate 5 Shadow Acceptance

Run against live market conditions without submitting trades.

For every hypothetical trade record:

```text
decision time
portfolio delta
target delta
hypothetical order
expected execution
subsequent market movement
hypothetical P&L
```

The system must run continuously without state corruption.

---

# 97. Gate 6 Production Criteria

Before live capital:

```text
all Gate 1 tests pass
all Gate 2 tests pass
fork tests pass
OKX demo tests pass
shadow mode stable
reconciliation stable
kill switch tested
restart recovery tested
failure tests pass
```

Production capital must initially be limited by hard-coded deployment policy/configuration outside the strategy.

---

# 98. What NOT to Implement Yet

Do not add:

```text
cross-chain
multiple hedge venues
AI strategy selection
automatic reward compounding
Flashbots
complex MEV optimization
options
machine learning
multi-strategy capital allocation
```

until the core portfolio accounting is proven.

Complexity should be earned.

---

# 99. First Implementation Order

The coding agent should implement in this exact order:

```text
1. Monorepo
2. Domain types
3. Decimal utilities
4. Uniswap price/tick math
5. LP amount calculator
6. LP valuation
7. LP analytical delta
8. Finite-difference reference delta
9. Delta test suite
10. Portfolio aggregator
11. Perpetual position model
12. Net delta engine
13. Hedge calculation
14. Risk interfaces
15. PostgreSQL schema
16. Portfolio snapshots
17. Reconciliation interfaces
18. Backtester interfaces
19. Documentation
```

Only after all of these pass should the implementation proceed to external APIs.

---

# 100. First Coding-Agent Prompt

The implementation agent should receive this instruction:

> Implement Gate 1 only.
>
> Do not implement live trading.
>
> Do not implement OKX order submission.
>
> Do not implement automated LP transactions.
>
> Do not add cross-chain functionality.
>
> Build the domain model, deterministic Uniswap V3 mathematics, portfolio aggregation, LP delta engine, perpetual delta model, hedge calculation, persistence interfaces, and comprehensive tests.
>
> All financial calculations must avoid JavaScript floating-point arithmetic.
>
> Implement an independent finite-difference reference delta calculator and compare it against the analytical implementation.
>
> Include property-based tests around price ranges and LP boundaries.
>
> The project must compile with strict TypeScript settings.
>
> No strategy may directly call a venue.
>
> No venue implementation may be imported by the math package.
>
> Every test must be deterministic.

---

# 101. Definition of Done for Gate 1

Gate 1 is complete only when:

```text
[ ] TypeScript strict compilation passes
[ ] Unit tests pass
[ ] Property tests pass
[ ] LP amount calculation passes
[ ] LP valuation passes
[ ] Analytical delta passes
[ ] Finite-difference delta agrees
[ ] Boundary tests pass
[ ] Portfolio aggregation passes
[ ] Perpetual delta passes
[ ] Net delta passes
[ ] Hedge requirement passes
[ ] No floating-point financial calculations
[ ] No live trading code
[ ] Documentation exists
[ ] Example fixtures exist
[ ] Deterministic test suite exists
```

---

# 102. Final Architecture

The complete system should ultimately become:

```text
                    ┌──────────────────────┐
                    │ Opportunity Engine   │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Strategy Engine      │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Target Portfolio     │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Portfolio Engine     │
                    │                      │
                    │ valuation             │
                    │ delta                 │
                    │ PnL                   │
                    │ reconciliation        │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Risk Engine           │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Execution Planner     │
                    └──────────┬───────────┘
                               ↓
                 ┌─────────────┴──────────────┐
                 ↓                            ↓
        ┌─────────────────┐          ┌─────────────────┐
        │ On-chain        │          │ Derivatives     │
        │ Execution       │          │ Execution       │
        │                 │          │                 │
        │ Uniswap V3      │          │ OKX             │
        │ Base            │          │ Perpetuals      │
        └─────────────────┘          └─────────────────┘
```

The most important boundary is:

```text
Strategy
   ≠
Portfolio
   ≠
Risk
   ≠
Execution
   ≠
Venue
```

If those boundaries remain clean, the system can eventually evolve from:

```text
Base + Uniswap V3 + OKX
```

into:

```text
Base
Ethereum
Arbitrum

Uniswap
Aerodrome
Curve
Balancer

OKX
Hyperliquid
GMX
dYdX
```

without rewriting the mathematical core.

---

# 103. The Strategic End State

The eventual product should solve:

```text
maximize expected risk-adjusted net yield
```

subject to:

```text
net delta constraint
liquidity constraint
leverage constraint
margin constraint
drawdown constraint
execution-cost constraint
venue-risk constraint
capital constraint
```

The important realization is that **delta neutrality is a constraint, not the strategy itself**.

The strategy is:

```text
find attractive yield
```

while:

```text
controlling market exposure
controlling execution risk
controlling liquidation risk
controlling smart-contract risk
```

That distinction gives the system room to eventually support LP farming, funding arbitrage, basis trades, stablecoin strategies, and other market-neutral structures without rebuilding the core.

---

# 104. Immediate Engineering Deliverable

The first repository produced from this specification should contain:

```text
src/
tests/
package.json
tsconfig.json
.env.example
docker-compose.yml
README.md
```

and should be capable of running:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

with no external trading credentials.

The first successful output should be a deterministic report similar to:

```text
Portfolio
────────────────────────────
ETH LP value:          $X
ETH amount:            X
USDC amount:           X

LP delta:              +X ETH
Perp delta:            -X ETH
Net delta:             +X ETH

Target delta:           0 ETH
Required hedge:        -X ETH

Analytical delta:      X
Finite-difference:     X
Error:                 X%

Status:                PASS
```

That is the foundation on which every later component should be built.

The key thing I'd **not** do next is jump straight into the OKX order-placement code. The highest-risk component is actually the **Uniswap V3 LP accounting + delta math**. If that says `+2.0 ETH` when the real portfolio behaves like `+1.4 ETH`, every subsequent risk and hedge decision can be wrong while the software still appears to work.

So the correct next implementation target is **Gate 1 exactly as specified above**, then use the resulting engine unchanged inside the backtester, Base fork, OKX demo environment, and eventually live system.

[1]: https://www.okx.com/docs-v5/?utm_source=chatgpt.com "Overview – OKX API guide | OKX technical support | OKX"
[2]: https://atiselsts.github.io/pdfs/uniswap-v3-liquidity-math.pdf?utm_source=chatgpt.com "LIQUIDITY MATH IN UNISWAP V3"
