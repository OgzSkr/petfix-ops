import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { fetchTgoGroceryPackages, probeTgoGroceryPackages } from '../channels/tgo-grocery-fetch.js';
import {
  isTgoOpsConfigured,
  normalizeTgoGroceryPackage,
  ACTIVE_PACKAGE_STATUSES
} from '../channels/tgo-normalize.js';
import { resolveTgoOpsConfig } from '../integrations/branch-config-resolver.js';
import { ingestOpsOrder } from '../ingest/ingest-service.js';
import { probeUberEatsApis } from '../../channels/uber-eats-health.js';

export async function syncTgoReadOnly(pool, options = {}) {
  const cfg = options.cfg || (await resolveTgoOpsConfig(pool, {
    branchId: options.branchId,
    platformEnv: options.platformEnv
  }));
  if (!isTgoOpsConfigured(cfg)) {
    const error = new Error('TGO credential eksik — UBER_EATS_* .env değerlerini kontrol edin.');
    error.statusCode = 400;
    throw error;
  }

  const fetchOptions = {
    pageSize: options.pageSize || 50,
    maxPages: options.maxPages || 5,
    storeId: options.storeId || cfg.storeId || undefined,
    limit: options.limit || 100,
    packageStatus: options.packageStatus || options.activeOnly ? ACTIVE_PACKAGE_STATUSES : undefined
  };

  const packages = await fetchTgoGroceryPackages(cfg, fetchOptions);
  const results = {
    fetched: packages.length,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    orders: []
  };

  for (const pkg of packages) {
    try {
      const normalized = await normalizeTgoGroceryPackage(pkg, {
        shadowMode: options.shadowMode ?? true,
        platformEnv: options.platformEnv
      });

      if (!normalized.ok) {
        results.failed += 1;
        results.errors.push({
          externalId: String(pkg.id),
          errors: normalized.errors
        });
        continue;
      }

      const ingest = await ingestOpsOrder(pool, normalized.order, {
        shadowModeDefault: options.shadowMode ?? true,
        branchSlug: options.branchSlug || 'main'
      });

      if (ingest.duplicate) {
        results.duplicates += 1;
      } else {
        results.ingested += 1;
      }

      results.orders.push({
        externalId: normalized.order.externalId,
        orderId: ingest.orderId,
        duplicate: ingest.duplicate,
        displayId: normalized.order.displayId,
        status: normalized.order.status
      });
    } catch (error) {
      results.failed += 1;
      results.errors.push({
        externalId: String(pkg.id),
        errors: [error.message]
      });
    }
  }

  return results;
}

export async function buildIntegrationsHealth(platformEnv = null) {
  const env = platformEnv || (await readEnvFile(paths.platformEnv));
  const cfg = await resolveTgoOpsConfig(null, { platformEnv: env });
  const configured = isTgoOpsConfigured(cfg);

  const trendyolGo = {
    channel: 'trendyol_go',
    gate: 'G1',
    result: 'PARTIAL',
    configured,
    readOnly: true,
    writeEnabled: false,
    statusWrite: {
      accept: 'PUT .../packages/{id}/accept',
      picked: 'PUT .../packages/{id}/picked',
      probed: true
    },
    packages: { ok: false, message: 'Denenmedi' },
    catalog: { ok: false, message: 'Denenmedi' }
  };

  if (configured) {
    trendyolGo.packages = await probeTgoGroceryPackages(cfg);
    const probe = await probeUberEatsApis(cfg);
    trendyolGo.catalog = probe.catalog;
    trendyolGo.ordersApi = probe.orders;
    trendyolGo.result = trendyolGo.packages.ok ? 'PARTIAL' : 'FAIL';
  } else {
    trendyolGo.packages.message = 'UBER_EATS_* credential eksik';
  }

  return {
    generatedAt: new Date().toISOString(),
    channels: {
      trendyol_go: trendyolGo,
      yemeksepeti: {
        channel: 'yemeksepeti',
        gate: 'G4',
        result: 'PARTIAL',
        configured: Boolean(env.YEMEKSEPETI_CLIENT_ID || process.env.YEMEKSEPETI_CLIENT_ID),
        readOnly: true,
        writeEnabled: false,
        message: 'Webhook deploy sonrası ingest açılacak (PR sonrası)'
      },
      getir: {
        channel: 'getir',
        gate: 'G3',
        result: 'FAIL',
        configured: false,
        readOnly: false,
        writeEnabled: false,
        message: 'GETIR credential yok'
      }
    }
  };
}
