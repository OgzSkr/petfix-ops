/**
 * Yemeksepeti Partner API vendor_id / store_id çözümlemesi.
 * Dokümantasyon: store_id veya external_partner_config_id vendor segmentinde kullanılabilir.
 */

import { envValue } from '../env.js';

export function resolveYemeksepetiVendorIds(cfg = {}, platformEnv = {}) {
  const ids = new Set();
  const add = (value) => {
    const text = String(value ?? '').trim();
    if (text) ids.add(text);
  };

  add(cfg.vendorId);
  add(cfg.storeId);
  add(cfg.externalPartnerConfigId);
  add(envValue(process.env, platformEnv, 'YEMEKSEPETI_VENDOR_ID'));
  add(envValue(process.env, platformEnv, 'YEMEKSEPETI_STORE_ID'));
  add(envValue(process.env, platformEnv, 'YEMEKSEPETI_EXTERNAL_PARTNER_CONFIG_ID'));

  for (const part of String(envValue(process.env, platformEnv, 'YEMEKSEPETI_VENDOR_IDS')).split(/[,;\s]+/)) {
    add(part);
  }

  return [...ids];
}

export async function discoverYemeksepetiVendorIdsFromOps(pool) {
  if (!pool) return [];

  const result = await pool.query(
    `SELECT DISTINCT NULLIF(TRIM(COALESCE(
        raw_payload->'yemeksepetiOrder'->>'vendor_id',
        raw_payload->'yemeksepetiOrder'->>'store_id',
        raw_payload->'yemeksepetiOrder'->>'external_partner_config_id',
        raw_payload->>'vendorId',
        raw_payload->>'storeId'
      )), '') AS vendor_id
     FROM ops_orders
     WHERE channel = 'yemeksepeti'`
  );

  return result.rows.map((row) => String(row.vendor_id || '').trim()).filter(Boolean);
}

export async function listYemeksepetiVendorIds(cfg, platformEnv = {}, pool = null) {
  const discovered = await discoverYemeksepetiVendorIdsFromOps(pool);
  const merged = new Set([...resolveYemeksepetiVendorIds(cfg, platformEnv), ...discovered]);
  return [...merged];
}
