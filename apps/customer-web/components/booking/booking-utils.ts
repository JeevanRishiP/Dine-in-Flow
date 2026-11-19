export interface AvailableTableOption {
  id: string;
  table_number: string;
  capacity: number;
}

export interface AvailabilityResult {
  available: boolean;
  tables: AvailableTableOption[];
  total_capacity: number;
  guest_count: number;
  reserved_for: string;
}

export interface SlotOption {
  label: string;
  iso: string;
  date: Date;
}

/**
 * Generate 15-minute booking slots for a given day.
 * If today, ensures minimum offset (default 30 mins from now).
 */
export function generateTimeSlots(targetDate: Date, minMinutesFromNow = 30): SlotOption[] {
  const slots: SlotOption[] = [];
  const now = new Date();
  const isToday =
    targetDate.getFullYear() === now.getFullYear() &&
    targetDate.getMonth() === now.getMonth() &&
    targetDate.getDate() === now.getDate();

  const startHour = 11; // 11:00 AM lunch opening
  const endHour = 23; // 11:00 PM last order

  const slotDate = new Date(targetDate);
  slotDate.setSeconds(0, 0);

  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += 15) {
      slotDate.setHours(h, m, 0, 0);
      if (isToday) {
        const diffMinutes = (slotDate.getTime() - now.getTime()) / 60000;
        if (diffMinutes < minMinutesFromNow) continue;
      }
      const hour12 = h % 12 || 12;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const minuteStr = m < 10 ? `0${m}` : `${m}`;
      slots.push({
        label: `${hour12}:${minuteStr} ${ampm}`,
        iso: slotDate.toISOString(),
        date: new Date(slotDate),
      });
    }
  }

  return slots;
}

export function formatAvailabilityMessage(
  res: AvailabilityResult | null,
  count: number,
): { text: string; isSuccess: boolean } {
  if (!res) {
    return { text: 'Checking table availability...', isSuccess: false };
  }
  if (!res.available || res.tables.length === 0) {
    return {
      text: '⚠️ All tables are currently reserved for this slot. Please select another time.',
      isSuccess: false,
    };
  }
  if (res.tables.length === 1) {
    const t = res.tables[0]!;
    return {
      text: `✓ Table ${t.table_number} (${t.capacity}-Seater) available for ${count} ${count === 1 ? 'Guest' : 'Guests'}`,
      isSuccess: true,
    };
  }
  const tableNames = res.tables.map((t) => t.table_number).join(' + ');
  return {
    text: `✓ Tables ${tableNames} combined for ${count} Guests (Total Capacity: ${res.total_capacity})`,
    isSuccess: true,
  };
}
