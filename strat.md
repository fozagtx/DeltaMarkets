Yes. After looking at the architecture again—and checking the current OKX API/OnchainOS capabilities—I would **rebuild the PRD around an OKX-first execution and orchestration layer**, rather than treating OKX as just another connector.

OKX currently provides REST/WebSocket trading APIs, demo trading, perpetuals, account/position data, and order-management infrastructure; its OnchainOS DEX API also provides DEX aggregation, swap instructions, simulation/broadcasting, and on-chain market data. ([OKX][1])

The key architectural change is: **the product is not a “multi-DEX farming bot.” It is a delta-neutral portfolio system whose first strategy happens to use LP + perpetual hedging.**

# Product Requirements Document — Delta-Neutral DeFi Portfolio Engine

# Delta-Neutral DeFi Portfolio Engine

**Version:** 1.0
**Status:** Proposed
**Primary implementation:** TypeScript / Node.js
**Initial execution venue:** OKX
**Initial chain:** Base
**Initial strategy:** Uniswap V3 concentrated-liquidity position + perpetual hedge
**Initial operating mode:** Simulation → paper/shadow → demo → limited production

---

## 1. Executive Summary

Build an automated portfolio-management engine that seeks to earn DeFi liquidity-provider fees, incentives, and derivatives funding while maintaining controlled market exposure.

The system will initially operate on:

* Base
* Uniswap V3
* OKX perpetual futures
* One primary asset pair, initially ETH/USDC
* One wallet
* One strategy

The system must calculate the actual delta of the on-chain LP position, determine the required derivative hedge, evaluate execution and risk costs, and execute only when the expected benefit justifies the transaction and trading costs.

The architecture must support additional DEXs, chains, hedge venues, and strategies without changing the portfolio or risk engines.

### Core principle

The system should never think:

> "The strategy told me to short 2 ETH."

It should think:

> "The portfolio currently has +2.37 ETH delta. The target is approximately zero. Given execution cost, funding, liquidity, and risk limits, the optimal hedge is 2.1 ETH."

This distinction is fundamental to the design.

---

# 2. Problem Statement

Delta-neutral DeFi strategies are difficult because the portfolio's exposure changes continuously.

A concentrated-liquidity position is not equivalent to simply holding a fixed amount of the underlying asset.

As market price changes:

* token composition changes
* LP delta changes
* LP value changes
* fee generation changes
* impermanent-loss characteristics change
* range utilization changes

At the same time, the hedge has:

* mark-to-market P&L
* funding costs/income
* execution costs
* liquidation risk
* exchange/venue risk

Therefore the system needs to continuously reconcile:

```text
Actual portfolio exposure
        ↓
Target exposure
        ↓
Required hedge
        ↓
Risk constraints
        ↓
Execution cost
        ↓
Optimal action
```

---

# 3. Product Goals

## 3.1 Primary goals

The system must:

1. Calculate portfolio net delta accurately.
2. Model concentrated-liquidity positions correctly.
3. Maintain configurable delta bounds.
4. Hedge using perpetual futures.
5. Account for funding, fees, gas, slippage and execution costs.
6. Prevent trades that violate risk limits.
7. Reconcile expected state against actual venue/blockchain state.
8. Support simulation and historical backtesting.
9. Operate safely after process restarts.
10. Provide complete auditability of decisions and executions.
11. Support additional venues through adapters.
12. Fail closed when market data, execution or reconciliation becomes unreliable.

---

# 4. Non-Goals for V1

The following are explicitly out of scope for the first production version:

* Cross-chain strategies
* Multiple simultaneous LP strategies
* Options hedging
* Automated leverage optimization
* Autonomous withdrawal of funds
* Autonomous bridging
* Complex reward-token farming
* AI-generated trading decisions
* Machine-learning prediction models
* High-frequency market making
* Flash-loan strategies
* Fully autonomous strategy discovery

These can be added later.

---

# 5. Initial Strategy

## 5.1 Strategy

### Uniswap V3 LP + OKX perpetual hedge

The portfolio:

```text
LONG:
Uniswap V3 ETH/USDC LP

SHORT:
ETH perpetual on OKX
```

