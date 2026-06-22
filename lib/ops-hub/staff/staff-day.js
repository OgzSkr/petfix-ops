/** Mağaza günlük operasyonu — İstanbul takvim günü (ordered_at). */
export const STAFF_DAY_ORDERED_AT_SQL = `(ordered_at AT TIME ZONE 'Europe/Istanbul')::date >= (NOW() AT TIME ZONE 'Europe/Istanbul')::date`;

export function isStaffScope(scope) {
  return String(scope || '').trim().toLowerCase() === 'staff';
}
