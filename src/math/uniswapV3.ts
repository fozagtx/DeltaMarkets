import { Decimal, D, Q96, TICK_BASE, pow10, clampDec, type Dec } from "./decimal.js";
import type { Numeraire } from "../domain/types.js";

/**
 * Deterministic Uniswap V3 concentrated-liquidity math.
 *
 * All functions are PURE: same input -> same output, no clock, no I/O.
 *
 * Price conventions
 * -----------------
 * "raw price"   = token1_raw / token0_raw (what the pool encodes in sqrtPriceX96)
 * "human price" = price of one whole token0 in whole token1 units
 *   human = raw * 10^(dec0 - dec1)   <=>   raw = human * 10^(dec1 - dec0)
 * We work with the SQRT of the raw price throughout, since V3 liquidity math is
 * linear in sqrt-price.
 */

// ---------------------------------------------------------------------------
// Price / tick conversions
// ---------------------------------------------------------------------------

/** sqrtPriceX96 (raw) -> raw sqrt-price as a Decimal (divide out the 2^96 scaling). */
export function sqrtPriceX96ToSqrtRaw(sqrtPriceX96: bigint): Dec {
  return D(sqrtPriceX96).div(Q96);
}

/** tick -> raw sqrt-price. price(tick) = 1.0001^tick, so sqrt = 1.0001^(tick/2). */
export function tickToSqrtRaw(tick: number): Dec {
  return TICK_BASE.pow(D(tick).div(2));
}

/** raw sqrt-price -> human price of token0 denominated in token1. */
export function sqrtRawToPriceToken0In1(sqrtRaw: Dec, dec0: number, dec1: number): Dec {
  return sqrtRaw.pow(2).mul(pow10(dec0 - dec1));
}

/** human price of token0-in-token1 -> raw sqrt-price. */
export function priceToken0In1ToSqrtRaw(price: Dec, dec0: number, dec1: number): Dec {
  return price.mul(pow10(dec1 - dec0)).sqrt();
}

// ---------------------------------------------------------------------------
// Normalized math input
// ---------------------------------------------------------------------------

/** Everything the LP math needs, in a normalized shape. */
export interface LpMathInput {
  /** Raw pool liquidity L. */
  liquidity: Dec;
  /** Raw sqrt-price at the lower tick. */
  sqrtRawLower: Dec;
  /** Raw sqrt-price at the upper tick. */
  sqrtRawUpper: Dec;
  dec0: number;
  dec1: number;
}

export function makeLpMathInput(args: {
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  dec0: number;
  dec1: number;
}): LpMathInput {
  return {
    liquidity: D(args.liquidity),
    sqrtRawLower: tickToSqrtRaw(args.tickLower),
    sqrtRawUpper: tickToSqrtRaw(args.tickUpper),
    dec0: args.dec0,
    dec1: args.dec1,
  };
}

// ---------------------------------------------------------------------------
// Token amounts
// ---------------------------------------------------------------------------

export interface LpAmounts {
  /** Human amount of token0 held by the position. */
  amount0: Dec;
  /** Human amount of token1 held by the position. */
  amount1: Dec;
}

/**
 * Token amounts held by an LP position at a given raw sqrt-price.
 *
 * Using the clamped current sqrt-price s' = clamp(s, sA, sB) unifies the three
 * regimes (below / inside / above range):
 *   amount0_raw = L * (sB - s') / (s' * sB)      -> max when s'=sA, 0 when s'=sB
 *   amount1_raw = L * (s' - sA)                  -> 0 when s'=sA, max when s'=sB
 * Human amounts divide out token decimals.
 */
export function lpAmounts(input: LpMathInput, sqrtRawCurrent: Dec): LpAmounts {
  const { liquidity: L, sqrtRawLower: sA, sqrtRawUpper: sB, dec0, dec1 } = input;
  const s = clampDec(sqrtRawCurrent, sA, sB);

  const amount0Raw = L.mul(sB.minus(s)).div(s.mul(sB));
  const amount1Raw = L.mul(s.minus(sA));

  return {
    amount0: amount0Raw.div(pow10(dec0)),
    amount1: amount1Raw.div(pow10(dec1)),
  };
}

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

/**
 * Position value expressed in the numeraire token's human units.
 *  - numeraire = 1: value = amount0 * P + amount1,  P = price(token0 in token1)
 *  - numeraire = 0: value = amount1 * (1/P) + amount0
 */
export function lpValue(input: LpMathInput, sqrtRawCurrent: Dec, numeraire: Numeraire): Dec {
  const { amount0, amount1 } = lpAmounts(input, sqrtRawCurrent);
  const price0in1 = sqrtRawToPriceToken0In1(sqrtRawCurrent, input.dec0, input.dec1);

  return numeraire === 1
    ? amount0.mul(price0in1).plus(amount1)
    : amount1.div(price0in1).plus(amount0);
}