Target:

```text
ETH net delta ≈ 0
```

Example:

```text
LP delta:
+2.35 ETH

Target:
0 ETH

Required hedge:
-2.35 ETH
```

However, the execution engine must not blindly execute the entire difference.

It must first evaluate:

```text
delta deviation
+
execution cost
+
funding
+
slippage
+
gas
+
liquidity
+
risk limits
```

---

# 6. Product Architecture

```text
                    ┌────────────────────────┐
                    │     Strategy Engine    │
                    │                        │
                    │ Entry / Exit / Targets │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   Portfolio Engine     │
                    │                        │
                    │ Delta / PnL / Exposure │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │     Risk Engine         │
                    │                        │
                    │ Limits / Circuit Break │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   Execution Planner     │
                    │                        │
                    │ Target → Trade Plan     │
                    └────────────┬───────────┘
                                 │
                ┌────────────────┴────────────────┐
                ▼                                 ▼
       ┌────────────────┐                ┌────────────────┐
       │ On-chain       │                │ Derivatives    │
       │ Execution      │                │ Execution      │
       │                │                │                │
       │ Uniswap V3     │                │ OKX            │
       │ OKX OnchainOS  │                │ Perpetuals     │
       └────────────────┘                └────────────────┘
```

---

# 7. Core Design Principle: Target Portfolio

Strategies must not directly place orders.

Instead, strategies produce a desired portfolio state.

Example:

```json
{
  "asset": "ETH",
  "targetDelta": 0,
  "maxDelta": 0.02
}
```

The portfolio engine calculates:

```text
currentDelta = +2.37 ETH

targetDelta = 0

deltaError = +2.37 ETH
```

The hedge optimizer then determines the appropriate action.

This allows the same strategy to work with:

* OKX
* Hyperliquid
* GMX
* another derivatives venue

without changing strategy logic.

---

# 8. Domain Model

## 8.1 Position

Each position must contain:

```text
positionId
venue
chain
asset
quantity
notional
entryPrice
markPrice
delta
gamma
unrealizedPnL
realizedPnL
fees
funding
margin
leverage
timestamp
```

---

## 8.2 Portfolio

The portfolio is the authoritative logical representation of the entire system.

It contains:

```text
balances
positions
liabilities
pendingOrders
pendingTransactions
fees
funding
rewards
PnL
netDelta
grossDelta
netNotional
marginUtilization
liquidationDistance
```

---

# 9. Delta Engine

The delta engine is a critical subsystem.

It must calculate delta independently for:

* spot
* perpetuals
* Uniswap V3 LPs
* future options
* other derivatives

### Basic portfolio equation

```text
Net Delta =
    Spot Delta
  + LP Delta
  + Perpetual Delta
  + Options Delta
  + Other Delta
```

For a linear perpetual:

```text
perpDelta ≈ positionSize
```

For a concentrated-liquidity position, the engine must derive the current token amounts from the active liquidity and price range rather than treating the LP as a static spot position.

The engine must also expose:

```text
delta
deltaPercent
grossDelta
netDelta
targetDelta
deltaError
```

---

# 10. Hedge Engine

The hedge engine receives:

```text
currentDelta
targetDelta
allowedDeviation
venueLiquidity
fundingRate
fees
slippage
margin
riskLimits
```

It returns:

```text
HedgeDecision
```

Example:

```text
requiredDelta: -2.37 ETH

recommendedDelta: -2.10 ETH

reason:
execution cost exceeds benefit of full rebalance
```

The hedge engine must support hysteresis.

Example:

```text
Start hedging:
±2%

Stop/rebalance:
±0.5%
```

The thresholds must be configurable.

---

# 11. Cost-Aware Rebalancing

The system must not rebalance merely because delta is non-zero.

It should evaluate:

```text
Expected risk reduction
>
Execution cost
```

Execution cost includes:

* trading fees
* spread
* slippage
* gas
* funding impact
* expected price impact

This prevents excessive hedge churn.

---

# 12. OKX Integration

OKX will be the first derivatives execution venue.

The integration must use authenticated REST and WebSocket interfaces where appropriate.

