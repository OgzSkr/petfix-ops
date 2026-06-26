import http from 'node:http';
import { readPlatformConfigEnv, readEnvFile, envValue, applyPlatformEnvToProcess } from '../env.js';
import { createLogger } from '../logger.js';
import { paths, resolveRuntimeConfig } from '../config.js';
import { readDb, writeDb, ensureDb, migrateDb, configureDbStore } from '../db/store.js';
import { createAuth } from '../auth/index.js';
import { validateSecurityConfig } from '../auth/security.js';
import { createRuntimeState } from '../runtime/state.js';
import { createChannelOrdersService } from './services/channel-orders.js';
import { createHzlMrktOpsOrdersService } from './services/hzlmrktops-orders.js';
import { createChannelsSummaryService } from './services/channels-summary.js';
import { createChannelSettingsService } from './services/channel-settings.js';
import { createOpsService } from './services/ops.js';
import { createOpsActionCenterService } from './services/ops-action-center.js';
import { syncJsonToSqlite } from '../db/sqlite-store.js';
import { readJsonDb } from '../db/store.js';
import { createPageViews } from './views/pages.js';
import { createBenimposService } from './services/benimpos.js';
import { createProductMatchingService } from './services/product-matching.js';
import { createUberOpsService } from './services/uber-ops.js';
import { createChannelMatchingOpsService } from './services/channel-matching-ops.js';
import { createMatchingSyncService } from './services/matching-sync.js';
import { createOpsPollSyncService } from './services/ops-poll-sync.js';
import { createOpsPreferencesService } from './services/ops-preferences.js';
import { createStockAutoSyncService } from './services/stock-auto-sync.js';
import { createChannelControlService } from './services/channel-control.js';
import { createWorkerScheduler } from './services/worker-scheduler.js';
import { createOpsDashboardSummaryService } from './services/ops-dashboard-summary.js';
import { createOpsActivityFeedService, bindOpsActivityFeed } from './services/ops-activity-feed.js';
import { createOpsSystemModeService } from './services/ops-system-mode.js';
import { createRouteHandler } from './routes/handler.js';
import { bootstrapOpsHub, getOpsHubState, shutdownOpsHub } from '../ops-hub/bootstrap.js';
import { registerYemeksepetiCatalogSyncHandler } from '../runtime/catalog-sync-hooks.js';
import { validateProductionConfig } from '../production/validate-config.js';

const log = createLogger('OPS');

let platformEnv = {};
let runtime = createRuntimeState();
let auth = createAuth({ platformApiToken: '', authRequired: true });
let config = resolveRuntimeConfig({});

let shuttingDown = false;

function registerProcessSafety(server) {
  if (process.env.__PETFIX_PROCESS_SAFETY === '1') return;
  process.env.__PETFIX_PROCESS_SAFETY = '1';

  const gracefulShutdown = async (signal, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.warn(`${signal} alındı — kapanış başlıyor`);

    const forceTimer = setTimeout(() => {
      log.error('Kapanış zaman aşımına uğradı — zorla çıkılıyor');
      process.exit(exitCode || 1);
    }, 15000);
    forceTimer.unref();

    try {
      await new Promise((resolve) => server.close(resolve));
      log.info('HTTP sunucusu kapandı');
    } catch (error) {
      log.error(`Sunucu kapatma hatası: ${error.message}`);
    }

    try {
      await shutdownOpsHub();
      log.info('Ops Hub bağlantı havuzu kapandı');
    } catch (error) {
      log.error(`Ops Hub kapatma hatası: ${error.message}`);
    }

    clearTimeout(forceTimer);
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM', 0));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT', 0));

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    log.error(`İşlenmeyen promise reddi: ${message}`);
  });

  process.on('uncaughtException', (error) => {
    log.error(`Yakalanmayan istisna: ${error.stack || error.message}`);
    void gracefulShutdown('uncaughtException', 1);
  });
}

