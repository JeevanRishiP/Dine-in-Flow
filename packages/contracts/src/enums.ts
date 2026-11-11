/**
 * Shared enums used across API and frontend.
 * Reference: ARCH §7
 */

export const VegType = {
  VEG: 'VEG',
  NON_VEG: 'NON_VEG',
  EGG: 'EGG',
  VEGAN: 'VEGAN',
} as const;
export type VegType = (typeof VegType)[keyof typeof VegType];

export const VerificationMode = {
  PAY_FIRST: 'PAY_FIRST',
  VERIFIED_PAY_LATER: 'VERIFIED_PAY_LATER',
  HYBRID: 'HYBRID',
} as const;
export type VerificationMode = (typeof VerificationMode)[keyof typeof VerificationMode];

export const OrderStatus = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  SERVED: 'SERVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentStatus = {
  UNPAID: 'UNPAID',
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const TableSessionStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  EXPIRED: 'EXPIRED',
} as const;
export type TableSessionStatus = (typeof TableSessionStatus)[keyof typeof TableSessionStatus];

export const StaffRole = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  CAPTAIN: 'CAPTAIN',
  KITCHEN: 'KITCHEN',
  CASHIER: 'CASHIER',
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];

export const ItemStatus = {
  AVAILABLE: 'AVAILABLE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  HIDDEN: 'HIDDEN',
} as const;
export type ItemStatus = (typeof ItemStatus)[keyof typeof ItemStatus];

export const PaymentMethod = {
  UPI: 'UPI',
  CARD: 'CARD',
  NETBANKING: 'NETBANKING',
  WALLET: 'WALLET',
  CASH: 'CASH',
  DIRECT_UPI_STAFF: 'DIRECT_UPI_STAFF',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const Currency = {
  INR: 'INR',
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];
