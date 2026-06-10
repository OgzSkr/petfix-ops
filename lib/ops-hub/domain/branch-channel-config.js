import { CHANNEL_INTEGRATION_MODES, isOpsChannel } from '../constants.js';

const REQUIRED_FIELDS = Object.freeze({
  trendyol_go: ['sellerId', 'apiKey', 'apiSecret', 'storeId'],
  yemeksepeti: ['clientId', 'clientSecret', 'vendorId', 'chainId'],
  getir: ['shopId']
});

export function defaultChannelConfig(channel) {
  const base = {
    autoAcceptOrders: true
  };

  if (channel === 'yemeksepeti') {
    return { ...base, webhookSecret: '' };
  }

  return base;
}

export function validateBranchChannelConfig({ channel, integrationMode, config }) {
  const errors = [];

  if (!isOpsChannel(channel)) {
    errors.push(`Geçersiz kanal: ${channel}`);
  }

  if (!CHANNEL_INTEGRATION_MODES.includes(integrationMode)) {
    errors.push(`Geçersiz integrationMode: ${integrationMode}`);
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    errors.push('config nesnesi zorunlu');
    return errors;
  }

  if (typeof config.autoAcceptOrders !== 'boolean') {
    errors.push('config.autoAcceptOrders boolean olmalı');
  }

  const required = REQUIRED_FIELDS[channel] || [];
  for (const field of required) {
    const value = String(config[field] ?? '').trim();
    if (!value) {
      errors.push(`config.${field} zorunlu`);
    }
  }

  return errors;
}

export function normalizeBranchChannelConfig({ channel, integrationMode, config, enabled = true }) {
  const errors = validateBranchChannelConfig({ channel, integrationMode, config });
  if (errors.length) {
    throw new Error(errors.join('; '));
  }

  const normalized = {
    ...defaultChannelConfig(channel),
    ...config
  };

  for (const field of REQUIRED_FIELDS[channel] || []) {
    normalized[field] = String(normalized[field]).trim();
  }

  if (channel === 'yemeksepeti' && normalized.webhookSecret != null) {
    normalized.webhookSecret = String(normalized.webhookSecret).trim();
  }

  return {
    channel,
    integrationMode,
    enabled: Boolean(enabled),
    config: normalized
  };
}
