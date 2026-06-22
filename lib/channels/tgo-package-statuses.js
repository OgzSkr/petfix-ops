/** TGO grocery packageStatus değerleri — döngüsüz paylaşılan sabitler. */
export const ACTIVE_PACKAGE_STATUSES = Object.freeze([
  'Created',
  'Picking',
  'Invoiced',
  'Shipped'
]);

export const TERMINAL_PACKAGE_STATUSES = Object.freeze([
  'Delivered',
  'Cancelled',
  'UnDelivered',
  'Returned'
]);

export const TGO_PACKAGE_FETCH_STATUSES = Object.freeze([
  ...ACTIVE_PACKAGE_STATUSES,
  ...TERMINAL_PACKAGE_STATUSES
]);
