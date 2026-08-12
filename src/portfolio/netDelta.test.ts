import { describe, it, expect } from "vitest";
import { D } from "../math/decimal.js";
import { lpMathInputFromHumanPrices, priceToken0In1ToSqrtRaw, analyticalDelta } from "../math/uniswapV3.js";
import { portfolioNetDelta, linearDelta } from "./netDelta.js";
import type { Asset, LinearPosition } from "../domain/types.js";

const ETH: Asset = { id: "ETH", symbol: "ETH", decimals: 18 };

describe("linear delta", () => {
  it("short perpetual contributes negative delta equal to quantity", () => {
    const short: LinearPosition = { id: "p1", venue: "okx", asset: ETH, quantity: D(-1.8) };
    expect(linearDelta(short).toString()).toBe("-1.8");
  });
});

describe("portfolio net delta aggregation", () => {
  it("net delta is additive across LP + perp (arc.md §23 shape)", () => {
    // Construct an LP whose analytical delta we read directly, then confirm the
    // aggregator sums LP + perp deltas.
    const input = lpMathInputFromHumanPrices({
      liquidity: 10n ** 18n,
      priceLower: 1500,
      priceUpper: 2500,
      dec0: 18,
      dec1: 6,
    });
    const s = priceToken0In1ToSqrtRaw(D(2000), 18, 6);
    const lpDelta = analyticalDelta(input, s, 1);

    const perp: LinearPosition = { id: "perp", venue: "okx", asset: ETH, quantity: D(-1.8) };

    const result = portfolioNetDelta({
      asset: ETH,
      lps: [{ label: "univ3-eth-usdc", source: { input, sqrtRawCurrent: s, numeraire: 1 } }],
      linear: [{ label: "okx-perp", position: perp }],
    });

    expect(result.lpDelta.eq(lpDelta)).toBe(true);
    expect(result.linearDelta.eq(D(-1.8))).toBe(true);
    expect(result.netDelta.eq(lpDelta.minus(D(1.8)))).toBe(true);
    expect(result.breakdown).toHaveLength(2);
  });

  it("empty portfolio has zero net delta", () => {
    const result = portfolioNetDelta({ asset: ETH });
    expect(result.netDelta.eq(D(0))).toBe(true);
  });

  it("a spot long that offsets an equal LP short-side nets to zero", () => {
    const spotLong: LinearPosition = { id: "s", venue: "wallet", asset: ETH, quantity: D(2) };
    const perpShort: LinearPosition = { id: "p", venue: "okx", asset: ETH, quantity: D(-2) };
    const result = portfolioNetDelta({
      asset: ETH,
      linear: [
        { label: "spot", position: spotLong },
        { label: "perp", position: perpShort },
      ],
    });
    expect(result.netDelta.eq(D(0))).toBe(true);
  });
});
