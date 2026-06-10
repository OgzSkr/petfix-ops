/** Trendyol Pazaryeri vs diğer kanallar (Uber Eats, Getir, …) için ayrı maliyet setleri. */
export const COST_SCOPE = {
  TRENDYOL_MARKETPLACE: 'trendyol-marketplace',
  OTHER_CHANNELS: 'other-channels'
};

export const COST_SCOPE_LABELS = {
  [COST_SCOPE.TRENDYOL_MARKETPLACE]: 'Trendyol Pazaryeri',
  [COST_SCOPE.OTHER_CHANNELS]: 'Diğer Kanallar'
};

export function normalizeCostScope(value) {
  const scope = String(value || '').trim();
  if (scope === COST_SCOPE.OTHER_CHANNELS) {
    return COST_SCOPE.OTHER_CHANNELS;
  }
  return COST_SCOPE.TRENDYOL_MARKETPLACE;
}

export function costScopeForChannel(channelId) {
  const id = String(channelId || '').trim();
  if (id === 'trendyol-marketplace' || id === 'trendyol') {
    return COST_SCOPE.TRENDYOL_MARKETPLACE;
  }
  return COST_SCOPE.OTHER_CHANNELS;
}

export function costsForScope(db, scope = COST_SCOPE.TRENDYOL_MARKETPLACE) {
  if (normalizeCostScope(scope) === COST_SCOPE.OTHER_CHANNELS) {
    return db.channelCosts || [];
  }
  return db.costs || [];
}

export function costCollectionKey(scope = COST_SCOPE.TRENDYOL_MARKETPLACE) {
  return normalizeCostScope(scope) === COST_SCOPE.OTHER_CHANNELS ? 'channelCosts' : 'costs';
}