OKX supports account, instrument, order, fills, position and market-data APIs, plus demo trading infrastructure. ([OKX][1])

The adapter must support:

```text
getAccount()
getBalances()
getPositions()
getInstrument()
getMarkPrice()
getIndexPrice()
getOrderBook()
getFundingRate()
getOpenOrders()

placeOrder()
cancelOrder()
amendOrder()
closePosition()

subscribeOrders()
subscribePositions()
subscribeAccount()
subscribeMarketData()
```

The adapter must not expose OKX-specific concepts to the strategy layer.

---

# 13. On-chain Execution

The initial chain is Base.

The initial DEX is Uniswap V3.

The on-chain adapter must support:

```text
pool discovery
token metadata
pool state
slot0
liquidity
ticks
position state
LP valuation
LP delta
mint
increase liquidity
decrease liquidity
collect fees
burn
```

OKX OnchainOS may be used where it improves routing, market data, swap execution, simulation or transaction infrastructure. Its DEX API currently provides DEX aggregation, swap instructions, transaction simulation/broadcasting and on-chain market data. ([OKX Wallet][2])

However:

**OKX OnchainOS must remain an infrastructure dependency, not the portfolio abstraction.**

---

# 14. Execution Planner

The strategy never executes directly.

It creates an intended state:

```text
Target:
ETH delta = 0
```

The execution planner converts this into an ordered plan.

Example:

```text
ExecutionPlan

1. Verify current LP state
2. Calculate current LP delta
3. Calculate required hedge
4. Check OKX liquidity
5. Check risk limits
6. Simulate hedge
7. Submit hedge
8. Confirm hedge
9. Recalculate portfolio
10. Execute LP adjustment if required
11. Reconcile
```

The planner must support partial failure.

---

# 15. Transaction / Order State Machine

Every execution must have an explicit state.

```text
PROPOSED
   ↓
RISK_APPROVED
   ↓
SIMULATED
   ↓
SUBMITTED
   ↓
PARTIALLY_FILLED
   ↓
FILLED
   ↓
RECONCILED
```

Failure states:

```text
REJECTED
FAILED
EXPIRED
CANCELLED
RECONCILIATION_FAILED
```

No execution should disappear from the system merely because an API call failed.

---

# 16. Reconciliation Engine

The system must continuously compare:

```text
Expected State
      vs
Observed State
```

Sources:

```text
Blockchain
OKX
Database
WebSocket events
REST reconciliation
```

Example:

```text
Database:
OKX short = -2.50 ETH

OKX:
actual short = -2.10 ETH

→ STATE_MISMATCH
```

When reconciliation fails:

```text
Stop opening new positions.
Stop compounding.
Allow only risk-reducing actions.
Alert operator.
```

Severe reconciliation failure should trigger `EXIT_ONLY`.

---

# 17. Risk Engine

Risk checks are mandatory before execution.

## 17.1 Position limits

```text
maxCapital
maxLPNotional
maxHedgeNotional
maxGrossExposure
maxLeverage
```

## 17.2 Delta limits

```text
maxNetDelta
maxDeltaPercent
maxUnhedgedDuration
```

## 17.3 Execution limits

```text
maxSlippage
maxPriceImpact
maxSpread
maxGas
maxOrderSize
```

## 17.4 Derivatives limits

```text
maxMarginUtilization
minimumLiquidationDistance
maximumFundingRate
maxVenueExposure
```

## 17.5 Portfolio limits

```text
maxDailyLoss
maxDrawdown
maxStrategyLoss
maxCapitalAtRisk
```

---

# 18. Circuit Breaker

The system must use a state machine.

```text
NORMAL
   ↓
DEGRADED
   ↓
HEDGE_ONLY
   ↓
EXIT_ONLY
   ↓
EMERGENCY_EXIT
   ↓
HALTED
```

### NORMAL

Full operation.

### DEGRADED

Market-data or execution quality is impaired.

No new capital deployment.

### HEDGE_ONLY

Only actions reducing delta are allowed.

### EXIT_ONLY

No new positions.

Positions may only be reduced.

### EMERGENCY_EXIT

Close hedge and remove LP according to configured emergency policy.