export async function startPlatform() {
  platformEnv = await readPlatformConfigEnv(paths.platformEnv);
  applyPlatformEnvToProcess(platformEnv);
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

  const channelSettings = createChannelSettingsService();
  const benimpos = createBenimposService({ config });
  const productMatching = createProductMatchingService();
  const uberOps = createUberOpsService({ productMatching, config });
  const channelMatchingOps = createChannelMatchingOpsService({ productMatching, config });
  const stockAutoSync = createStockAutoSyncService({ runtime, productMatching });
  const matchingSync = createMatchingSyncService({
    runtime,
    productMatching,
    uberOps,
    channelMatchingOps,
    stockAutoSync
  });
  const opsActivityFeed = createOpsActivityFeedService({ runtime });
  bindOpsActivityFeed(opsActivityFeed);
  const opsPollSync = createOpsPollSyncService({ runtime, opsActivityFeed });
  const opsPreferences = createOpsPreferencesService({ opsPollSync, stockAutoSync });
  const workerScheduler = createWorkerScheduler({
    runtime,
    matchingSync,
    opsPollSync,
    stockAutoSync,
    getOpsPool: () => getOpsHubState().pool || null
  });
  const channelControl = createChannelControlService({ matchingSync, opsPollSync, workerScheduler });
  const opsSystemMode = createOpsSystemModeService({ runtime, opsPollSync, matchingSync });
  const channelOrders = createChannelOrdersService({ runtime, config, opsActivityFeed });
  const hzlmrktopsOrders = createHzlMrktOpsOrdersService({ channelOrders });
  const channelsSummary = createChannelsSummaryService({ orders: null, channelOrders });
  const ops = createOpsService({ runtime, config, opsPollSync });
  const actionCenter = createOpsActionCenterService({ channelsSummary, ops, channelMatchingOps });
  const dashboardSummary = createOpsDashboardSummaryService({
    ops,
    channelMatchingOps,
    channelsSummary,
    getOpsHubContext: async () => {
      const hub = getOpsHubState();
      if (!hub.enabled || !hub.pool || !hub.branch?.id) return null;
      return { pool: hub.pool, branchId: hub.branch.id };
    }
  });

  registerYemeksepetiCatalogSyncHandler(async ({ reason } = {}) => {
    log.info(`YS katalog webhook sync tetiklendi (${reason || 'webhook'})`);
    return productMatching.syncYemeksepetiCatalogProducts({ maxPages: null });
  });
  const views = createPageViews(auth, {
    productMatchingMode: config.productMatchingMode,
    productMatchingModeByChannel: config.productMatchingModeByChannel
  });

  const handleRequest = createRouteHandler({
    auth,
    config,
    views,
    channelOrders,
    hzlmrktopsOrders,
    channelsSummary,
    channelSettings,
    benimpos,
    productMatching,
    uberOps,
    channelMatchingOps,
    matchingSync,
    opsPollSync,
    opsPreferences,
    stockAutoSync,
    channelControl,
    opsActivityFeed,
    opsSystemMode,
    ops,
    actionCenter,
    dashboardSummary,
    workerScheduler
  });

  const server = http.createServer(handleRequest);

  server.requestTimeout = 120000;
  server.headersTimeout = 65000;
  server.keepAliveTimeout = 61000;
  server.timeout = 0;

  registerProcessSafety(server);

  await new Promise((resolve) => {
    server.listen(config.port, config.host, () => {
      log.info(`PetFix Ops: http://${config.host}:${config.port}`);
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
      workerScheduler.startAll().catch((error) => {
        log.warn(`Worker scheduler başlatılamadı: ${error.message}`);
      });
      void readEnvFile(paths.platformEnv).then((platformEnv) => {
        const workbenchOnStart = String(
          envValue(process.env, platformEnv, 'WORKBENCH_REBUILD_ON_START', 'false')
        ).toLowerCase();
        if (workbenchOnStart === 'true' || workbenchOnStart === '1') {
          productMatching.rebuildWorkbenchIndexIfNeeded?.().catch((error) => {
            log.warn(`Gelen Kutusu indeksi arka planda oluşturulamadı: ${error.message}`);
          });
        }
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
