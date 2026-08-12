import { D, type Dec } from "../math/decimal.js";
import type { Asset } from "../domain/types.js";

/**
 * Cost- and hysteresis-aware hedge decision (arc.md §23-27).
 *
 * The strategy never says "short 2 ETH". It states a target delta and bounds;
 * this module decides whether — and by how much — to move the hedge, applying:
 *   - a hysteresis band (don't churn around zero), and
 *   - a minimum rebalance size (don't trade dust).
 * It returns an intent only; execution/risk layers act on it later.
 */

export type HedgeAction = "NO_ACTION" | "OPEN" | "INCREASE" | "DECREASE" | "CLOSE";

export interface HedgeConfig {
  /** Desired net delta, in base-asset units (usually 0). */
  targetDelta: Dec;
  /** Only hedge once |netDelta - target| exceeds this (hysteresis enter). */
  triggerDelta: Dec;
  /** Skip hedges smaller than this in base-asset units (dust guard). */
  minRebalanceBase: Dec;
}

export interface HedgeDecision {
  asset: Asset;
  netDelta: Dec;
  targetDelta: Dec;
  /** Current signed delta contributed by the existing hedge leg. */
  currentHedgeDelta: Dec;
  /** Signed delta change the hedge must make to reach target: target - netDelta. */
  requiredDelta: Dec;
  /** The hedge leg's delta after applying requiredDelta. */
  resultingHedgeDelta: Dec;
  action: HedgeAction;
  reason: string;
}

export interface HedgeConfigInput {
  targetDelta?: Dec | number;
  triggerDelta: Dec | number;
  minRebalanceBase: Dec | number;
}

function normalizeConfig(cfg: HedgeConfigInput): HedgeConfig {
  return {
    targetDelta: D(cfg.targetDelta ?? 0),
    triggerDelta: D(cfg.triggerDelta).abs(),
    minRebalanceBase: D(cfg.minRebalanceBase).abs(),
  };
}

/**
 * Decide the hedge move for a given net delta.
 *
 * @param asset             base asset the deltas are measured in
 * @param netDelta          current portfolio net delta (LP + existing hedge + spot)
 * @param currentHedgeDelta delta currently contributed by the hedge leg (perp)
 */
export function decideHedge(
  asset: Asset,
  netDelta: Dec,
  currentHedgeDelta: Dec,
  cfgInput: HedgeConfigInput,
): HedgeDecision {
  const cfg = normalizeConfig(cfgInput);
  const deviation = netDelta.minus(cfg.targetDelta);
  const requiredDelta = cfg.targetDelta.minus(netDelta); // = -deviation
  const resultingHedgeDelta = currentHedgeDelta.plus(requiredDelta);

  const base = {
    asset,
    netDelta,
    targetDelta: cfg.targetDelta,
    currentHedgeDelta,
    requiredDelta,
    resultingHedgeDelta,
  };

  // Inside the hysteresis band: leave it alone.
  if (deviation.abs().lte(cfg.triggerDelta)) {
    return { ...base, action: "NO_ACTION", reason: "within delta tolerance band" };
  }

  // Beyond the band but the move itself is dust: not worth the cost.
  if (requiredDelta.abs().lt(cfg.minRebalanceBase)) {
    return { ...base, action: "NO_ACTION", reason: "required hedge below minimum rebalance size" };
  }

  const action = classify(currentHedgeDelta, resultingHedgeDelta);
  return {
    ...base,
    action,
    reason: `net delta ${netDelta.toSignificantDigits(6)} vs target ${cfg.targetDelta.toString()}; ` +
      `move hedge by ${requiredDelta.toSignificantDigits(6)} base`,
  };
}

const DUST = D("1e-18");

/** Classify the hedge move by how the hedge leg's magnitude/existence changes. */
function classify(current: Dec, resulting: Dec): HedgeAction {
  const hadHedge = current.abs().gt(DUST);
  const willHaveHedge = resulting.abs().gt(DUST);

  if (!hadHedge && willHaveHedge) return "OPEN";
  if (hadHedge && !willHaveHedge) return "CLOSE";
  // Both non-zero: growing away from zero is INCREASE, shrinking toward zero is DECREASE.
  return resulting.abs().gt(current.abs()) ? "INCREASE" : "DECREASE";
}
