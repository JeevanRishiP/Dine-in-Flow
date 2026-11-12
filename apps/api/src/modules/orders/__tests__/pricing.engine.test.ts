import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeQuote,
  computeTax,
  bankersRound,
  computePriceFingerprint,
  PricingValidationError,
  DEFAULT_GST_CONFIG,
  NOOP_DISCOUNT,
  MAX_LINE_COUNT,
  MAX_QTY_PER_LINE,
  type PriceLineInput,
  type TaxConfig,
} from '../pricing.engine.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLine(overrides?: Partial<PriceLineInput>): PriceLineInput {
  return {
    menu_item_id: 'item-1',
    name_snapshot: 'Masala Dosa',
    unit_price_paise: 12000,
    quantity: 2,
    modifiers: [],
    notes: null,
    ...overrides,
  };
}

// ─── Banker's rounding ────────────────────────────────────────────────────────

describe('bankersRound', () => {
  it.each([
    [0.5, 0],   // round to even (0)
    [1.5, 2],   // round to even (2)
    [2.5, 2],   // round to even (2)
    [3.5, 4],   // round to even (4)
    [0.4, 0],
    [1.6, 2],
    [-0.5, 0],  // negative rounds toward even
  ])('bankersRound(%s) = %s', (input, expected) => {
    expect(bankersRound(input)).toBe(expected);
  });
});

// ─── Tax computation ──────────────────────────────────────────────────────────

describe('computeTax', () => {
  it('computes 5% exclusive GST correctly', () => {
    const { taxLines, totalTaxPaise } = computeTax(10000, DEFAULT_GST_CONFIG);
    expect(totalTaxPaise).toBe(500);
    expect(taxLines).toHaveLength(2);
    expect(taxLines[0]!.label).toBe('CGST');
    expect(taxLines[0]!.amount_paise).toBe(250);
    expect(taxLines[1]!.label).toBe('SGST');
    expect(taxLines[1]!.amount_paise).toBe(250);
    expect(taxLines.reduce((s, l) => s + l.amount_paise, 0)).toBe(totalTaxPaise);
  });

  it('computes 18% exclusive GST with 3 components', () => {
    const config: TaxConfig = {
      mode: 'EXCLUSIVE',
      rate_bps: 1800,
      components: [
        { label: 'CGST', share_bps: 900 },
        { label: 'SGST', share_bps: 900 },
      ],
    };
    const { totalTaxPaise, taxLines } = computeTax(10000, config);
    expect(totalTaxPaise).toBe(1800);
    expect(taxLines.reduce((s, l) => s + l.amount_paise, 0)).toBe(totalTaxPaise);
  });

  it('inclusive tax: tax is extracted from the price, not added', () => {
    const config: TaxConfig = {
      mode: 'INCLUSIVE',
      rate_bps: 500, // 5% inclusive
      components: [
        { label: 'CGST', share_bps: 250 },
        { label: 'SGST', share_bps: 250 },
      ],
    };
    const { totalTaxPaise } = computeTax(10500, config);
    // 10500 incl 5% → tax = 10500 * 5 / 105 ≈ 500
    expect(totalTaxPaise).toBe(500);
  });

  it('tax components sum to totalTaxPaise (no leak)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_00 }),
        fc.constantFrom(500, 900, 1800) as fc.Arbitrary<number>,
        (subtotal, rateBps) => {
          const halfBps = rateBps / 2;
          const config: TaxConfig = {
            mode: 'EXCLUSIVE',
            rate_bps: rateBps,
            components: [
              { label: 'A', share_bps: halfBps },
              { label: 'B', share_bps: halfBps },
            ],
          };
          const { taxLines, totalTaxPaise } = computeTax(subtotal, config);
          return taxLines.reduce((s, l) => s + l.amount_paise, 0) === totalTaxPaise;
        },
      ),
    );
  });
});

// ─── computeQuote ─────────────────────────────────────────────────────────────

