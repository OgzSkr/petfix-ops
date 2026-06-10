/** @readonly — registry bağımlılığı yok; resolve/matcher tarafından güvenle import edilir. */
export const MAPPING_STATUS = {
  AUTO_MATCHED: 'auto_matched',
  MANUAL_CONFIRMED: 'manual_confirmed',
  PENDING: 'pending',
  BARCODE_CONFLICT: 'barcode_conflict',
  MISSING_MASTER: 'missing_master',
  MISSING_CHANNEL: 'missing_channel',
  REVIEW_REQUIRED: 'review_required'
};

/** @readonly */
export const MATCH_METHOD = {
  AUTO_BARCODE: 'auto_barcode',
  AUTO_FUZZY: 'auto_fuzzy',
  MANUAL: 'manual'
};

/** legacy | hybrid | strict */
export const PRODUCT_MATCHING_MODES = ['legacy', 'hybrid', 'strict'];

/** Uber kanal ürünü inceleme sınıflandırması */
export const CHANNEL_PRODUCT_REVIEW = {
  UNREVIEWED: 'unreviewed',
  MANUAL_MATCH_NEEDED: 'manual_match_needed',
  NEEDS_PRODUCT_CARD: 'needs_product_card',
  OUT_OF_SCOPE: 'out_of_scope',
  SUSPICIOUS: 'suspicious',
  SALES_BLOCKED: 'sales_blocked'
};

export const CHANNEL_PRODUCT_REVIEW_LABELS = {
  [CHANNEL_PRODUCT_REVIEW.UNREVIEWED]: 'İncelenmedi',
  [CHANNEL_PRODUCT_REVIEW.MANUAL_MATCH_NEEDED]: 'BenimPOS\'ta farklı barkod — manuel eşleştir',
  [CHANNEL_PRODUCT_REVIEW.NEEDS_PRODUCT_CARD]: 'BenimPOS\'ta yok — ürün kartı gerekli',
  [CHANNEL_PRODUCT_REVIEW.OUT_OF_SCOPE]: 'Pasif / eski / test — kapsam dışı',
  [CHANNEL_PRODUCT_REVIEW.SUSPICIOUS]: 'Barkod veya gramaj şüpheli — kontrol gerek',
  [CHANNEL_PRODUCT_REVIEW.SALES_BLOCKED]: 'Kritik çakışma — satış engelli'
};