### HALTED

No automated trading.

Human intervention required.

---

# 19. Kill Switch

The system must provide:

```text
POST /control/kill
```

and a secure administrative command.

Kill switch behavior must be configurable.

Minimum behavior:

```text
disable new positions
disable compounding
disable strategy entries
continue monitoring
continue reconciliation
```

Emergency mode may additionally unwind positions.

The kill switch must not depend solely on the same process being killed.

---

# 20. Market Data Layer

Market data must be separated from execution.

Required data:

```text
spot price
index price
mark price
order book
funding rate
gas
pool liquidity
pool price
tick state
volatility
```

The system must timestamp every observation.

Price sources must have health checks.

If:

```text
price source A
vs
price source B
```

diverge beyond a configurable threshold:

```text
MARKET_DATA_DEGRADED
```

---

# 21. Funding Engine

Funding must be treated as a first-class P&L component.

Track:

```text
fundingRate
fundingInterval
fundingPaid
fundingReceived
annualizedFunding
expectedFunding
realizedFunding
```

The strategy's expected yield calculation must include funding.

---

# 22. Yield Engine

The yield engine tracks:

```text
LP trading fees
incentives
reward tokens
funding
gas
execution fees
slippage
```

The system must calculate:

```text
grossYield
netYield
realizedYield
unrealizedYield
annualizedNetYield
```

Rewards should not automatically be treated as profit until their liquidity and realizable value are established.

---

# 23. Strategy Economics

The strategy scorer should calculate:

```text
Expected Net Return =
LP fees
+ incentives
+ funding
- gas
- swap fees
- LP costs
- hedge costs
- slippage
- expected IL
- estimated rebalance cost
```

The system must never rank strategies solely by advertised APR.

---

# 24. Backtesting

The backtester must use the same strategy interfaces as production.

Architecture:

```text
             Strategy
                │
       ┌────────┴────────┐
       │                 │
 Simulation           Production
 Environment          Environment
```

Required simulation components:

```text
historical prices
historical funding
historical pool state
LP math
fees
gas
slippage
execution latency
partial fills
hedging
```

The backtester must report:

```text
total return
annualized return
max drawdown
Sharpe
Sortino
volatility
net delta statistics
time outside delta band
funding P&L
LP fee P&L
gas
trading fees
slippage
number of rebalances
```

---

# 25. Fork Testing

The system must support a Base mainnet fork.

Required tests:

```text
create LP
increase liquidity
decrease liquidity
collect fees
price movement
cross ticks
remove LP
simulate swap
simulate failed transaction
simulate stale price
simulate hedge failure
```

No production deployment should occur before fork tests pass.

---

# 26. Shadow Mode

Before live trading:

```text
REAL MARKET DATA
       ↓
REAL PORTFOLIO OBSERVATION
       ↓
REAL STRATEGY CALCULATIONS
       ↓
HYPOTHETICAL ORDERS
       ↓
NO EXECUTION
```

The system records:

```text
what it would have traded
when it would have traded
why
expected execution price
actual market price
hypothetical P&L
```

This validates the strategy against real market conditions.

---

# 27. Demo Mode

Use OKX demo trading before production execution where applicable.

OKX currently documents a dedicated demo-trading environment and WebSocket endpoints for simulated trading. ([OKX][1])

Demo mode must be operationally isolated from production credentials.

---

# 28. Persistence

Use PostgreSQL as the authoritative persistence layer.

Core tables:

```text
accounts
assets
venues
markets
positions
orders
fills
transactions
lp_positions
funding_events
fees
rewards
prices
portfolio_snapshots
risk_events
strategy_signals
execution_plans
reconciliation_events
system_events
```

Redis may be used for:

```text
locks
ephemeral market state
rate limiting
distributed coordination
```

Redis must not be the sole source of truth for financial state.

---

# 29. Event Bus

The application should be event-driven.

Core events:

```text
PRICE_UPDATED
POOL_UPDATED
POSITION_UPDATED
ORDER_SUBMITTED
ORDER_FILLED
ORDER_FAILED
FUNDING_UPDATED
LP_UPDATED
DELTA_UPDATED
RISK_BREACH
CIRCUIT_BREAKER_TRIGGERED
RECONCILIATION_FAILED
STRATEGY_SIGNAL
EXECUTION_COMPLETED
```

