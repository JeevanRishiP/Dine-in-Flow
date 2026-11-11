import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_REGISTRY,
  validateTemplateParams,
  renderTemplateText,
} from '../template.registry.js';

describe('Template Registry (Phase 9)', () => {
  it('contains pre-approved industry-standard templates for auth, utility, and marketing', () => {
    expect(TEMPLATE_REGISTRY['auth_otp_v1']).toBeDefined();
    expect(TEMPLATE_REGISTRY['auth_otp_v1']?.category).toBe('AUTHENTICATION');

    expect(TEMPLATE_REGISTRY['order_receipt_v1']).toBeDefined();
    expect(TEMPLATE_REGISTRY['order_receipt_v1']?.category).toBe('UTILITY');

    expect(TEMPLATE_REGISTRY['order_status_v1']).toBeDefined();
    expect(TEMPLATE_REGISTRY['order_status_v1']?.category).toBe('UTILITY');

    expect(TEMPLATE_REGISTRY['table_bill_v1']).toBeDefined();
    expect(TEMPLATE_REGISTRY['table_bill_v1']?.category).toBe('UTILITY');

    expect(TEMPLATE_REGISTRY['feedback_request_v1']).toBeDefined();
    expect(TEMPLATE_REGISTRY['feedback_request_v1']?.category).toBe('UTILITY');

    expect(TEMPLATE_REGISTRY['loyalty_points_v1']).toBeDefined();
    expect(TEMPLATE_REGISTRY['loyalty_points_v1']?.category).toBe('MARKETING');

    expect(TEMPLATE_REGISTRY['promotional_offer_v1']).toBeDefined();
    expect(TEMPLATE_REGISTRY['promotional_offer_v1']?.category).toBe('MARKETING');
  });

  it('validates template parameters accurately', () => {
    const valid = validateTemplateParams('order_receipt_v1', {
      customer_name: 'Rahul',
      order_ref: 'DF-101',
      total_amount: '₹450',
      receipt_url: 'https://dineflow.in/receipt/101',
    });
    expect(valid.valid).toBe(true);
    expect(valid.missingVars).toHaveLength(0);

    const invalid = validateTemplateParams('order_receipt_v1', {
      customer_name: 'Rahul',
      // missing order_ref, total_amount, receipt_url
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.missingVars).toContain('order_ref');
    expect(invalid.missingVars).toContain('total_amount');
    expect(invalid.missingVars).toContain('receipt_url');
  });

  it('renders template text correctly replacing parameters in English and Hindi', () => {
    const renderedEn = renderTemplateText(
      'table_bill_v1',
      {
        table_name: 'Table 4',
        total_amount: '₹850',
        payment_url: 'https://dineflow.in/pay/t4',
      },
      'en',
    );
    expect(renderedEn).toContain('Table 4');
    expect(renderedEn).toContain('₹850');
    expect(renderedEn).toContain('https://dineflow.in/pay/t4');

    const renderedHi = renderTemplateText(
      'table_bill_v1',
      {
        table_name: 'Table 4',
        total_amount: '₹850',
        payment_url: 'https://dineflow.in/pay/t4',
      },
      'hi',
    );
    expect(renderedHi).toContain('Table 4');
    expect(renderedHi).toContain('₹850');
  });

  it('ensures feedback_request_v1 contains NO incentive or reward wording (ARCH §19)', () => {
    const textEn = TEMPLATE_REGISTRY['feedback_request_v1']?.textTemplates['en'] || '';
    const textHi = TEMPLATE_REGISTRY['feedback_request_v1']?.textTemplates['hi'] || '';

    // Must not link reviews to rewards or points
    expect(textEn.toLowerCase()).not.toContain('points for review');
    expect(textEn.toLowerCase()).not.toContain('reward for review');
    expect(textEn.toLowerCase()).not.toContain('discount for review');
    expect(textHi.toLowerCase()).not.toContain('रिव्यू के बदले');
  });
});