describe('computeQuote', () => {
  it('basic single-line order', () => {
    const quote = computeQuote({
      lines: [makeLine()],
      taxConfig: DEFAULT_GST_CONFIG,
      discountHook: NOOP_DISCOUNT,
    });
    expect(quote.subtotal_paise).toBe(24000); // 12000 * 2
    expect(quote.tax_paise).toBe(1200);       // 5% of 24000
    expect(quote.discount_paise).toBe(0);
    expect(quote.tip_paise).toBe(0);
    expect(quote.total_paise).toBe(25200);
    expect(quote.lines).toHaveLength(1);
    expect(quote.price_fingerprint).toBeTruthy();
  });

  it('applies discount correctly', () => {
    const quote = computeQuote({
      lines: [makeLine()],
      taxConfig: DEFAULT_GST_CONFIG,
      discountHook: { discount_paise: 2000, description: '₹20 off', ref_type: 'COUPON', ref_id: 'c1' },
    });
    expect(quote.discount_paise).toBe(2000);
    expect(quote.total_paise).toBe(25200 - 2000);
  });

  it('applies tip correctly', () => {
    const quote = computeQuote({
      lines: [makeLine()],
      taxConfig: DEFAULT_GST_CONFIG,
      tipPaise: 500,
    });
    expect(quote.tip_paise).toBe(500);
    expect(quote.total_paise).toBe(25200 + 500);
  });

  it('modifier prices are already included in unit_price_paise (engine does not double-add)', () => {
    const line = makeLine({
      unit_price_paise: 13000, // 12000 base + 1000 modifier
      modifiers: [{ modifier_id: 'mod-1', name: 'Extra Cheese', price_paise: 1000 }],
    });
    const quote = computeQuote({ lines: [line], taxConfig: DEFAULT_GST_CONFIG });
    expect(quote.lines[0]!.unit_price_paise).toBe(13000);
    expect(quote.subtotal_paise).toBe(26000);
  });

  it('throws for empty lines', () => {
    expect(() =>
      computeQuote({ lines: [], taxConfig: DEFAULT_GST_CONFIG }),
    ).toThrow('at least one item');
  });

  it(`throws when line count exceeds ${MAX_LINE_COUNT}`, () => {
    const lines = Array.from({ length: MAX_LINE_COUNT + 1 }, (_, i) =>
      makeLine({ menu_item_id: `item-${i}` }),
    );
    expect(() => computeQuote({ lines, taxConfig: DEFAULT_GST_CONFIG })).toThrow('maximum');
  });

  it('throws when qty exceeds MAX_QTY_PER_LINE', () => {
    expect(() =>
      computeQuote({ lines: [makeLine({ quantity: MAX_QTY_PER_LINE + 1 })], taxConfig: DEFAULT_GST_CONFIG }),
    ).toThrow('max');
  });

  it('throws for non-integer quantity', () => {
    expect(() =>
      computeQuote({ lines: [makeLine({ quantity: 1.5 })], taxConfig: DEFAULT_GST_CONFIG }),
    ).toThrow('Invalid quantity');
  });

  it('throws for negative unit price', () => {
    expect(() =>
      computeQuote({ lines: [makeLine({ unit_price_paise: -1 })], taxConfig: DEFAULT_GST_CONFIG }),
    ).toThrow('Invalid price');
  });

  it('throws when discount exceeds total (total goes negative)', () => {
    expect(() =>
      computeQuote({
        lines: [makeLine({ unit_price_paise: 100, quantity: 1 })],
        taxConfig: DEFAULT_GST_CONFIG,
        discountHook: { discount_paise: 99999999, description: 'over', ref_type: 'MANUAL' },
      }),
    ).toThrow('negative');
  });
});

// ─── Property tests ───────────────────────────────────────────────────────────