---

# 30. Concurrency and Idempotency

Financial execution must be idempotent.

Every action must have:

```text
operationId
strategyId
executionPlanId
clientOrderId
timestamp
```

The system must prevent:

```text
duplicate orders
duplicate LP transactions
double reward claims
concurrent conflicting rebalances
```

Only one rebalance operation may control a particular strategy/asset at a time.

---

# 31. Wallet Security

Private keys must never exist in source code.

Support:

```text
environment-based development key
hardware wallet / signer abstraction
KMS
Fireblocks-style signer
external signer
```

Production signing must be isolated from strategy logic.

The strategy process should not have unrestricted access to private keys.

---

# 32. Configuration

Configuration should include:

```yaml
environment: paper

chain:
  name: base
  rpc: ${BASE_RPC}

strategy:
  enabled: true
  asset: ETH
  targetDelta: 0
  maxDeltaPercent: 0.02

lp:
  protocol: uniswap-v3
  pool: ${POOL_ADDRESS}
  feeTier: 500

hedge:
  venue: okx
  instrument: ETH-USDT-SWAP
  maxLeverage: 3

risk:
  maxCapital: 10000
  maxDrawdownPercent: 5
  maxSlippageBps: 30
  minLiquidationDistancePercent: 25

execution:
  dryRun: true
  maxRetries: 3
```

Secrets remain outside configuration files.

---

# 33. Observability

Every decision must be explainable.

For every trade:

```text
Why did the bot trade?
What was the portfolio delta?
What was the target?
What risk checks passed?
What price was expected?
What was actual execution?
What fees were paid?
What funding was expected?
What changed afterward?
```

Logs should use structured logging.

Recommended:

```text
Pino
```

Metrics:

```text
Prometheus-compatible
```

Dashboard:

```text
Grafana or web dashboard
```

---

# 34. Alerts

Alerts must cover:

```text
delta breach
liquidation risk
large drawdown
funding reversal
price feed divergence
transaction failure
order rejection
reconciliation failure
RPC failure
OKX WebSocket disconnect
database failure
circuit breaker activation
unexpected balance change
```

Critical alerts should require acknowledgement.

---

# 35. Security Requirements

Mandatory:

* no hardcoded private keys
* no withdrawal permissions for trading API keys
* least-privilege API permissions
* production and development credentials separated
* encrypted secrets
* IP restrictions where supported
* transaction simulation
* strict contract allowlists
* token allowlists
* chain allowlists
* venue allowlists
* spending limits
* maximum transaction value
* emergency shutdown
* audit logs

---

# 36. Smart Contract Safety

The system must never blindly interact with arbitrary contracts.

Every protocol integration must have:

```text
chainId
contract address
ABI version
verified deployment
allowed functions
```

Unknown contract addresses must be rejected.

Token approvals must use explicit limits where possible.

Unlimited approvals should not be the default.

---

# 37. Execution Safety

Before an on-chain transaction:

```text
validate chain
validate contract
validate calldata
simulate
estimate gas
validate slippage
validate deadline
validate balance
validate allowance
validate risk
```

Before a derivatives order:

```text
validate instrument
validate position size
validate margin
validate leverage
validate price
validate funding
validate order type
validate reduce-only status
validate risk
```

---

# 38. Initial Repository Structure

```text
src/
│
├── domain/
│   ├── assets/
│   ├── positions/
│   ├── portfolio/
│   ├── orders/
│   ├── markets/
│   └── risk/
│
├── strategies/
│   ├── base/
│   └── uniswap-v3-delta-neutral/
│
├── venues/
│   ├── dex/
│   │   ├── uniswap-v3/
│   │   └── okx-onchain/
│   │
│   └── derivatives/
│       └── okx/
│
├── portfolio/
│   ├── valuation/
│   ├── delta/
│   ├── pnl/
│   └── reconciliation/
│
├── risk/
│   ├── limits/
│   ├── liquidation/
│   ├── circuit-breaker/
│   └── validators/
│
├── execution/
│   ├── planner/
│   ├── executor/
│   ├── nonce/
│   ├── simulation/
│   ├── slippage/
│   └── gas/
│
├── market-data/
│   ├── prices/
│   ├── funding/
│   ├── liquidity/
│   └── oracles/
│
├── persistence/
│   ├── postgres/
│   └── redis/
│
├── monitoring/
│   ├── metrics/
│   ├── alerts/
│   └── health/
│
├── backtest/
│
├── config/
│
└── app/
    ├── live.ts
    ├── paper.ts
    ├── demo.ts
    └── backtest.ts
```

