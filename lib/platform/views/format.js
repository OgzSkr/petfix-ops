import { toNumber } from '../../utils.js';

export function formatCurrency(value) {
  if (value === '' || value === null || value === undefined) {
    return '';
  }

  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY'
  }).format(toNumber(value));
}

export function formatDateTime(value) {
  if (!value) {
    return '';
  }

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Europe/Istanbul'
  }).format(new Date(value));
}

export function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function liveStatusClass(status) {
  if (status.live) {
    return 'ok';
  }

  return status.configured ? 'warn' : 'bad';
}

export function liveStatusLabel(status) {
  if (status.live) {
    return 'Canlı';
  }

  return status.configured ? 'Bekliyor' : 'Eksik';
}

export function liveStatusDetail(status) {
  if (!status.configured) {
    const missing = status.missingCredentials || [];
    return missing.length
      ? `Eksik: ${missing.map(readableCredentialName).join(', ')}`
      : 'Trendyol API bilgileri eksik';
  }

  if (!status.updatedAt) {
    return 'Cache henuz olusmadi';
  }

  return `Son veri: ${status.ageSeconds} sn once`;
}

export function readableCredentialName(key) {
  const names = {
    TRENDYOL_SELLER_ID: 'Satıcı ID',
    TRENDYOL_API_KEY: 'API Key',
    TRENDYOL_API_SECRET: 'API Secret'
  };

  return names[key] || key;
}
