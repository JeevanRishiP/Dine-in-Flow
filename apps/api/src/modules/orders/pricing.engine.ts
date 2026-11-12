/**
 * Pure Pricing Engine
 *
 * Computes the full order quote server-side. No floating point; all values in paise.
 * Coupon / loyalty hooks are interfaces — implemented in Phase 7.
 *
 * Key invariants (verifiable via property tests):
 *  - total = subtotal + tax - discount + tip  (never negative)
 *  - tax is rounded to nearest paise using banker's rounding
 *  - a rounding_adjustment line makes the sum exact
 *  - caps (item qty, line count) are enforced
 *
 * Reference: ARCH §8, AGENTS §2 rule 1+2
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PriceLineInput {
  menu_item_id: string;
  name_snapshot: string;
  unit_price_paise: number; // server-derived, not client-trusted
  quantity: number;
  modifiers: Array<{
    modifier_id: string;
    name: string;
    price_paise: number;
  }>;
  notes?: string | null;
}

export interface TaxConfig {
  /** 'EXCLUSIVE' = tax added on top; 'INCLUSIVE' = already embedded in price_paise */
  mode: 'EXCLUSIVE' | 'INCLUSIVE';
  /** Total GST rate in basis points, e.g. 500 = 5%, 1800 = 18% */
  rate_bps: number;
  /** HSN-derived split: e.g. [{label:'CGST', share_bps: 250}, {label:'SGST', share_bps: 250}] */
  components: Array<{ label: string; share_bps: number }>;
}

export interface DiscountHookResult {
  /** Discount amount in paise (≥ 0) */
  discount_paise: number;
  /** Human-readable description (e.g. "DINE20 — 20% off") */
  description: string;
  /** Reference to coupon/loyalty record */
  ref_type: 'COUPON' | 'LOYALTY_CREDIT' | 'MANUAL' | 'NONE';
  ref_id?: string;
}

export interface QuoteLine {
  menu_item_id: string;
  name_snapshot: string;
  unit_price_paise: number;
  quantity: number;
  line_total_paise: number;
  modifiers: Array<{ modifier_id: string; name: string; price_paise: number }>;
  notes?: string | null;
}

export interface TaxLine {
  label: string;
  rate_bps: number;
  amount_paise: number;
}

export interface OrderQuote {
  lines: QuoteLine[];
  subtotal_paise: number;
  tax_lines: TaxLine[];
  tax_paise: number;
  discount_paise: number;
  discount_description: string | null;
  tip_paise: number;
  rounding_adjustment_paise: number; // may be -1, 0, or +1 to make integer sums exact
  total_paise: number;
  currency: string;
  /** Opaque hash of (item_ids + prices + qty + modifiers) for PRICE_CHANGED detection */
  price_fingerprint: string;
}

// ─── Caps ─────────────────────────────────────────────────────────────────────

export const MAX_LINE_COUNT = 50;
export const MAX_QTY_PER_LINE = 50;
export const MAX_TIP_PAISE = 100_000_00; // ₹1,00,000 — sanity cap

export class PricingValidationError extends Error {
  constructor(
    public readonly code: 'ORDER_LIMIT_EXCEEDED' | 'VALIDATION_ERROR' | 'CART_EMPTY',
    message: string,
  ) {
    super(message);
    this.name = 'PricingValidationError';
  }
}

// ─── Rounding ─────────────────────────────────────────────────────────────────

/**
 * Banker's rounding (round-half-to-even) to avoid systematic bias.
 * Input: rational amount in paise (may be fractional).
 */
export function bankersRound(n: number): number {
  const floor = Math.floor(n);
  const frac = n - floor;
  if (Math.abs(frac - 0.5) > 1e-9) return Math.round(n);
  // Exactly 0.5 — round to even
  return floor % 2 === 0 ? floor : floor + 1;
}

// ─── Tax computation ──────────────────────────────────────────────────────────

export function computeTax(subtotalPaise: number, config: TaxConfig): {
  taxLines: TaxLine[];
  totalTaxPaise: number;
} {
  const base =
    config.mode === 'INCLUSIVE'
      ? subtotalPaise - bankersRound((subtotalPaise * config.rate_bps) / (10_000 + config.rate_bps))
      : subtotalPaise;

  const rawTotal = (base * config.rate_bps) / 10_000;
  const totalTaxPaise = bankersRound(rawTotal);

  let allocated = 0;
  const taxLines: TaxLine[] = config.components.map((c, idx) => {
    const isLast = idx === config.components.length - 1;
    const share = isLast
      ? totalTaxPaise - allocated
      : bankersRound((base * c.share_bps) / 10_000);
    allocated += share;
    return { label: c.label, rate_bps: c.share_bps, amount_paise: share };
  });

  return { taxLines, totalTaxPaise };
}

// ─── Fingerprint ──────────────────────────────────────────────────────────────

/**
 * Deterministic fingerprint for PRICE_CHANGED detection.
 * If the quote fingerprint sent by the client != server's freshly-computed one,
 * return HTTP 409 with the new quote so the customer can confirm.
 *
 * Uses a stable JSON stringify (sorted keys).
 */
