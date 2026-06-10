/** Shared profit / fee constants — keep in sync with order-profitability settings. */
export const CARGO_BY_DESI = {
  1: 86.4,
  2: 86.4,
  3: 90,
  4: 102,
  5: 102,
  6: 159.74,
  7: 159.74,
  8: 159.74,
  9: 159.74,
  10: 159.74,
  11: 187.5,
  12: 187.5,
  13: 187.5,
  14: 187.5,
  15: 187.5,
  16: 225,
  17: 225,
  18: 225,
  19: 225,
  20: 225,
  21: 299,
  22: 299,
  23: 299,
  24: 299,
  25: 299
};

export const SERVICE_FEE = 13.19;
export const VAT_RATE = 0.2;
export const MARKETPLACE_VAT_PERCENT = VAT_RATE * 100;
export const STOPPAGE_RATE_PERCENT = 1;

export function profitAnalysisSettings() {
  return {
    cargoByDesi: CARGO_BY_DESI,
    serviceFee: SERVICE_FEE,
    stoppageRate: STOPPAGE_RATE_PERCENT,
    marketplaceVatRate: MARKETPLACE_VAT_PERCENT
  };
}

/** Kanala özel kârlılık varsayılanları — kendi mağaza vs pazaryeri. */
export function profitAnalysisSettingsForChannel(channelId) {
  const base = profitAnalysisSettings();
  const id = String(channelId || '').trim();

  if (id === 'woocommerce') {
    return {
      ...base,
      serviceFee: 0,
      defaultCommissionRate: 0
    };
  }

  return base;
}