---

# 39. Core Interfaces

The architecture must be interface-first.

```text
Strategy
Portfolio
Position
DeltaCalculator
PricingProvider
DexVenue
HedgeVenue
ExecutionPlanner
ExecutionVenue
RiskEngine
ReconciliationEngine
MarketDataProvider
Signer
Persistence
Alerting
```

No strategy may import an implementation-specific OKX client.

---

# 40. Strategy Lifecycle

```text
DISCOVER
   ↓
EVALUATE
   ↓
ENTER
   ↓
ACTIVE
   ↓
REBALANCE
   ↓
EXIT
   ↓
CLOSED
```

At every stage:

```text
Risk Engine
```

has veto authority.

---

# 41. Rebalancing Algorithm

At each relevant portfolio update:

```text
1. Read current positions.
2. Read current prices.
3. Recalculate LP composition.
4. Calculate LP delta.
5. Calculate derivatives delta.
6. Calculate total portfolio delta.
7. Compare against target.
8. Calculate hedge requirement.
9. Estimate execution cost.
10. Estimate funding impact.
11. Run risk checks.
12. Determine whether rebalancing is economically justified.
13. Create execution plan.
14. Simulate.
15. Execute.
16. Confirm fills.
17. Recalculate portfolio.
18. Reconcile.
19. Persist results.
20. Alert on exceptions.
```

---

# 42. Exit Conditions

The strategy must exit when any configured condition occurs.

Examples:

```text
pool liquidity becomes unsafe
LP range becomes uneconomical
funding becomes sufficiently negative
expected net yield falls below threshold
maximum drawdown reached
risk limit breached
oracle divergence
venue unavailable
reconciliation failure
strategy disabled
manual kill switch
```

---

# 43. Strategy Entry Criteria

A strategy should only enter if:

```text
expectedNetYield > minimumYield
AND
liquidity > minimumLiquidity
AND
executionCost < maximumExecutionCost
AND
funding within bounds
AND
risk checks pass
AND
market data healthy
AND
hedge venue available
```

---

# 44. Capital Allocation

V1 supports a single strategy.

However, the portfolio model should support multiple strategy allocations:

```text
totalCapital
    ↓
risk budget
    ↓
strategy allocation
    ↓
position limits
```

Future allocation may optimize:

```text
risk-adjusted return
capital efficiency
correlation
liquidity
venue exposure
```

---

# 45. Multi-Venue Roadmap

After OKX is stable:

### V2

Add:

```text
Aerodrome
second Base strategy
```

### V3

Add:

```text
second hedge venue
```

Potentially:

```text
Hyperliquid
GMX
```

### V4

Add:

```text
strategy allocator
```

### V5

Add:

```text
cross-chain
```

Cross-chain is deliberately postponed until single-chain reconciliation and execution are proven reliable.

---

# 46. Testing Strategy

Minimum coverage:

### Unit tests

```text
LP math
delta
PnL
funding
position sizing
risk limits
rebalance thresholds
```

### Integration tests

```text
OKX API
Uniswap contracts
database
WebSockets
execution planner
```

### Fork tests

```text
real Base state
real Uniswap contracts
simulated transactions
```

### Failure tests

```text
RPC unavailable
OKX unavailable
stale price
partial fill
transaction reverted
nonce collision
database unavailable
WebSocket disconnect
unexpected position
liquidation-risk breach
```

### Property tests

Delta calculations should be tested against mathematical invariants, not only a handful of fixed examples.

---

# 47. Deployment Architecture

