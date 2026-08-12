import { D } from "../math/decimal.js";
import {
  lpMathInputFromHumanPrices,
  priceToken0In1ToSqrtRaw,
  lpAmounts,
  lpValue,
  analyticalDelta,
  referenceDeltaFD,
} from "../math/uniswapV3.js";
import { portfolioNetDelta } from "../portfolio/netDelta.js";
import { decideHedge } from "../hedge/hedge.js";
import type { Asset, LinearPosition } from "../domain/types.js";

/**
 * Deterministic Gate-1 portfolio report (arc.md §104).
 *
 * A scripted ETH/USDC scenario:
 *   - Uniswap V3 LP position, ETH price inside its range
 *   - an existing OKX perpetual short as the hedge leg
 * Prints amounts, value, LP/perp/net delta, the required hedge, and the
 * analytical-vs-finite-difference delta cross-check. No network, no credentials.
 */

const ETH: Asset = { id: "ETH", symbol: "ETH", decimals: 18 };
const USDC: Asset = { id: "USDC", symbol: "USDC", decimals: 6 };

// Scenario inputs
const ethPrice = 2000; // USDC per ETH
const priceLower = 1500;
const priceUpper = 2500;
const liquidity = 5n * 10n ** 15n; // raw L (sized for a ~$50k LP position)

const lpInput = lpMathInputFromHumanPrices({ liquidity, priceLower, priceUpper, dec0: 18, dec1: 6 });
const sqrtNow = priceToken0In1ToSqrtRaw(D(ethPrice), 18, 6);

const { amount0, amount1 } = lpAmounts(lpInput, sqrtNow);
const lpVal = lpValue(lpInput, sqrtNow, 1);
const lpDelta = analyticalDelta(lpInput, sqrtNow, 1);
const fdDelta = referenceDeltaFD(lpInput, sqrtNow, 1, 1e-7);

// Existing hedge leg: OKX perpetual short
const perpQty = D("-11.5");
const perp: LinearPosition = { id: "okx-eth-perp", venue: "okx", asset: ETH, quantity: perpQty };

const net = portfolioNetDelta({
  asset: ETH,
  lps: [{ label: "univ3-eth-usdc", source: { input: lpInput, sqrtRawCurrent: sqrtNow, numeraire: 1 } }],
  linear: [{ label: "okx-perp", position: perp }],
});

const hedge = decideHedge(ETH, net.netDelta, perpQty, {
  targetDelta: 0,
  triggerDelta: 0.02,
  minRebalanceBase: 0.01,
});

const deltaErrorPct = lpDelta.abs().gt("1e-30")
  ? lpDelta.minus(fdDelta).abs().div(lpDelta.abs()).mul(100)
  : D(0);
const status = deltaErrorPct.lt("1e-4") ? "PASS" : "FAIL";

const f = (x: import("../math/decimal.js").Dec, dp = 6) => x.toFixed(dp);

console.log(`
Portfolio  (ETH/USDC @ ${ethPrice} USDC/ETH, range ${priceLower}-${priceUpper})
────────────────────────────────────────────
LP value:            $${f(lpVal, 2)}
ETH amount:           ${f(amount0)} ${ETH.symbol}
USDC amount:          ${f(amount1, 2)} ${USDC.symbol}

LP delta:            ${lpDelta.gte(0) ? "+" : ""}${f(lpDelta)} ETH
Perp delta:          ${perpQty.gte(0) ? "+" : ""}${f(perpQty)} ETH
Net delta:           ${net.netDelta.gte(0) ? "+" : ""}${f(net.netDelta)} ETH

Target delta:         0 ETH
Hedge action:         ${hedge.action}
Required hedge:      ${hedge.requiredDelta.gte(0) ? "+" : ""}${f(hedge.requiredDelta)} ETH
Resulting hedge:     ${hedge.resultingHedgeDelta.gte(0) ? "+" : ""}${f(hedge.resultingHedgeDelta)} ETH

Analytical delta:     ${f(lpDelta, 10)}
Finite-difference:    ${f(fdDelta, 10)}
Error:                ${f(deltaErrorPct, 8)}%

Status:               ${status}
`);

if (status !== "PASS") process.exit(1);
