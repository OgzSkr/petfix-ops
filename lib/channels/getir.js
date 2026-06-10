import { ChannelAdapter } from './base-adapter.js';
import { readEnvFile } from '../env.js';
import { paths } from '../config.js';
import { isMissingConfigValue } from '../env.js';

/** Getir — scaffold (sync kapalı). */
export class GetirAdapter extends ChannelAdapter {
  constructor() {
    super('getir', 'Getir');
    this.syncEnabled = false;
  }

  async loadConfig() {
    const env = await readEnvFile(paths.platformEnv);
    return {
      apiKey: env.GETIR_API_KEY || process.env.GETIR_API_KEY || '',
      restaurantId: env.GETIR_RESTAURANT_ID || process.env.GETIR_RESTAURANT_ID || ''
    };
  }

  isConfigured(cfg) {
    return Boolean(cfg.apiKey && !isMissingConfigValue(cfg.apiKey));
  }

  async healthCheck() {
    const cfg = await this.loadConfig();
    return {
      ok: false,
      configured: this.isConfigured(cfg),
      syncEnabled: false,
      message: this.isConfigured(cfg)
        ? 'Yapılandırıldı — sipariş sync yakında açılacak'
        : 'API bilgilerini girince sipariş ve kârlılık takibi başlayacak'
    };
  }

  async fetchOrders() {
    return [];
  }
}
