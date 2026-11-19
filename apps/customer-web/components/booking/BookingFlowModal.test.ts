import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTimeSlots,
  formatAvailabilityMessage,
  type AvailabilityResult,
} from './booking-utils.ts';

test('BookingFlowModal generateTimeSlots generates 15-minute intervals between 11 AM and 11 PM', () => {
  // Tomorrow's date: should generate full range from 11:00 AM to 10:45 PM
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const slots = generateTimeSlots(tomorrow, 30);
  assert.ok(slots.length > 0, 'Slots should not be empty');

  // Check first slot is 11:00 AM
  assert.equal(slots[0]!.label, '11:00 AM');

  // Check last slot is 10:45 PM
  const lastSlot = slots[slots.length - 1]!;
  assert.equal(lastSlot.label, '10:45 PM');

  // Interval check: difference between consecutive slots should be exactly 15 minutes (900,000 ms)
  for (let i = 1; i < slots.length; i++) {
    const diff = slots[i]!.date.getTime() - slots[i - 1]!.date.getTime();
    assert.equal(diff, 15 * 60 * 1000, `Slot interval between ${slots[i - 1]!.label} and ${slots[i]!.label} should be 15 mins`);
  }
});

test('BookingFlowModal generateTimeSlots for today filters out slots earlier than minMinutesFromNow', () => {
  const now = new Date();
  const slots = generateTimeSlots(now, 30);

  // All returned slots must be at least 30 minutes in future (or empty if restaurant is closed)
  for (const slot of slots) {
    const diffMinutes = (slot.date.getTime() - now.getTime()) / 60000;
    assert.ok(diffMinutes >= 29.9, `Slot ${slot.label} should be at least 30m in future, got ${diffMinutes}`);
  }
});

test('BookingFlowModal formatAvailabilityMessage formats feedback for single, combined, and full tables', () => {
  // Case 1: Checking (null)
  const checking = formatAvailabilityMessage(null, 4);
  assert.equal(checking.isSuccess, false);
  assert.equal(checking.text, 'Checking table availability...');

  // Case 2: Full / Unavailable
  const unavailable: AvailabilityResult = {
    available: false,
    tables: [],
    total_capacity: 0,
    guest_count: 4,
    reserved_for: new Date().toISOString(),
  };
  const unavailRes = formatAvailabilityMessage(unavailable, 4);
  assert.equal(unavailRes.isSuccess, false);
  assert.ok(unavailRes.text.includes('All tables are currently reserved'));

  // Case 3: Single Table Available
  const singleTable: AvailabilityResult = {
    available: true,
    tables: [{ id: 'tbl-4', table_number: 'T04', capacity: 4 }],
    total_capacity: 4,
    guest_count: 4,
    reserved_for: new Date().toISOString(),
  };
  const singleRes = formatAvailabilityMessage(singleTable, 4);
  assert.equal(singleRes.isSuccess, true);
  assert.equal(singleRes.text, '✓ Table T04 (4-Seater) available for 4 Guests');

  // Case 4: Combined Tables Available (e.g. 6 guests on T05 + T06)
  const combinedTables: AvailabilityResult = {
    available: true,
    tables: [
      { id: 'tbl-5', table_number: 'T05', capacity: 4 },
      { id: 'tbl-6', table_number: 'T06', capacity: 4 },
    ],
    total_capacity: 8,
    guest_count: 6,
    reserved_for: new Date().toISOString(),
  };
  const combinedRes = formatAvailabilityMessage(combinedTables, 6);
  assert.equal(combinedRes.isSuccess, true);
  assert.equal(combinedRes.text, '✓ Tables T05 + T06 combined for 6 Guests (Total Capacity: 8)');
});
