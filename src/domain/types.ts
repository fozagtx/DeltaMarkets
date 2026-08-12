import type { Dec } from "../math/decimal.js";

/**
 * Domain types. Pure data, zero infrastructure dependencies.
 *
 * Unit discipline (see arc.md §4-5):
 *  - `bigint`  -> raw on-chain integer quantities (token raw units, pool liquidity, sqrtPriceX96)
 *  - `Decimal` -> normalized financial values (human token amounts, prices, deltas)
 * JavaScript floating point is never used for financial state.
 */

export interface Asset {
  /** Stable identifier, e.g. "ETH" or a chain-scoped address key. */
  id: string;
  symbol: string;
  /** ERC-20 decimals; determines raw <-> human scaling. */
  decimals: number;
  chainId?: number;
  address?: string;
}

/** Which token in a pair is the numeraire (unit of account for value). */
export type Numeraire = 0 | 1;

/** Live state of a Uniswap-V3-style pool, read from chain. Raw units. */
export interface PoolState {
  address: string;
  token0: Asset;
  token1: Asset;
  /** sqrt(price) * 2^96, price expressed as token1_raw per token0_raw. */
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  feeTier?: number;
  tickSpacing?: number;
  timestamp?: number;
  blockNumber?: bigint;
}

/** A concentrated-liquidity position in a pool. Raw liquidity. */
export interface LiquidityPosition {
  id: string;
  protocol: "uniswap-v3";
  poolAddress: string;
  token0: Asset;
  token1: Asset;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

/** A linear position (spot or perpetual) whose delta ~ quantity in base units. */
export interface LinearPosition {
  id: string;
  venue: string;
  asset: Asset;
  /** Signed quantity in base-asset units (negative = short). */
  quantity: Dec;
  entryPrice?: Dec;
  markPrice?: Dec;
}

/** Result of a delta computation, tagged with how it was derived. */
export interface DeltaResult {
  /** Base asset the delta is expressed in. */
  asset: Asset;
  /** Signed delta in base-asset units. */
  delta: Dec;
  method: "ANALYTICAL" | "FINITE_DIFFERENCE";
}
