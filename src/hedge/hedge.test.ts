import { describe, it, expect } from "vitest";
import { D } from "../math/decimal.js";
import { decideHedge } from "./hedge.js";
import type { Asset } from "../domain/types.js";

const ETH: Asset = { id: "ETH", symbol: "ETH", decimals: 18 };

const cfg = { targetDelta: 0, triggerDelta: 0.05, minRebalanceBase: 0.01 };

describe("decideHedge", () => {
  it("arc.md §23: LP +2.40, perp -1.80 => net +0.60 => hedge -0.60", () => {
    // net delta already reflects LP + existing hedge; existing hedge = -1.8
    const decision = decideHedge(ETH, D("0.60"), D("-1.80"), cfg);
    expect(decision.requiredDelta.eq(D("-0.60"))).toBe(true);
    expect(decision.resultingHedgeDelta.eq(D("-2.40"))).toBe(true);
    expect(decision.action).toBe("INCREASE"); // short grows from -1.8 to -2.4
  });

  it("within tolerance band => NO_ACTION", () => {
    const decision = decideHedge(ETH, D("0.03"), D("-1.0"), cfg);
    expect(decision.action).toBe("NO_ACTION");
    expect(decision.reason).toMatch(/tolerance/);
  });

  it("beyond band but dust-sized move => NO_ACTION", () => {
    const decision = decideHedge(ETH, D("0.06"), D("-1.0"), {
      targetDelta: 0,
      triggerDelta: 0.05,
      minRebalanceBase: 0.1, // required move (0.06) < min
    });
    expect(decision.action).toBe("NO_ACTION");
    expect(decision.reason).toMatch(/minimum/);
  });

  it("opens a new hedge when none exists", () => {
    const decision = decideHedge(ETH, D("2.0"), D("0"), cfg);
    expect(decision.action).toBe("OPEN");
    expect(decision.resultingHedgeDelta.eq(D("-2.0"))).toBe(true);
  });

  it("closes the hedge when it would return to ~zero", () => {
    const decision = decideHedge(ETH, D("-1.0"), D("-1.0"), cfg);
    // net is -1.0, target 0 => required +1.0 => resulting hedge 0 => CLOSE
    expect(decision.action).toBe("CLOSE");
    expect(decision.resultingHedgeDelta.abs().lt(D("1e-18"))).toBe(true);
  });

  it("decreases an over-hedge back toward target", () => {
    // net -0.5 means we're over-hedged short; target 0 => required +0.5 => hedge shrinks
    const decision = decideHedge(ETH, D("-0.5"), D("-2.0"), cfg);
    expect(decision.action).toBe("DECREASE");
    expect(decision.resultingHedgeDelta.eq(D("-1.5"))).toBe(true);
  });
});
