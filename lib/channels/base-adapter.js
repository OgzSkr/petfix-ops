/**
 * Base contract for marketplace channel adapters.
 * Profit calculation stays in order-profitability.js — adapters only fetch/normalize.
 */
export class ChannelAdapter {
  constructor(id, label) {
    this.id = id;
    this.label = label;
  }

  async healthCheck() {
    return { ok: false, message: 'Not implemented' };
  }

  async fetchOrders(_options = {}) {
    return [];
  }

  async fetchProducts(_options = {}) {
    return [];
  }

  normalizeOrder(raw) {
    return raw;
  }
}
