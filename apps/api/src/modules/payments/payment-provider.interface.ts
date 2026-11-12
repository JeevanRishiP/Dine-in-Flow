/**
 * PaymentProvider interface — canonical contract all gateway adapters implement.
 *
 * Design principles (AGENTS §2 rule 2+9, ARCH §11):
 *  - createPayment / refund are idempotent; callers pass an idempotencyKey.
 *  - verifyWebhook operates on the raw body Buffer — never the parsed JSON.
 *  - NormalizedEvent is a stable internal type; provider quirks are mapped here.
 *  - Amount is ALWAYS integer paise; currency is always ISO 4217 3-letter code.
 *
 * Provider routing (user spec):
 *  - UPI / UPI_INTENT → PhonePe
 *  - CARD / NETBANKING / WALLET → Razorpay
 *  - CASH / DIRECT_UPI_STAFF / PAY_AT_COUNTER → no gateway (staff-confirmed only)
 */

export type PaymentMethod =
  | 'UPI'
  | 'UPI_INTENT'
  | 'CARD'
  | 'NETBANKING'
  | 'WALLET'
  | 'CASH'
  | 'DIRECT_UPI_STAFF'
  | 'PAY_AT_COUNTER';

export type PaymentStatusNormalized =
  | 'PENDING'
  | 'PAID'
  | 'FAILED';

export type RefundStatusNormalized =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED';

export interface SplitSettlementConfig {
  /** Sub-merchant / linked account identifier for SaaS / agency split settlement */
  linkedAccountId?: string;
  /** Platform fee or commission deducted in paise (optional) */
  platformFeePaise?: number;
}

export interface CreatePaymentInput {
  orderId:         string;
  idempotencyKey:  string;
  amountPaise:     number;    // integer paise — never float
  currency:        string;    // 'INR'
  method:          PaymentMethod;
  returnUrl:       string;    // redirect URL after hosted checkout
  customerPhone?:  string;    // E.164 — helps UPI pre-fill
  customerName?:   string;
  notes?:          Record<string, string>;
  splitSettlement?: SplitSettlementConfig;
}

export interface CreatePaymentResult {
  providerOrderId:  string;
  /** For UPI: deep-link or QR payload. For card: Razorpay checkout options JSON. */
  checkoutPayload:  Record<string, unknown>;
}

export interface NormalizedEvent {
  eventId:          string;
  providerOrderId:  string;
  providerPaymentId?: string;
  status:           PaymentStatusNormalized;
  amountPaise:      number;    // integer paise
  currency:         string;
  method?:          string;
  feePaise?:        number;
  raw:              unknown;   // provider raw event for audit storage
}

export interface NormalizedPayment {
  providerOrderId:  string;
  providerPaymentId?: string;
  status:           PaymentStatusNormalized;
  amountPaise:      number;
  currency:         string;
  feePaise?:        number;
}

export interface RefundInput {
  providerPaymentId: string;
  amountPaise:       number;   // integer paise
  reason:            string;
  idempotencyKey:    string;   // mapped to gateway idempotency param
}

export interface NormalizedRefund {
  providerRefundId: string;
  status:           RefundStatusNormalized;
  amountPaise:      number;
}

/**
 * The contract every gateway adapter MUST implement.
 * Pure business logic must NOT depend on any specific adapter — only this interface.
 */
export interface PaymentProvider {
  readonly name: string;

  /** Create a gateway payment order / transaction. Idempotent via idempotencyKey. */
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /**
   * Verify and decode a webhook payload.
   * MUST operate on rawBody (Buffer) — never the parsed body.
   * Returns { valid: false } if signature check fails; do NOT throw.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): { valid: boolean; eventId: string; event: NormalizedEvent };

  /** Pull current payment status from the gateway (for reconciliation). */
  fetchPayment(providerOrderId: string): Promise<NormalizedPayment>;

  /** Initiate a refund. Idempotent via idempotencyKey. */
  refund(input: RefundInput): Promise<NormalizedRefund>;
}

/** Injection token for the provider map */
export const PAYMENT_PROVIDERS = 'PAYMENT_PROVIDERS';
