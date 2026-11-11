/**
 * Permission map — the canonical list of all permissions in the system.
 * Every API route must declare one of these or be decorated with @Public().
 * This map is the source of truth; RBAC rules derive from it.
 * Reference: ARCH §12
 */
export const Permission = {
  // ─── Org / tenant management ─────────────────────────────────────────────
  ORG_READ: 'org:read',
  ORG_UPDATE: 'org:update',
  ORG_DELETE: 'org:delete',

  // ─── Outlet management ───────────────────────────────────────────────────
  OUTLET_CREATE: 'outlet:create',
  OUTLET_READ: 'outlet:read',
  OUTLET_UPDATE: 'outlet:update',
  OUTLET_DELETE: 'outlet:delete',

  // ─── Staff management ─────────────────────────────────────────────────────
  STAFF_INVITE: 'staff:invite',
  STAFF_READ: 'staff:read',
  STAFF_UPDATE: 'staff:update',
  STAFF_DEACTIVATE: 'staff:deactivate',

  // ─── Menu management ──────────────────────────────────────────────────────
  MENU_CREATE: 'menu:create',
  MENU_READ: 'menu:read',
  MENU_WRITE: 'menu:write',         // alias covering create+update+delete+publish
  MENU_UPDATE: 'menu:update',
  MENU_DELETE: 'menu:delete',
  MENU_PUBLISH: 'menu:publish',

  // ─── Stock management ─────────────────────────────────────────────────────
  STOCK_UPDATE: 'stock:update',     // toggle item availability (KITCHEN / CAPTAIN)

  // ─── Table / QR management ───────────────────────────────────────────────
  TABLE_CREATE: 'table:create',
  TABLE_READ: 'table:read',
  TABLE_UPDATE: 'table:update',
  TABLE_DELETE: 'table:delete',

  // ─── Order management ────────────────────────────────────────────────────
  ORDER_READ: 'order:read',
  ORDER_UPDATE_STATUS: 'order:update_status',
  ORDER_CANCEL: 'order:cancel',
  ORDER_REFUND: 'order:refund',

  // ─── Kitchen display ─────────────────────────────────────────────────────
  KITCHEN_VIEW: 'kitchen:view',
  KITCHEN_UPDATE: 'kitchen:update',

  // ─── Payment ─────────────────────────────────────────────────────────────
  PAYMENT_READ:      'payment:read',
  PAYMENT_REFUND:    'payment:refund',
  PAYMENT_MARK_PAID: 'payment:mark_paid',  // staff-confirmed payments (CASHIER)
  REFUND_CREATE:     'refund:create',       // initiate gateway refund (MANAGER+)

  // ─── Analytics / reports ─────────────────────────────────────────────────
  REPORT_READ:      'report:read',
  ANALYTICS_VIEW:   'analytics:view',
  ANALYTICS_EXPORT: 'analytics:export',

  // ─── Loyalty / coupons ───────────────────────────────────────────────────
  LOYALTY_MANAGE: 'loyalty:manage',
  COUPON_MANAGE: 'coupon:manage',

  // ─── Customers ───────────────────────────────────────────────────────────
  CUSTOMER_READ: 'customer:read',
  CUSTOMER_UPDATE: 'customer:update',

  // ─── Feedback & Reviews ───────────────────────────────────────────────────
  FEEDBACK_READ:   'feedback:read',
  FEEDBACK_MANAGE: 'feedback:manage',
  REVIEWS_READ:    'reviews:read',
  REVIEWS_REPLY:   'reviews:reply',

  // ─── Messaging ───────────────────────────────────────────────────────────
  MESSAGING_READ:   'messaging:read',
  MESSAGING_SEND:   'messaging:send',
  MESSAGING_MANAGE: 'messaging:manage',

  // ─── AI Menu Assistant ───────────────────────────────────────────────────
  AI_MANAGE: 'ai:manage',
  AI_CHAT:   'ai:chat',

  // ─── Compliance & Privacy (DPDP / GDPR) ──────────────────────────────────
  COMPLIANCE_READ:   'compliance:read',
  COMPLIANCE_MANAGE: 'compliance:manage',

  // ─── Feature flags ───────────────────────────────────────────────────────
  FEATURE_FLAG_MANAGE: 'feature_flag:manage',

  // ─── Guest table session ─────────────────────────────────────────────────
  GUEST_SESSION: 'guest:session',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/**
 * Role → permissions map.
 * When you add a new Permission above, add it to the relevant roles here.
 * Reference: ARCH §12
 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  OWNER: [
    // Owners get everything
    ...Object.values(Permission),
  ] as Permission[],

  MANAGER: [
    Permission.ORG_READ,
    Permission.OUTLET_READ, Permission.OUTLET_UPDATE,
    Permission.STAFF_INVITE, Permission.STAFF_READ, Permission.STAFF_UPDATE, Permission.STAFF_DEACTIVATE,
    Permission.MENU_CREATE, Permission.MENU_READ, Permission.MENU_WRITE,
    Permission.MENU_UPDATE, Permission.MENU_DELETE, Permission.MENU_PUBLISH,
    Permission.STOCK_UPDATE,
    Permission.TABLE_CREATE, Permission.TABLE_READ, Permission.TABLE_UPDATE, Permission.TABLE_DELETE,
    Permission.ORDER_READ, Permission.ORDER_UPDATE_STATUS, Permission.ORDER_CANCEL, Permission.ORDER_REFUND,
    Permission.KITCHEN_VIEW, Permission.KITCHEN_UPDATE,
    Permission.PAYMENT_READ, Permission.PAYMENT_REFUND, Permission.PAYMENT_MARK_PAID, Permission.REFUND_CREATE,
    Permission.REPORT_READ, Permission.ANALYTICS_VIEW, Permission.ANALYTICS_EXPORT,
    Permission.LOYALTY_MANAGE, Permission.COUPON_MANAGE,
    Permission.FEEDBACK_READ, Permission.FEEDBACK_MANAGE, Permission.REVIEWS_READ, Permission.REVIEWS_REPLY,
    Permission.MESSAGING_READ, Permission.MESSAGING_SEND, Permission.MESSAGING_MANAGE,
    Permission.CUSTOMER_READ, Permission.CUSTOMER_UPDATE,
    Permission.AI_MANAGE,
    Permission.COMPLIANCE_READ, Permission.COMPLIANCE_MANAGE,
  ],

  CASHIER: [
    Permission.OUTLET_READ,
    Permission.MENU_READ,
    Permission.TABLE_READ,
    Permission.ORDER_READ, Permission.ORDER_UPDATE_STATUS, Permission.ORDER_CANCEL,
    Permission.KITCHEN_VIEW,
    Permission.PAYMENT_READ, Permission.PAYMENT_MARK_PAID,
    Permission.CUSTOMER_READ,
  ],

  KITCHEN: [
    Permission.OUTLET_READ,
    Permission.MENU_READ,
    Permission.STOCK_UPDATE,
    Permission.ORDER_READ, Permission.ORDER_UPDATE_STATUS,
    Permission.KITCHEN_VIEW, Permission.KITCHEN_UPDATE,
  ],

  WAITER: [
    Permission.OUTLET_READ,
    Permission.MENU_READ,
    Permission.STOCK_UPDATE,
    Permission.TABLE_READ,
    Permission.ORDER_READ, Permission.ORDER_UPDATE_STATUS,
    Permission.KITCHEN_VIEW,
    Permission.CUSTOMER_READ,
  ],

  CAPTAIN: [
    Permission.OUTLET_READ,
    Permission.MENU_READ,
    Permission.STOCK_UPDATE,
    Permission.TABLE_READ,
    Permission.ORDER_READ, Permission.ORDER_UPDATE_STATUS,
    Permission.KITCHEN_VIEW,
    Permission.CUSTOMER_READ,
  ],
};
