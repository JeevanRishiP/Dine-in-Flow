import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useOrderStore } from '../../store/useOrderStore.ts';
import { formatOrderTrackerSubtitle, formatProfileInitials } from './layout-utils.ts';

describe('TopNavBar & OrderTrackerBanner Layout (layout.test.ts)', () => {
  beforeEach(() => {
    useOrderStore.setState({
      selectedTable: '4',
      isTableVerified: true,
      cartLines: [],
      activeOrderCount: 0,
      activeModal: null,
      isOrdersHistoryOpen: false,
      isCartOpen: false,
      isTableModalOpen: false,
      isAuthModalOpen: false,
    });
  });

  describe('formatOrderTrackerSubtitle', () => {
    it('returns empty placeholder when count is 0 or negative', () => {
      assert.equal(formatOrderTrackerSubtitle(0), 'View active orders & course releases');
      assert.equal(formatOrderTrackerSubtitle(-2), 'View active orders & course releases');
    });

    it('formats singular item correctly', () => {
      assert.equal(
        formatOrderTrackerSubtitle(1),
        '1 item cooking / served · Tap to view timeline',
      );
    });

    it('formats plural items correctly', () => {
      assert.equal(
        formatOrderTrackerSubtitle(4),
        '4 items cooking / served · Tap to view timeline',
      );
    });
  });

  describe('formatProfileInitials', () => {
    it('returns ME when display name is absent or empty', () => {
      assert.equal(formatProfileInitials(null), 'ME');
      assert.equal(formatProfileInitials(undefined), 'ME');
      assert.equal(formatProfileInitials('   '), 'ME');
    });

    it('returns first two letters of a single name in uppercase', () => {
      assert.equal(formatProfileInitials('Rishi'), 'RI');
      assert.equal(formatProfileInitials('A'), 'A');
    });

    it('returns first letter of first name and last name when two words', () => {
      assert.equal(formatProfileInitials('Rishi Patel'), 'RP');
      assert.equal(formatProfileInitials('Dr. Jane Doe'), 'DJ');
    });
  });

  describe('useOrderStore activeOrderCount & modal integration', () => {
    it('updates activeOrderCount cleanly and clamps negative values to 0', () => {
      useOrderStore.getState().setActiveOrderCount(3);
      assert.equal(useOrderStore.getState().activeOrderCount, 3);

      useOrderStore.getState().setActiveOrderCount(-5);
      assert.equal(useOrderStore.getState().activeOrderCount, 0);
    });

    it('triggers orders history modal state cleanly', () => {
      useOrderStore.getState().setIsOrdersHistoryOpen(true);
      assert.equal(useOrderStore.getState().isOrdersHistoryOpen, true);
      assert.equal(useOrderStore.getState().activeModal, 'orders');

      useOrderStore.getState().setIsOrdersHistoryOpen(false);
      assert.equal(useOrderStore.getState().isOrdersHistoryOpen, false);
      assert.equal(useOrderStore.getState().activeModal, null);
    });

    it('triggers cart and table modal state cleanly', () => {
      useOrderStore.getState().setIsCartOpen(true);
      assert.equal(useOrderStore.getState().isCartOpen, true);
      assert.equal(useOrderStore.getState().activeModal, 'cart');

      useOrderStore.getState().setIsTableModalOpen(true);
      assert.equal(useOrderStore.getState().isTableModalOpen, true);
      assert.equal(useOrderStore.getState().activeModal, 'table');
    });
  });
});
