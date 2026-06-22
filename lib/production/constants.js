export const ORDER_SOURCES = Object.freeze({
  WEBHOOK: 'webhook',
  PARTNER_API: 'partner_api',
  PORTAL: 'portal_api',
  FIXTURE: 'fixture',
  MANUAL: 'manual'
});

export const PROFIT_CONFIDENCE = Object.freeze({
  COMPLETE: 'complete',
  ESTIMATED: 'estimated',
  MISSING_COST: 'missing_cost',
  MISSING_MAPPING: 'missing_mapping',
  INVALID_DATA: 'invalid_data'
});

export const KPI_EXCLUDED_SOURCES = Object.freeze([ORDER_SOURCES.FIXTURE]);

export const LOG_COMPONENTS = Object.freeze({
  YS_WEBHOOK: 'YS-WEBHOOK',
  CHANNEL_ORDERS: 'CHANNEL-ORDERS',
  ORDER_INGEST: 'ORDER-INGEST',
  PROFIT_CALC: 'PROFIT-CALCULATION',
  BENIMPOS_SYNC: 'BENIMPOS-SYNC',
  READINESS: 'READINESS',
  DEPLOY: 'DEPLOY'
});
