export type TemplateCategory = 'AUTHENTICATION' | 'UTILITY' | 'MARKETING';

export interface TemplateDefinition {
  name: string;
  category: TemplateCategory;
  description: string;
  requiredVars: string[];
  dltTemplateId?: string; // For Indian TRAI DLT SMS fallback compliance
  textTemplates: Record<string, string>; // language -> text with {{var}} placeholders
}

/**
 * Pre-approved, industry-standard WhatsApp templates.
 * Designed for scalability, high deliverability, and strict adherence to Meta & TRAI policies.
 *
 * Reference: ARCH §20 (Template registry in code + DB)
 */
export const TEMPLATE_REGISTRY: Record<string, TemplateDefinition> = {
  // ─── AUTHENTICATION ──────────────────────────────────────────────────────────
  auth_otp_v1: {
    name: 'auth_otp_v1',
    category: 'AUTHENTICATION',
    description: 'One-Time Password for customer phone verification and sign-in',
    requiredVars: ['code'],
    dltTemplateId: 'DLT_TE_DINEFLOW_OTP_01',
    textTemplates: {
      en: '{{code}} is your DineFlow verification code. Valid for 10 minutes. Do not share this code with anyone.',
      hi: '{{code}} आपका DineFlow सत्यापन कोड है। 10 मिनट के लिए मान्य। इसे किसी के साथ साझा न करें।',
    },
  },

  // ─── UTILITY (Transactional) ─────────────────────────────────────────────────
  order_receipt_v1: {
    name: 'order_receipt_v1',
    category: 'UTILITY',
    description: 'Order receipt with order number, amount, and digital invoice link',
    requiredVars: ['customer_name', 'order_ref', 'total_amount', 'receipt_url'],
    textTemplates: {
      en: 'Hello {{customer_name}},\n\nThank you for dining with us! Your order #{{order_ref}} total is {{total_amount}}.\n\nView your itemized digital receipt here: {{receipt_url}}',
      hi: 'नमस्ते {{customer_name}},\n\nहमारे साथ भोजन करने के लिए धन्यवाद! आपका ऑर्डर #{{order_ref}} कुल {{total_amount}} है।\n\nअपनी रसीद यहाँ देखें: {{receipt_url}}',
    },
  },

  order_status_v1: {
    name: 'order_status_v1',
    category: 'UTILITY',
    description: 'Live order status update (Confirmed, Preparing, Ready, Served)',
    requiredVars: ['order_ref', 'status', 'eta_or_table'],
    textTemplates: {
      en: 'Update for order #{{order_ref}}: Your order is now *{{status}}* ({{eta_or_table}}). Enjoy your meal!',
      hi: 'ऑर्डर #{{order_ref}} के लिए अपडेट: आपका ऑर्डर अब *{{status}}* ({{eta_or_table}}) है।',
    },
  },

  table_bill_v1: {
    name: 'table_bill_v1',
    category: 'UTILITY',
    description: 'Bill ready notification with secure payment link',
    requiredVars: ['table_name', 'total_amount', 'payment_url'],
    textTemplates: {
      en: 'Your bill for {{table_name}} is ready: {{total_amount}}.\n\nTap to pay securely via UPI, Card, or Netbanking: {{payment_url}}',
      hi: '{{table_name}} के लिए आपका बिल तैयार है: {{total_amount}}।\n\nUPI या कार्ड द्वारा सुरक्षित भुगतान करें: {{payment_url}}',
    },
  },

  feedback_request_v1: {
    name: 'feedback_request_v1',
    category: 'UTILITY',
    description: 'Neutral post-order feedback reminder (NO incentive wording per ARCH §19)',
    requiredVars: ['customer_name', 'feedback_url', 'review_url'],
    textTemplates: {
      en: 'Hi {{customer_name}},\n\nWe hope you enjoyed your meal! Please let us know how your experience was: {{feedback_url}}\n\nYou can also share your review on Google: {{review_url}}',
      hi: 'नमस्ते {{customer_name}},\n\nआशा है आपको भोजन पसंद आया! कृपया अपना अनुभव साझा करें: {{feedback_url}}\n\nआप Google पर भी समीक्षा छोड़ सकते हैं: {{review_url}}',
    },
  },

  // ─── MARKETING (Consent-gated, quiet hours, frequency capped) ───────────────
  loyalty_points_v1: {
    name: 'loyalty_points_v1',
    category: 'MARKETING',
    description: 'Notification of earned loyalty store credit points',
    requiredVars: ['customer_name', 'points_earned', 'wallet_balance'],
    textTemplates: {
      en: 'Hi {{customer_name}},\n\nYou just earned {{points_earned}} in DineFlow store credit! Your current balance is {{wallet_balance}}. Redeem it on your next dine-in visit.\n\nReply STOP to unsubscribe.',
      hi: 'नमस्ते {{customer_name}},\n\nआपको DineFlow स्टोर क्रेडिट में {{points_earned}} मिले हैं! आपका बैलेंस {{wallet_balance}} है।\n\nरोकने के लिए STOP लिखकर उत्तर दें।',
    },
  },

  promotional_offer_v1: {
    name: 'promotional_offer_v1',
    category: 'MARKETING',
    description: 'Special dining offers and seasonal coupons',
    requiredVars: ['customer_name', 'headline', 'coupon_code', 'expiry_date', 'opt_out_link'],
    textTemplates: {
      en: 'Hi {{customer_name}},\n\n{{headline}}! Use coupon code *{{coupon_code}}* on your next visit (valid until {{expiry_date}}).\n\nOpt-out: {{opt_out_link}} or reply STOP.',
      hi: 'नमस्ते {{customer_name}},\n\n{{headline}}! कूपन कोड *{{coupon_code}}* का उपयोग करें (वैधता: {{expiry_date}})।\n\nरोकने के लिए STOP लिखें।',
    },
  },
};

/**
 * Validates whether all required variables for a template are present in params.
 */
export function validateTemplateParams(
  templateName: string,
  params: Record<string, string>,
): { valid: boolean; missingVars: string[] } {
  const tpl = TEMPLATE_REGISTRY[templateName];
  if (!tpl) {
    return { valid: false, missingVars: [`Unknown template: ${templateName}`] };
  }

  const missing: string[] = [];
  for (const v of tpl.requiredVars) {
    if (params[v] === undefined || params[v] === null || params[v].trim() === '') {
      missing.push(v);
    }
  }

  return {
    valid: missing.length === 0,
    missingVars: missing,
  };
}

/**
 * Pure function: renders template text replacing `{{var}}` with params.
 */
export function renderTemplateText(
  templateName: string,
  params: Record<string, string>,
  language: string = 'en',
): string {
  const tpl = TEMPLATE_REGISTRY[templateName];
  if (!tpl) {
    throw new Error(`Template '${templateName}' not found in registry`);
  }

  const langTemplate = tpl.textTemplates[language] || tpl.textTemplates['en'] || '';
  let rendered = langTemplate;

  for (const [key, value] of Object.entries(params)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }

  return rendered;
}
