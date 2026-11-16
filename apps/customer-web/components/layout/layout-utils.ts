/**
 * Pluralizes dish item count for active table order tracking.
 */
export function formatOrderTrackerSubtitle(count: number): string {
  if (count <= 0) {
    return 'View active orders & course releases';
  }
  const itemWord = count === 1 ? 'item' : 'items';
  return `${count} ${itemWord} cooking / served · Tap to view timeline`;
}

/**
 * Truncates customer display name to initials for the top navigation profile chip.
 */
export function formatProfileInitials(displayName?: string | null): string {
  if (!displayName || !displayName.trim()) {
    return 'ME';
  }
  const clean = displayName.trim().replace(/[^a-zA-Z0-9\s]/g, '');
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return 'ME';
}
