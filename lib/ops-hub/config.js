import { envValue } from '../env.js';
import { OPS_FEATURE_FLAGS } from './constants.js';

export function resolveOpsHubConfig(platformEnv = {}) {
  const postgresUrl = envValue(process.env, platformEnv, 'OPS_POSTGRES_URL', '').trim();
  const shadowModeDefault = envValue(process.env, platformEnv, 'OPS_SHADOW_MODE_DEFAULT', 'true');
  const flags = {};

  for (const flag of OPS_FEATURE_FLAGS) {
    flags[flag] = envBool(process.env, platformEnv, flag, false);
  }

  return {
    postgresUrl,
    postgresEnabled: Boolean(postgresUrl),
    shadowModeDefault: shadowModeDefault === 'true' || shadowModeDefault === '1',
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
  const raw = envValue(processEnv, fileEnv, key, fallback ? 'true' : 'false');
  return String(raw).toLowerCase() === 'true' || raw === '1';
}
