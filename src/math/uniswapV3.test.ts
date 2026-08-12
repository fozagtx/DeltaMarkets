import { describe, it, expect } from "vitest";
import { D, Decimal, type Dec } from "./decimal.js";
import {
  tickToSqrtRaw,
  sqrtPriceX96ToSqrtRaw,
  sqrtRawToPriceToken0In1,
  priceToken0In1ToSqrtRaw,
  lpAmounts,
  lpValue,
  analyticalDelta,
  referenceDeltaFD,
  lpMathInputFromHumanPrices,
  type LpMathInput,
} from "./uniswapV3.js";
import type { Numeraire } from "../domain/types.js";

/** Relative error |a - b| / max(|a|,|b|,tinyFloor). */
function relError(a: Dec, b: Dec): Dec {
  const denom = Decimal.max(a.abs(), b.abs(), D("1e-30"));
  return a.minus(b).abs().div(denom);
}

/** True if a and b agree within an absolute OR relative tolerance. Near-zero
 *  quantities (e.g. token amounts / delta at a range boundary) need the
 *  absolute arm, since relative error is meaningless as the value -> 0. */
function closeEnough(a: Dec, b: Dec, relTol: number, absTol: number): boolean {
  return a.minus(b).abs().lt(D(absTol)) || relError(a, b).lt(D(relTol));
}

/** raw sqrt-price for a given human token0-in-token1 price. */
function sqrtAt(price: number, dec0: number, dec1: number): Dec {
  return priceToken0In1ToSqrtRaw(D(price), dec0, dec1);
}

describe("tick / price conversions", () => {
  it("tick 0 => raw sqrt-price 1", () => {
    expect(tickToSqrtRaw(0).toNumber()).toBeCloseTo(1, 12);
  });

  it("tick sqrt-price is strictly monotonic in tick", () => {
    const a = tickToSqrtRaw(-500);
    const b = tickToSqrtRaw(0);
    const c = tickToSqrtRaw(500);
    expect(a.lt(b)).toBe(true);
    expect(b.lt(c)).toBe(true);
  });

  it("sqrtPriceX96 round-trips to a raw price", () => {
    // price0in1 = 1 (raw) for equal decimals => sqrtPriceX96 = 2^96
    const q96 = new Decimal(2).pow(96);
    const sqrtRaw = sqrtPriceX96ToSqrtRaw(BigInt(q96.toFixed(0)));
    expect(sqrtRaw.toNumber()).toBeCloseTo(1, 6);
  });

  it("price <-> sqrt-price round-trips across decimal combos", () => {
    for (const [dec0, dec1] of [[18, 6], [6, 18], [18, 18], [8, 6]]) {
      for (const price of [0.5, 1, 2000, 65000]) {
        const s = priceToken0In1ToSqrtRaw(D(price), dec0!, dec1!);
        const back = sqrtRawToPriceToken0In1(s, dec0!, dec1!);
        expect(relError(back, D(price)).toNumber()).toBeLessThan(1e-20);
      }
    }
  });
});

describe("LP amounts — regime behaviour", () => {
  const input = lpMathInputFromHumanPrices({
    liquidity: 10n ** 18n,
    priceLower: 1500,
    priceUpper: 2500,
    dec0: 18,
    dec1: 6,
  });

  it("below range => all token0, ~zero token1", () => {
    const { amount0, amount1 } = lpAmounts(input, sqrtAt(1000, 18, 6));
    expect(amount0.gt(0)).toBe(true);
    expect(amount1.abs().lt(D("1e-18"))).toBe(true);
  });

  it("above range => all token1, ~zero token0", () => {
    const { amount0, amount1 } = lpAmounts(input, sqrtAt(3000, 18, 6));
    expect(amount1.gt(0)).toBe(true);
    expect(amount0.abs().lt(D("1e-18"))).toBe(true);
  });

  it("in range => both tokens positive", () => {
    const { amount0, amount1 } = lpAmounts(input, sqrtAt(2000, 18, 6));
    expect(amount0.gt(0)).toBe(true);
    expect(amount1.gt(0)).toBe(true);
  });

  it("amounts are non-negative across a wide price sweep (property)", () => {
    for (let p = 500; p <= 5000; p += 137) {
      const { amount0, amount1 } = lpAmounts(input, sqrtAt(p, 18, 6));
      expect(amount0.gte(0)).toBe(true);
      expect(amount1.gte(0)).toBe(true);
    }
  });

  it("token amounts are continuous across both range boundaries", () => {
    // One token is ~0 at each boundary (all-token0 below the lower edge,
    // all-token1 above the upper edge), so continuity needs abs-or-rel tol.
    const eps = 1e-14;
    for (const boundary of [1500, 2500]) {
      const lo = lpAmounts(input, sqrtAt(boundary * (1 - eps), 18, 6));
      const hi = lpAmounts(input, sqrtAt(boundary * (1 + eps), 18, 6));
      expect(closeEnough(lo.amount0, hi.amount0, 1e-3, 1e-4)).toBe(true);
      expect(closeEnough(lo.amount1, hi.amount1, 1e-3, 1e-4)).toBe(true);
    }
  });
});