// ---------------------------------------------------------------------------
// Analytical delta (production implementation)
// ---------------------------------------------------------------------------

/**
 * Analytical first-order delta of the LP position, in BASE-asset units, where
 * the base asset is the non-numeraire token.
 *
 * Derivation. Value in the numeraire is V(P) = x(P)*P + y(P) (numeraire=1 case,
 * base=token0, P=price of base in numeraire, x=amount0, y=amount1). Along a
 * constant-L Uniswap curve the marginal token exchange happens exactly at the
 * current price, so P*dx/dP + dy/dP = 0. Therefore
 *      dV/dP = x + (P*dx/dP + dy/dP) = x = amount0.
 * The kink at range boundaries affects gamma (d^2V/dP^2), not this first-order
 * delta, which stays continuous and equal to the current base-token amount.
 *
 * By symmetry, for numeraire=0 the base is token1 and delta = amount1.
 *
 * This closed form is validated against an INDEPENDENT finite-difference
 * reference (`referenceDeltaFD`) across all regimes in the test suite.
 */
export function analyticalDelta(input: LpMathInput, sqrtRawCurrent: Dec, numeraire: Numeraire): Dec {
  const { amount0, amount1 } = lpAmounts(input, sqrtRawCurrent);
  return numeraire === 1 ? amount0 : amount1;
}

// ---------------------------------------------------------------------------
// Finite-difference reference delta (independent cross-check)
// ---------------------------------------------------------------------------

/** Price of the base asset denominated in the numeraire, at a raw sqrt-price. */
function basePriceInNumeraire(sqrtRaw: Dec, dec0: number, dec1: number, numeraire: Numeraire): Dec {
  const price0in1 = sqrtRawToPriceToken0In1(sqrtRaw, dec0, dec1);
  // numeraire=1 -> base is token0, price = token0-in-token1
  // numeraire=0 -> base is token1, price = token1-in-token0 = 1 / (token0-in-token1)
  return numeraire === 1 ? price0in1 : D(1).div(price0in1);
}

/** Inverse of `basePriceInNumeraire`: base price in numeraire -> raw sqrt-price. */
function sqrtRawFromBasePrice(basePrice: Dec, dec0: number, dec1: number, numeraire: Numeraire): Dec {
  const price0in1 = numeraire === 1 ? basePrice : D(1).div(basePrice);
  return priceToken0In1ToSqrtRaw(price0in1, dec0, dec1);
}

/**
 * Independent reference delta via central finite difference on V(P):
 *      delta_fd = (V(P + eps) - V(P - eps)) / (2 eps)
 * Shares only the valuation function with production; the derivative itself is
 * derived numerically, so a bug in the analytical closed form is caught here.
 *
 * @param epsilonRel relative price bump (default 1e-6). Points must lie strictly
 *   inside a single regime for the central difference to match the smooth delta.
 */
export function referenceDeltaFD(
  input: LpMathInput,
  sqrtRawCurrent: Dec,
  numeraire: Numeraire,
  epsilonRel: Dec | number = 1e-6,
): Dec {
  const eps = D(epsilonRel);
  const basePrice = basePriceInNumeraire(sqrtRawCurrent, input.dec0, input.dec1, numeraire);

  const pMinus = basePrice.mul(D(1).minus(eps));
  const pPlus = basePrice.mul(D(1).plus(eps));

  const sMinus = sqrtRawFromBasePrice(pMinus, input.dec0, input.dec1, numeraire);
  const sPlus = sqrtRawFromBasePrice(pPlus, input.dec0, input.dec1, numeraire);

  const vMinus = lpValue(input, sMinus, numeraire);
  const vPlus = lpValue(input, sPlus, numeraire);

  return vPlus.minus(vMinus).div(pPlus.minus(pMinus));
}

// ---------------------------------------------------------------------------
// Convenience: build a math input directly from human price bounds (tests/demo)
// ---------------------------------------------------------------------------

export function lpMathInputFromHumanPrices(args: {
  liquidity: Dec | bigint;
  priceLower: Dec | number; // human price of token0 in token1
  priceUpper: Dec | number;
  dec0: number;
  dec1: number;
}): LpMathInput {
  return {
    liquidity: D(typeof args.liquidity === "bigint" ? args.liquidity : args.liquidity),
    sqrtRawLower: priceToken0In1ToSqrtRaw(D(args.priceLower), args.dec0, args.dec1),
    sqrtRawUpper: priceToken0In1ToSqrtRaw(D(args.priceUpper), args.dec0, args.dec1),
    dec0: args.dec0,
    dec1: args.dec1,
  };
}

export { Decimal, D };
