import { envValue } from '../env.js';
import { OPS_FEATURE_FLAGS } from './constants.js';

/** Canlı VPS — eğitim modu devre dışı; panel/runtime dosyası açsa bile etkisiz. */
export function isOpsProductionLive() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function resolveShadowModeDefault(processEnv, platformEnv) {
  if (isOpsProductionLive()) {
    return false;
  }
  const raw = envValue(processEnv, platformEnv, 'OPS_SHADOW_MODE_DEFAULT', 'true');
  return raw === 'true' || raw === '1';
}

export function resolveOpsHubConfig(platformEnv = {}) {
  const postgresUrl = envValue(process.env, platformEnv, 'OPS_POSTGRES_URL', '').trim();
  const shadowModeDefault = resolveShadowModeDefault(process.env, platformEnv);
  const flags = {};

  for (const flag of OPS_FEATURE_FLAGS) {
    flags[flag] = envBool(process.env, platformEnv, flag, false);
  }

  return {
    postgresUrl,
    postgresEnabled: Boolean(postgresUrl),
    shadowModeDefault,
    publicApiBaseUrl: envValue(
      process.env,
      platformEnv,
      'OPS_PUBLIC_API_BASE_URL',
      'https://api.petfix.com.tr'
    ).replace(/\/$/, ''),
    flags
  };
}

function envBool(processEnv, fileEnv, key, fallback = false) {
  const fromFile = fileEnv?.[key];
  if (fromFile !== undefined && fromFile !== null && String(fromFile).trim() !== '') {
    return String(fromFile).toLowerCase() === 'true' || fromFile === '1';
  }
  const raw = envValue(processEnv, fileEnv, key, fallback ? 'true' : 'false');
  return String(raw).toLowerCase() === 'true' || raw === '1';
}
