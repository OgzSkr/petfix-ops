import { envValue } from '../env.js';
import { PRODUCT_MATCHING_MODES } from './mapping-types.js';

export function normalizeProductMatchingMode(raw) {
  const value = String(raw || 'legacy').trim().toLowerCase();
  return PRODUCT_MATCHING_MODES.includes(value) ? value : 'legacy';
}

/**
 * legacy veya PRODUCT_MATCHING_ENABLED=false → kanal barkodu doğrudan kullanılır; eşleştirme UI kapalı.
 */
export function isProductMatchingEnabled(platformEnv = {}, options = {}) {
  const envFlag = String(
    envValue(process.env, platformEnv, 'PRODUCT_MATCHING_ENABLED', '')
  ).trim().toLowerCase();
  if (envFlag === 'false' || envFlag === '0') {
    return false;
  }
  if (envFlag === 'true' || envFlag === '1') {
    return true;
  }

  const mode = normalizeProductMatchingMode(
    options.globalMode ?? envValue(process.env, platformEnv, 'PRODUCT_MATCHING_MODE', 'legacy')
  );
  return mode !== 'legacy';
}

export function effectiveProductMatchingMode(platformEnv = {}, options = {}) {
  if (!isProductMatchingEnabled(platformEnv, options)) {
    return 'legacy';
  }
  return normalizeProductMatchingMode(
    options.globalMode ?? envValue(process.env, platformEnv, 'PRODUCT_MATCHING_MODE', 'legacy')
  );
}
