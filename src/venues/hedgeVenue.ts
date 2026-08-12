import type { Dec } from "../math/decimal.js";
import type { Asset } from "../domain/types.js";

/**
 * Abstract hedge venue. The strategy/portfolio core depends ONLY on this
 * interface — never on a concrete OKX (or any other) client (arc.md §88, §39).
 * The OKX perpetual adapter (Gate 4 / M3) implements this behind the boundary.
 */

export interface FundingRate {
  instrument: string;
  /** Current funding rate (per funding interval), signed. */
  rate: Dec;
  timestamp: number;
}

export interface VenuePosition {
  instrument: string;
  asset: Asset;
  /** Signed quantity in base-asset units (negative = short). */
  quantity: Dec;
  markPrice: Dec;
}

export type OrderSide = "BUY" | "SELL";

export interface OrderRequest {
  instrument: string;
  side: OrderSide;
  /** Size in base-asset units, always positive. */
  quantity: Dec;
  /** Client-supplied idempotency key (arc.md §58). */
  clientOrderId: string;
  reduceOnly?: boolean;
}

export interface OrderResult {
  clientOrderId: string;
  venueOrderId: string;
  filledQuantity: Dec;
  avgPrice: Dec;
  status: "FILLED" | "PARTIAL" | "REJECTED" | "PENDING";
}

export interface HedgeVenue {
  readonly id: string;
  getPositions(): Promise<VenuePosition[]>;
  getMarkPrice(instrument: string): Promise<Dec>;
  getFundingRate(instrument: string): Promise<FundingRate>;
  placeOrder(request: OrderRequest): Promise<OrderResult>;
  cancelOrder(clientOrderId: string): Promise<void>;
}