Initial deployment:

```text
Docker Compose

┌─────────────────────┐
│ Trading Application │
├─────────────────────┤
│ PostgreSQL          │
├─────────────────────┤
│ Redis               │
└─────────────────────┘
```

Production should eventually separate:

```text
strategy service
market-data service
execution service
risk service
database
monitoring
```

The execution service should have the strongest security boundary.

---

# 48. Operational Modes

The application must support:

```text
BACKTEST
FORK
PAPER
SHADOW
DEMO
LIVE
HALTED
```

Changing from:

```text
PAPER → LIVE
```

must require explicit configuration.

There must be no accidental production mode caused by a missing environment variable.

---

# 49. MVP Definition

The MVP is **not** "multi-DEX."

MVP is:

```text
Base
+
Uniswap V3
+
ETH/USDC
+
OKX ETH perpetual
+
accurate LP delta
+
portfolio engine
+
risk engine
+
execution planner
+
reconciliation
+
fork simulation
+
paper mode
```

The MVP is successful only when it can operate this strategy reliably without human intervention in simulation/shadow mode.

---

# 50. MVP Acceptance Criteria

The MVP must demonstrate:

### Portfolio

* correctly discovers LP position
* calculates token amounts
* calculates LP delta
* calculates hedge delta
* calculates net delta
* calculates P&L

### Strategy

* identifies entry conditions
* calculates target delta
* determines hedge requirement
* avoids unnecessary rebalances
* exits when conditions fail

### Risk

* rejects oversized positions
* rejects excessive leverage
* rejects excessive slippage
* detects liquidation risk
* activates circuit breakers

### Execution

* simulates transactions
* manages nonces
* handles partial fills
* handles retries
* records execution state

### Reconciliation

* detects mismatched positions
* freezes trading when reconciliation fails

### Operations

* survives restart
* reconstructs state from database
* emits alerts
* supports kill switch

---

# 51. Key Metrics

The dashboard must display:

```text
Portfolio NAV
Net Delta
Gross Exposure
Hedge Ratio
LP Value
Hedge Notional
Funding P&L
LP Fee P&L
Gas
Trading Fees
Slippage
Net P&L
Daily P&L
Drawdown
Margin Utilization
Liquidation Distance
Pool Liquidity
Range Utilization
Time Unhedged
Number of Rebalances
```

---

# 52. The Most Important Performance Metric

The system should not optimize simply for APR.

Primary strategy KPI:

```text
Risk-adjusted net return after all costs
```

Secondary KPIs:

```text
maximum delta deviation
time outside hedge band
maximum drawdown
execution quality
funding capture
LP fee capture
capital efficiency
```

---

# 53. Failure Philosophy

The bot must follow:

> **When uncertain, reduce risk rather than increase risk.**

Examples:

```text
Unknown position
→ do not trade

Stale price
→ do not trade

Unknown transaction status
→ reconcile

Hedge venue unavailable
→ stop new LP exposure

LP state unknown
→ stop strategy

Risk calculation unavailable
→ execution denied

Reconciliation failure
→ HEDGE_ONLY / EXIT_ONLY
```

The default failure mode is **fail closed**.

---

# 54. Security Boundary

The most sensitive component is:

```text
Execution / Signing
```

It should be isolated from:

```text
strategy logic
market scanning
analytics
dashboard
```

The ideal architecture eventually becomes:

```text
Strategy
   ↓
Unsigned Execution Intent
   ↓
Risk Service
   ↓
Execution Policy
   ↓
Signer
   ↓
Venue
```

The strategy itself never receives unrestricted signing authority.

---

# 55. Development Phases

## Phase 0 — Mathematics

Build:

```text
Uniswap V3 LP simulator
delta calculator
PnL calculator
funding model
```

No trading APIs.

---

## Phase 1 — Portfolio Engine

Build:

```text
positions
valuation
delta
PnL
persistence
reconciliation model
```

---

## Phase 2 — Backtester

Build:

```text
historical simulation
execution simulation
LP fee model
funding model
slippage model
```

---

## Phase 3 — Base Fork

Integrate:

```text
Uniswap V3
Base
real contract state
```

