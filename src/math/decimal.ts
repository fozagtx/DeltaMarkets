import Decimal from "decimal.js";

// High precision: LP delta math and finite-difference comparisons need headroom
// well beyond float64. 60 significant digits is comfortable for all V3 math here.
Decimal.set({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Dec = Decimal;

export type DecimalInput = string | number | Decimal | bigint;

/** Construct a Decimal from string | number | Decimal | bigint. Never from a lossy float path. */
export function D(x: DecimalInput): Decimal {
  return new Decimal(typeof x === "bigint" ? x.toString() : x);
}

/** 2^96, the fixed-point scaling factor Uniswap V3 uses for sqrtPriceX96. */
export const Q96: Decimal = new Decimal(2).pow(96);

/** Tick base: price(tick) = 1.0001^tick. */
export const TICK_BASE: Decimal = new Decimal("1.0001");

/** 10^n as a Decimal (n may be negative). */
export function pow10(n: number): Decimal {
  return new Decimal(10).pow(n);
}

/** Clamp x into [lo, hi]. */
export function clampDec(x: Decimal, lo: Decimal, hi: Decimal): Decimal {
  return Decimal.min(Decimal.max(x, lo), hi);
}
