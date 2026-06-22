/** Ops kanalları (Uber Eats, Getir, YS) için maliyet seti. */
export const COST_SCOPE = {
  OTHER_CHANNELS: 'other-channels'
};

export const COST_SCOPE_LABELS = {
  [COST_SCOPE.OTHER_CHANNELS]: 'Kanal maliyetleri'
};

export function normalizeCostScope(value) {
  return COST_SCOPE.OTHER_CHANNELS;
}

export function costScopeForChannel(_channelId) {
  return COST_SCOPE.OTHER_CHANNELS;
}

export function costsForScope(db, _scope = COST_SCOPE.OTHER_CHANNELS) {
  return db.channelCosts || [];
}

export function costCollectionKey(_scope = COST_SCOPE.OTHER_CHANNELS) {
  return 'channelCosts';
}