---

## Phase 4 — OKX Demo

Integrate:

```text
OKX market data
OKX account
OKX positions
OKX orders
OKX WebSocket
```

Use demo trading before production. OKX documents both REST and WebSocket trading interfaces and a demo environment. ([OKX][1])

---

## Phase 5 — Shadow Mode

Run against real markets with:

```text
zero execution
```

Measure hypothetical performance.

---

## Phase 6 — Limited Production

Use extremely limited capital.

Constraints:

```text
one strategy
one pool
one asset
one hedge venue
strict position limits
strict loss limits
```

---

## Phase 7 — Expansion

Add:

```text
Aerodrome
additional pools
additional assets
additional hedge venues
strategy allocator
```

---

# 56. Future Architecture

Eventually the system should become:

```text
                    OPPORTUNITY ENGINE
                           │
                           ▼
                    STRATEGY ALLOCATOR
                           │
                           ▼
                    TARGET PORTFOLIO
                           │
                           ▼
                    RISK OPTIMIZER
                           │
                           ▼
                    EXECUTION PLANNER
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
          DEX ROUTER                HEDGE ROUTER
              │                         │
       ┌──────┼──────┐          ┌───────┼────────┐
       ▼      ▼      ▼          ▼       ▼        ▼
    Uniswap Aero  Curve       OKX   Hyperliquid GMX
```

At that point the product is no longer simply a farming bot.

It is a **delta-neutral DeFi portfolio execution engine**.

---

# 57. Product Principle

The system should optimize:

```text
risk-adjusted net yield
```

subject to:

```text
delta constraints
liquidity constraints
leverage constraints
execution constraints
capital constraints
venue constraints
operational constraints
```

Formally:

```text
maximize:

Expected Yield
- Funding Cost
- Trading Cost
- Gas
- Slippage
- Expected IL
- Risk Penalty

subject to:

|Net Delta| <= DeltaLimit

Leverage <= MaxLeverage

Drawdown <= MaxDrawdown

MarginUtilization <= MaxMargin

PositionSize <= MaxPosition

ExecutionCost <= MaxExecutionCost
```

This optimization layer is the long-term core of the product.

---

# 58. Final Product Definition

The product is:

> **An automated, risk-controlled portfolio engine that combines on-chain liquidity positions with derivative hedges to pursue market-neutral yield.**

It is **not**:

> a script that farms a pool and periodically shorts ETH.

The first implementation should deliberately be small:

```text
Base
Uniswap V3
ETH/USDC
OKX perpetual
one strategy
one wallet
```

But the internal architecture should already support:

```text
multiple DEXs
multiple hedge venues
multiple strategies
multiple assets
multiple chains
```

without rewriting:

```text
portfolio
delta
risk
execution
reconciliation
```

Those are the core systems that must remain stable.

### One important change from your original PRD

I would **not** tell a coding model to “build the complete production-grade bot” from this PRD in one shot.

Give it the PRD, then force it through these implementation gates:

**Gate 1:** LP math + delta engine
**Gate 2:** portfolio/reconciliation
**Gate 3:** backtester
**Gate 4:** Base fork
**Gate 5:** OKX demo
**Gate 6:** shadow mode
**Gate 7:** tiny live deployment

That is substantially safer and also much more likely to produce code that you can actually debug.

For the OKX-specific portion, the current API supports the account, instrument, order, fill and position primitives we'd need, while OnchainOS can provide DEX aggregation/swap/simulation infrastructure. ([OKX][1])

**The next artifact I would build is not more PRD prose:** it's the **technical architecture/spec for Gate 1**, including the exact Uniswap V3 delta equations, TypeScript domain interfaces, state machine, database schema, and test cases. That is where the mathematical correctness of the whole system gets locked down.

[1]: https://www.okx.com/docs-v5/?utm_source=chatgpt.com "Overview – OKX API guide | OKX technical support | OKX"
[2]: https://web3.okx.com/id/onchainos/dev-docs-v5/dex-api/dex-what-is-dex-api?utm_source=chatgpt.com "What is DEX API | Overview | Home | Dokumen Onchain OS | OKX Wallet"
