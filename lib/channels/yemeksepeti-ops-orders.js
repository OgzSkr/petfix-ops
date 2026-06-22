import { readEnvFile } from '../env.js';
import { paths } from '../config.js';
import { fetchOpsOrderPackages, mergeChannelOrderSources } from './ops-orders-bridge.js';
import { enrichYemeksepetiOrderPackages } from './yemeksepeti-order-enrich.js';
import { resolveYemeksepetiOpsConfig } from '../ops-hub/integrations/branch-config-resolver.js';
import { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } from '../ops-hub/bootstrap.js';

export { fetchOpsOrderPackages as fetchYemeksepetiOrdersFromOps } from './ops-orders-bridge.js';

/** Partner API + Ops Hub (YS webhook) siparişlerini birleştirir. */
export async function mergeYemeksepetiOrderSources(apiPackages, options = {}) {
  const merged = await mergeChannelOrderSources('yemeksepeti', apiPackages, options);

  try {
    const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
    if (!isOpsHubReady()) {
      await bootstrapOpsHub(platformEnv);
    }
    const pool = getOpsHubPool();
    const cfg = options.cfg || (await resolveYemeksepetiOpsConfig(pool, { platformEnv }));
    return enrichYemeksepetiOrderPackages(merged, cfg, { platformEnv, pool });
  } catch {
    return merged;
  }
}