describe("analytical delta ≈ finite-difference reference", () => {
  // Interior points only (strictly inside a single regime) so the central
  // difference matches the smooth first-order delta.
  const cases: Array<{
    name: string;
    dec0: number;
    dec1: number;
    priceLower: number;
    priceUpper: number;
    numeraire: Numeraire;
    prices: number[];
  }> = [
    {
      name: "ETH/USDC 18/6, numeraire=USDC(1)",
      dec0: 18,
      dec1: 6,
      priceLower: 1500,
      priceUpper: 2500,
      numeraire: 1,
      prices: [900, 1200, 1700, 2000, 2300, 2800, 4000],
    },
    {
      name: "flipped decimals 6/18, numeraire=1",
      dec0: 6,
      dec1: 18,
      priceLower: 1500,
      priceUpper: 2500,
      numeraire: 1,
      prices: [1200, 1800, 2000, 2400, 3200],
    },
    {
      name: "base = token1 (numeraire=0)",
      dec0: 18,
      dec1: 6,
      priceLower: 1500,
      priceUpper: 2500,
      numeraire: 0,
      prices: [1200, 1900, 2100, 2600],
    },
    {
      name: "very narrow range",
      dec0: 18,
      dec1: 6,
      priceLower: 1990,
      priceUpper: 2010,
      numeraire: 1,
      prices: [1995, 2000, 2005],
    },
    {
      name: "very wide range",
      dec0: 18,
      dec1: 6,
      priceLower: 100,
      priceUpper: 100000,
      numeraire: 1,
      prices: [500, 2000, 40000],
    },
    {
      name: "BTC-scale prices",
      dec0: 8,
      dec1: 6,
      priceLower: 50000,
      priceUpper: 80000,
      numeraire: 1,
      prices: [40000, 60000, 65000, 90000],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const input: LpMathInput = lpMathInputFromHumanPrices({
        liquidity: 10n ** 18n,
        priceLower: c.priceLower,
        priceUpper: c.priceUpper,
        dec0: c.dec0,
        dec1: c.dec1,
      });
      for (const p of c.prices) {
        const s = sqrtAt(p, c.dec0, c.dec1);
        const ana = analyticalDelta(input, s, c.numeraire);
        const fd = referenceDeltaFD(input, s, c.numeraire, 1e-7);
        // Delta can be legitimately zero (above range for numeraire=1); use
        // absolute tolerance there, relative tolerance otherwise.
        if (ana.abs().lt(D("1e-15")) && fd.abs().lt(D("1e-15"))) {
          expect(fd.abs().lt(D("1e-12"))).toBe(true);
        } else {
          expect(relError(ana, fd).toNumber()).toBeLessThan(1e-6);
        }
      }
    });
  }
});

describe("delta boundary invariants", () => {
  const input = lpMathInputFromHumanPrices({
    liquidity: 10n ** 18n,
    priceLower: 1500,
    priceUpper: 2500,
    dec0: 18,
    dec1: 6,
  });

  it("delta is continuous at the lower boundary", () => {
    const eps = 1e-6;
    const below = analyticalDelta(input, sqrtAt(1500 * (1 - eps), 18, 6), 1);
    const inside = analyticalDelta(input, sqrtAt(1500 * (1 + eps), 18, 6), 1);
    expect(relError(below, inside).toNumber()).toBeLessThan(1e-3);
  });

  it("delta is continuous at the upper boundary", () => {
    // Gamma is steep near the upper edge, so continuity only shows at small eps.
    const eps = 1e-9;
    const inside = analyticalDelta(input, sqrtAt(2500 * (1 - eps), 18, 6), 1);
    const above = analyticalDelta(input, sqrtAt(2500 * (1 + eps), 18, 6), 1);
    expect(closeEnough(inside, above, 1e-3, 1e-3)).toBe(true);
  });

  it("below range: delta equals full token0 amount (max exposure)", () => {
    const s = sqrtAt(1000, 18, 6);
    const { amount0 } = lpAmounts(input, s);
    const delta = analyticalDelta(input, s, 1);
    expect(relError(delta, amount0).toNumber()).toBeLessThan(1e-20);
  });

  it("above range: delta is ~zero (no base exposure)", () => {
    const delta = analyticalDelta(input, sqrtAt(3000, 18, 6), 1);
    expect(delta.abs().lt(D("1e-15"))).toBe(true);
  });
});

describe("valuation sanity", () => {
  const input = lpMathInputFromHumanPrices({
    liquidity: 10n ** 18n,
    priceLower: 1500,
    priceUpper: 2500,
    dec0: 18,
    dec1: 6,
  });

  it("value equals amount0*price + amount1 in the quote numeraire", () => {
    const s = sqrtAt(2000, 18, 6);
    const { amount0, amount1 } = lpAmounts(input, s);
    const price = sqrtRawToPriceToken0In1(s, 18, 6);
    const v = lpValue(input, s, 1);
    expect(relError(v, amount0.mul(price).plus(amount1)).toNumber()).toBeLessThan(1e-20);
  });

  it("value is positive and finite across the range", () => {
    for (const p of [800, 1500, 2000, 2500, 4000]) {
      const v = lpValue(input, sqrtAt(p, 18, 6), 1);
      expect(v.gt(0)).toBe(true);
      expect(v.isFinite()).toBe(true);
    }
  });
});
