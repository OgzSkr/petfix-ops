import http from 'node:http';
import { readEnvFile, readPlatformConfigEnv, persistPlatformConfigUpdates } from '../env.js';
import { createLogger } from '../logger.js';
import { paths, resolveRuntimeConfig } from '../config.js';
import { readDb, writeDb, ensureDb, migrateDb, configureDbStore } from '../db/store.js';
import { createAuth } from '../auth/index.js';
import { validateSecurityConfig } from '../auth/security.js';
import { createRuntimeState } from '../runtime/state.js';
import { createWorkerService } from './services/worker.js';
import { createDashboardService } from './services/dashboard.js';
import { createBuyboxService } from './services/buybox.js';
import { createProductsService } from './services/products.js';
import { createOrdersService } from './services/orders.js';
import { createChannelOrdersService } from './services/channel-orders.js';
import { createHzlMrktOpsOrdersService } from './services/hzlmrktops-orders.js';
import { createChannelsSummaryService } from './services/channels-summary.js';
import { createLivePerformanceService } from './services/live-performance.js';
import { createChannelSettingsService } from './services/channel-settings.js';
import { createEmailService } from './services/email.js';
import { createOpsService } from './services/ops.js';
import { createActionCenterService } from './services/action-center.js';
import { syncJsonToSqlite } from '../db/sqlite-store.js';
import { readJsonDb } from '../db/store.js';
import { createPageViews } from './views/pages.js';
import { createCommissionTariffService } from './services/commission-tariff.js';
import { createPricingDashboardService } from './services/pricing-dashboard.js';
import { createBenimposService } from './services/benimpos.js';
import { createProductMatchingService } from './services/product-matching.js';
import { createUberOpsService } from './services/uber-ops.js';
import { createChannelMatchingOpsService } from './services/channel-matching-ops.js';
import { createMatchingSyncService } from './services/matching-sync.js';
import { createRouteHandler } from './routes/handler.js';
import { bootstrapOpsHub, getOpsHubState } from '../ops-hub/bootstrap.js';
import { validateProductionConfig } from '../production/validate-config.js';

const log = createLogger('PLATFORM');

let platformEnv = {};
let runtime = createRuntimeState();
let auth = createAuth({ platformApiToken: '', authRequired: true });
let config = resolveRuntimeConfig({});

export async function startPlatform() {
  platformEnv = await readPlatformConfigEnv(paths.platformEnv);
  config = resolveRuntimeConfig(platformEnv);
  validateSecurityConfig(config);
  if (config.nodeEnv === 'production') {
    validateProductionConfig(platformEnv, process.env);
    log.info('Production yapılandırması doğrulandı');
  }

  await configureDbStore({
    sqliteDualWrite: config.sqliteDualWrite,
    dbReadBackend: config.dbReadBackend
  });
  await ensureDb();
  await migrateDb();

  auth = createAuth(config);
  runtime = createRuntimeState();

  await bootstrapOpsHub(platformEnv);

  const worker = createWorkerService({ runtime, config });
  const dashboard = createDashboardService({ buildLiveStatus: worker.buildLiveStatus });
  const commissionTariff = createCommissionTariffService();
  const pricingDashboard = createPricingDashboardService();
  const buybox = createBuyboxService({
    runtime,
    dashboardRowForBarcode: dashboard.dashboardRowForBarcode,
    migrateAutoTrackListFromFile: dashboard.migrateAutoTrackListFromFile
  });
  const products = createProductsService();
  const orders = createOrdersService({ runtime, config });
  const channelOrders = createChannelOrdersService({ runtime, config });
  const hzlmrktopsOrders = createHzlMrktOpsOrdersService({ channelOrders });
  const channelsSummary = createChannelsSummaryService({ orders, channelOrders });
  const livePerformance = createLivePerformanceService({ orders, channelOrders });
  const channelSettings = createChannelSettingsService();
  const benimpos = createBenimposService({ config });
  const productMatching = createProductMatchingService();
  const uberOps = createUberOpsService({ productMatching, config });
  const channelMatchingOps = createChannelMatchingOpsService({ productMatching, config });
  const matchingSync = createMatchingSyncService({
    runtime,
    productMatching,
    uberOps,
    channelMatchingOps
  });
  const email = createEmailService({ runtime, platformEnv });
  const ops = createOpsService({ runtime, config, worker });
  const actionCenter = createActionCenterService({ dashboard, channelsSummary, ops, channelMatchingOps });
  const views = createPageViews(auth, {
    productMatchingMode: config.productMatchingMode,
    productMatchingModeByChannel: config.productMatchingModeByChannel
  });

  const handleRequest = createRouteHandler({
    auth,
    views,
    dashboard,
    buybox,
    worker,
    products,
    orders,
    channelOrders,
    hzlmrktopsOrders,
    channelsSummary,
    livePerformance,
    channelSettings,
    benimpos,
    productMatching,
    uberOps,
    channelMatchingOps,
    matchingSync,
    email,
    ops,
    actionCenter,
    commissionTariff,
    pricingDashboard
  });

  const server = http.createServer(handleRequest);

  await new Promise((resolve) => {
    server.listen(config.port, config.host, () => {
      log.info(`PetFix Panel: http://${config.host}:${config.port}`);
      log.info(`DB read backend: ${config.dbReadBackend} (dual-write: ${config.sqliteDualWrite ? 'on' : 'off'})`);
      log.info(`Ürün eşleştirme modu: ${config.productMatchingMode}`);
      const opsHub = getOpsHubState();
      if (opsHub.enabled) {
        log.info(`Ops Hub: PostgreSQL hazır (/health, /ready, /ops/v1/*)`);
      } else {
        log.warn(`Ops Hub devre dışı${opsHub.error ? `: ${opsHub.error}` : ' (OPS_POSTGRES_URL yok)'}`);
      }
      if (auth.isEnabled()) {
        log.info('PLATFORM_API_TOKEN aktif — tüm API ve panel verisi korumalı.');
      } else if (config.allowInsecure) {
        log.warn('AUTH_ALLOW_INSECURE=true — geliştirme modu, production için kapatın.');
      }
      email.scheduleMonitor(false);
      matchingSync.scheduleSync(false);
      productMatching.rebuildWorkbenchIndexIfNeeded?.().catch((error) => {
        log.warn(`Gelen Kutusu indeksi arka planda oluşturulamadı: ${error.message}`);
      });
      if (config.sqliteDualWrite) {
        void (async () => {
          try {
            log.info('SQLite arka plan senkronu başlıyor…');
            await syncJsonToSqlite(await readJsonDb());
            log.info('SQLite arka plan senkronu tamamlandı');
          } catch (error) {
            log.warn(`SQLite arka plan senkronu atlandı: ${error.message}`);
          }
        })();
      }
      resolve();
    });
  });

  return { server, config, auth };
}

export { readDb, writeDb } from '../db/store.js';
export { calculateProfit } from './services/profitability.js';
