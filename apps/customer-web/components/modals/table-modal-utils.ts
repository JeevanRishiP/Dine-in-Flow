import {
  DEFAULT_DEV_OUTLET_ID,
  DEFAULT_DEV_ORG_ID,
  matchHotelTable,
  type OutletTableInfo,
} from '../../app/lib/guest-session.ts';

export interface TableValidationResult {
  matched: OutletTableInfo | null;
  error: string;
}

/**
 * Validates table digits against the outlet's table directory in real time.
 * Gracefully falls back to DEFAULT_DEV_OUTLET_ID in development environments
 * if activeOutletId is null/missing to prevent blocking test workflows.
 */
export function getLiveTableValidation(
  digits: string,
  outletTables: OutletTableInfo[],
  outletTablesLoaded: boolean,
  activeOutletId?: string | null,
  onDevFallbackTrigger?: (devOutletId: string) => void,
): TableValidationResult {
  if (!digits) return { matched: null, error: '' };
  const matched = matchHotelTable(digits, outletTables);
  if (!outletTablesLoaded) return { matched, error: '' };

  if (outletTables.length === 0) {
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
    if (isDev && (!activeOutletId || activeOutletId === null)) {
      if (onDevFallbackTrigger) {
        onDevFallbackTrigger(DEFAULT_DEV_OUTLET_ID);
      }
      return { matched: null, error: '' };
    }
    return { matched: null, error: 'Table directory unavailable for this hotel outlet.' };
  }

  if (!matched) {
    return {
      matched: null,
      error: `Table ${digits} is wrong — please enter a valid table number at this hotel.`,
    };
  }
  return { matched, error: '' };
}

export { DEFAULT_DEV_OUTLET_ID, DEFAULT_DEV_ORG_ID };