export function computePriceFingerprint(lines: QuoteLine[]): string {
  const canonical = lines.map((l) => ({
    id: l.menu_item_id,
    u: l.unit_price_paise,
    q: l.quantity,
    m: l.modifiers.map((m) => ({ id: m.modifier_id, p: m.price_paise })),
  }));
  // Simple 64-bit–style FNV hash stringified for portability (no crypto overhead needed)
  const str = JSON.stringify(canonical);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    // eslint-disable-next-line no-bitwise
    h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export interface ComputeQuoteOptions {
  lines: PriceLineInput[];
  taxConfig: TaxConfig;
  /** Phase 7 hook: pass NoopDiscount until loyalty/coupons are implemented */
  discountHook?: DiscountHookResult;
  /** Tip in paise; must be ≥ 0 */
  tipPaise?: number;
  currency?: string;
}

export function computeQuote(opts: ComputeQuoteOptions): OrderQuote {
  const { lines, taxConfig, discountHook, tipPaise = 0, currency = 'INR' } = opts;

  // ── 1. Validate caps ────────────────────────────────────────────────────────
  if (lines.length === 0) throw new PricingValidationError('CART_EMPTY', 'Order must have at least one item.');
  if (lines.length > MAX_LINE_COUNT) {
    throw new PricingValidationError('ORDER_LIMIT_EXCEEDED', `Order exceeds the maximum of ${MAX_LINE_COUNT} lines.`);
  }
  for (const l of lines) {
    if (l.quantity <= 0 || !Number.isInteger(l.quantity)) {
      throw new PricingValidationError('VALIDATION_ERROR', `Invalid quantity ${l.quantity} for item ${l.menu_item_id}.`);
    }
    if (l.quantity > MAX_QTY_PER_LINE) {
      throw new PricingValidationError('ORDER_LIMIT_EXCEEDED', `Quantity ${l.quantity} exceeds max ${MAX_QTY_PER_LINE} for item ${l.menu_item_id}.`);
    }
    if (!Number.isInteger(l.unit_price_paise) || l.unit_price_paise < 0) {
      throw new PricingValidationError('VALIDATION_ERROR', `Invalid price ${l.unit_price_paise} for item ${l.menu_item_id}.`);
    }
  }
  if (!Number.isInteger(tipPaise) || tipPaise < 0) {
    throw new PricingValidationError('VALIDATION_ERROR', `Tip must be a non-negative integer (paise). Got: ${tipPaise}`);
  }
  if (tipPaise > MAX_TIP_PAISE) {
    throw new PricingValidationError('ORDER_LIMIT_EXCEEDED', `Tip exceeds maximum allowed value.`);
  }

  // ── 2. Build quote lines ────────────────────────────────────────────────────
  const quoteLines: QuoteLine[] = lines.map((l) => ({
    menu_item_id: l.menu_item_id,
    name_snapshot: l.name_snapshot,
    unit_price_paise: l.unit_price_paise,
    quantity: l.quantity,
    line_total_paise: l.unit_price_paise * l.quantity,
    modifiers: l.modifiers,
    notes: l.notes,
  }));

  // ── 3. Subtotal ─────────────────────────────────────────────────────────────
  const subtotalPaise = quoteLines.reduce((s, l) => s + l.line_total_paise, 0);

  // ── 4. Tax ──────────────────────────────────────────────────────────────────
  const { taxLines, totalTaxPaise } = computeTax(subtotalPaise, taxConfig);

  // ── 5. Discount ─────────────────────────────────────────────────────────────
  const discountPaise = discountHook?.discount_paise ?? 0;
  const discountDescription = discountHook?.description ?? null;

  // ── 6. Total ────────────────────────────────────────────────────────────────
  // In INCLUSIVE mode, tax is already embedded inside subtotalPaise — never double-add totalTaxPaise.
  const preTipTax = taxConfig.mode === 'INCLUSIVE' ? 0 : totalTaxPaise;
  const rawTotal = subtotalPaise + preTipTax - discountPaise + tipPaise;
  if (rawTotal < 0) {
    throw new PricingValidationError('VALIDATION_ERROR', 'Total cannot be negative after discount.');
  }
  const totalPaise = Math.max(0, rawTotal);

  // ── 7. Rounding adjustment (make sum exact) ─────────────────────────────────
  const computedSum = subtotalPaise + preTipTax - discountPaise + tipPaise;
  const roundingAdjustmentPaise = totalPaise - computedSum; // will be 0 for integer inputs

  // ── 8. Fingerprint ──────────────────────────────────────────────────────────
  const priceFingerprint = computePriceFingerprint(quoteLines);

  return {
    lines: quoteLines,
    subtotal_paise: subtotalPaise,
    tax_lines: taxLines,
    tax_paise: totalTaxPaise,
    discount_paise: discountPaise,
    discount_description: discountDescription,
    tip_paise: tipPaise,
    rounding_adjustment_paise: roundingAdjustmentPaise,
    total_paise: totalPaise,
    currency,
    price_fingerprint: priceFingerprint,
  };
}

// ─── Noop discount (Phase 4 placeholder until Phase 7) ────────────────────────

export const NOOP_DISCOUNT: DiscountHookResult = {
  discount_paise: 0,
  description: '',
  ref_type: 'NONE',
};

// ─── Default tax config (5% GST split 2.5%+2.5%) ─────────────────────────────
// Replace with per-org/outlet tax_config table in Phase 5

export const DEFAULT_GST_CONFIG: TaxConfig = {
  mode: 'EXCLUSIVE',
  rate_bps: 500, // 5%
  components: [
    { label: 'CGST', share_bps: 250 },
    { label: 'SGST', share_bps: 250 },
  ],
};
