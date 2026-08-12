import { D, type Dec } from "../math/decimal.js";
import { analyticalDelta, type LpMathInput } from "../math/uniswapV3.js";
import type { Asset, LinearPosition, Numeraire } from "../domain/types.js";

/**
 * Portfolio net-delta aggregation.
 *
 * Net Delta = Spot Delta + LP Delta + Perpetual Delta + ...   (arc.md §12)
 * All contributions are expressed in the SAME base-asset units before summing.
 * For a linear instrument (spot or perpetual) delta ~ signed quantity.
 */

/** Delta of a linear position ~ its signed quantity in base units. */
export function linearDelta(position: LinearPosition): Dec {
  return position.quantity;
}

export interface LpDeltaSource {
  input: LpMathInput;
  /** Current raw sqrt-price of the pool. */
  sqrtRawCurrent: Dec;
  /** Which token is the numeraire; the OTHER token is the base we report delta in. */
  numeraire: Numeraire;
}

export interface DeltaBreakdown {
  label: string;
  delta: Dec;
}

export interface PortfolioDelta {
  /** Base asset all deltas are reported in. */
  asset: Asset;
  /** Sum of every contribution, in base-asset units. */
  netDelta: Dec;
  /** LP-only delta. */
  lpDelta: Dec;
  /** Spot + perpetual (linear) delta. */
  linearDelta: Dec;
  breakdown: DeltaBreakdown[];
}

/**
 * Aggregate net delta of a portfolio made of LP positions plus linear
 * (spot/perp) positions. Every input must already share the same base asset.
 */
export function portfolioNetDelta(args: {
  asset: Asset;
  lps?: Array<{ label: string; source: LpDeltaSource }>;
  linear?: Array<{ label: string; position: LinearPosition }>;
}): PortfolioDelta {
  const breakdown: DeltaBreakdown[] = [];

  let lpSum = D(0);
  for (const { label, source } of args.lps ?? []) {
    const d = analyticalDelta(source.input, source.sqrtRawCurrent, source.numeraire);
    lpSum = lpSum.plus(d);
    breakdown.push({ label, delta: d });
  }

  let linSum = D(0);
  for (const { label, position } of args.linear ?? []) {
    const d = linearDelta(position);
    linSum = linSum.plus(d);
    breakdown.push({ label, delta: d });
  }

  return {
    asset: args.asset,
    netDelta: lpSum.plus(linSum),
    lpDelta: lpSum,
    linearDelta: linSum,
    breakdown,
  };
}