describe('pricing engine property tests', () => {
  const arbLine = fc.record({
    menu_item_id: fc.uuid(),
    name_snapshot: fc.string({ minLength: 1, maxLength: 50 }),
    unit_price_paise: fc.integer({ min: 0, max: 100_000_00 }),
    quantity: fc.integer({ min: 1, max: MAX_QTY_PER_LINE }),
    modifiers: fc.constant([]),
    notes: fc.constant(null),
  });

  it('total = subtotal + tax - discount + tip (no floating point leak)', () => {
    fc.assert(
      fc.property(
        fc.array(arbLine, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 5000 }),
        (rawLines, tipPaise) => {
          const lines = rawLines.map((l) => l as PriceLineInput);
          const quote = computeQuote({ lines, taxConfig: DEFAULT_GST_CONFIG, tipPaise });
          const expected =
            quote.subtotal_paise + quote.tax_paise - quote.discount_paise + quote.tip_paise;
          return quote.total_paise === expected;
        },
      ),
    );
  });

  it('total is never negative', () => {
    fc.assert(
      fc.property(
        fc.array(arbLine, { minLength: 1, maxLength: 5 }),
        (rawLines) => {
          const lines = rawLines.map((l) => l as PriceLineInput);
          const quote = computeQuote({ lines, taxConfig: DEFAULT_GST_CONFIG });
          return quote.total_paise >= 0;
        },
      ),
    );
  });

  it('subtotal = sum of line_totals', () => {
    fc.assert(
      fc.property(
        fc.array(arbLine, { minLength: 1, maxLength: 10 }),
        (rawLines) => {
          const lines = rawLines.map((l) => l as PriceLineInput);
          const quote = computeQuote({ lines, taxConfig: DEFAULT_GST_CONFIG });
          const lineSumPaise = quote.lines.reduce((s, l) => s + l.line_total_paise, 0);
          return quote.subtotal_paise === lineSumPaise;
        },
      ),
    );
  });

  it('all values are integers (no floating point)', () => {
    fc.assert(
      fc.property(
        fc.array(arbLine, { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 2000 }),
        (rawLines, tipPaise) => {
          const lines = rawLines.map((l) => l as PriceLineInput);
          const q = computeQuote({ lines, taxConfig: DEFAULT_GST_CONFIG, tipPaise });
          return (
            Number.isInteger(q.total_paise) &&
            Number.isInteger(q.subtotal_paise) &&
            Number.isInteger(q.tax_paise) &&
            Number.isInteger(q.discount_paise) &&
            Number.isInteger(q.tip_paise) &&
            q.tax_lines.every((t) => Number.isInteger(t.amount_paise))
          );
        },
      ),
    );
  });

  it('price_fingerprint is deterministic for identical inputs', () => {
    fc.assert(
      fc.property(
        fc.array(arbLine, { minLength: 1, maxLength: 5 }),
        (rawLines) => {
          const lines = rawLines.map((l) => l as PriceLineInput);
          const q1 = computeQuote({ lines, taxConfig: DEFAULT_GST_CONFIG });
          const q2 = computeQuote({ lines, taxConfig: DEFAULT_GST_CONFIG });
          return q1.price_fingerprint === q2.price_fingerprint;
        },
      ),
    );
  });

  it('price_fingerprint changes when unit price changes', () => {
    fc.assert(
      fc.property(
        arbLine as fc.Arbitrary<PriceLineInput>,
        fc.integer({ min: 1, max: 1000 }),
        (line, delta) => {
          const q1 = computeQuote({ lines: [line], taxConfig: DEFAULT_GST_CONFIG });
          const q2 = computeQuote({
            lines: [{ ...line, unit_price_paise: line.unit_price_paise + delta }],
            taxConfig: DEFAULT_GST_CONFIG,
          });
          return q1.price_fingerprint !== q2.price_fingerprint;
        },
      ),
    );
  });
});

// ─── Price fingerprint ────────────────────────────────────────────────────────

describe('computePriceFingerprint', () => {
  it('same inputs produce same fingerprint', () => {
    const lines = [makeLine()].map((l) => ({
      ...l,
      line_total_paise: l.unit_price_paise * l.quantity,
    }));
    expect(computePriceFingerprint(lines)).toBe(computePriceFingerprint(lines));
  });

  it('different qty changes fingerprint', () => {
    const base = makeLine();
    const l1 = { ...base, line_total_paise: base.unit_price_paise * base.quantity };
    const l2 = { ...base, quantity: base.quantity + 1, line_total_paise: base.unit_price_paise * (base.quantity + 1) };
    expect(computePriceFingerprint([l1])).not.toBe(computePriceFingerprint([l2]));
  });

  it('INCLUSIVE tax mode does not double-add tax to total_paise', () => {
    const inclusiveConfig: TaxConfig = {
      ...DEFAULT_GST_CONFIG,
      mode: 'INCLUSIVE',
    };
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 500_000 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 1000 }),
        (unitPrice, discountPaise, tipPaise) => {
          const line = makeLine({ unit_price_paise: unitPrice, quantity: 1 });
          const safeDiscount = Math.min(discountPaise, unitPrice);
          const q = computeQuote({
            lines: [line],
            taxConfig: inclusiveConfig,
            discountHook: { discount_paise: safeDiscount, description: 'disc', ref_type: 'COUPON' },
            tipPaise,
          });
          return q.tax_paise > 0 && q.total_paise === q.subtotal_paise - safeDiscount + tipPaise;
        },
      ),
    );
  });

  it('throws PricingValidationError with ORDER_LIMIT_EXCEEDED on qty > MAX_QTY_PER_LINE', () => {
    expect(() =>
      computeQuote({
        lines: [makeLine({ quantity: MAX_QTY_PER_LINE + 1 })],
        taxConfig: DEFAULT_GST_CONFIG,
      }),
    ).toThrow(PricingValidationError);
  });
});
