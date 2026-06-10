import { toNumber } from '../utils.js';

export function resolveCommissionTier(item, price) {
  const amount = toNumber(price);
  if (!item || !amount) return null;

  const tier1Lower = toNumber(item.tier1Lower);
  const tier2Upper = toNumber(item.tier2Upper);
  const tier2Lower = toNumber(item.tier2Lower);
  const tier3Upper = toNumber(item.tier3Upper);
  const tier3Lower = toNumber(item.tier3Lower);
  const tier4Upper = toNumber(item.tier4Upper);

  if (tier1Lower && amount >= tier1Lower) {
    return { tier: 1, rate: toNumber(item.commission1), priceUsed: amount };
  }
  if (tier2Lower && tier2Upper && amount >= tier2Lower && amount <= tier2Upper) {
    return { tier: 2, rate: toNumber(item.commission2), priceUsed: amount };
  }
  if (tier3Lower && tier3Upper && amount >= tier3Lower && amount <= tier3Upper) {
    return { tier: 3, rate: toNumber(item.commission3), priceUsed: amount };
  }
  if (tier4Upper && amount <= tier4Upper) {
    return { tier: 4, rate: toNumber(item.commission4), priceUsed: amount };
  }

  const fallbackRate = toNumber(item.currentCommission);
  if (fallbackRate) {
    return { tier: 0, rate: fallbackRate, priceUsed: amount, fallback: true };
  }

  return null;
}

export function resolveCommissionForPrice(item, price) {
  const resolved = resolveCommissionTier(item, price);
  return resolved?.rate ?? null;
}

export function tierSummary(item) {
  if (!item) return [];
  return [
    { tier: 1, lower: item.tier1Lower, upper: null, rate: item.commission1 },
    { tier: 2, lower: item.tier2Lower, upper: item.tier2Upper, rate: item.commission2 },
    { tier: 3, lower: item.tier3Lower, upper: item.tier3Upper, rate: item.commission3 },
    { tier: 4, lower: null, upper: item.tier4Upper, rate: item.commission4 }
  ].filter((entry) => entry.rate !== '' && entry.rate !== null && entry.rate !== undefined);
}
