import { paths } from '../../config.js';
import { getDbReadMeta, readDb, readJsonFile } from '../../db/store.js';
import { getSqliteFileStats } from '../../db/sqlite-store.js';
import { listChannels } from '../../channels/registry.js';
import { readEnvFile } from '../../env.js';
import { ensureMatchingSyncState } from '../../product-matching/matching-sync-schedule.js';

export function createOpsService({ runtime, config, worker }) {
  async function buildOpsStatus() {
    const memory = process.memoryUsage();
    const liveStatus = await worker.buildLiveStatus();
    const dbMeta = getDbReadMeta();
    const sqliteStats = await getSqliteFileStats();
    const cache = await readJsonFile(paths.buyboxCache, null);
    const cacheUpdatedAt = cache?.updatedAt || '';
    const cacheAgeSeconds = cacheUpdatedAt
      ? Math.round((Date.now() - new Date(cacheUpdatedAt).getTime()) / 1000)
      : null;

    const db = await readDb();
    const platformEnv = await readEnvFile(paths.platformEnv);
    const matchingSyncSettings = ensureMatchingSyncState(db, platformEnv);

    return {
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      nodeEnv: config.nodeEnv,
      memory: {
        rssMb: roundMb(memory.rss),
        heapUsedMb: roundMb(memory.heapUsed),
        heapTotalMb: roundMb(memory.heapTotal),
        externalMb: roundMb(memory.external)
      },
      db: {
        readBackend: config.dbReadBackend,
        lastReadSource: dbMeta.source,
        fallbackActive: dbMeta.fallback,
        dualWrite: config.sqliteDualWrite,
        lastReadAt: dbMeta.readAt,
        lastReadError: dbMeta.error,
        parityOk: dbMeta.parity?.ok ?? null,
        parityMismatches: dbMeta.parity?.mismatches || [],
        collectionMismatches: dbMeta.parity?.collectionMismatches || [],
        parityCounts: dbMeta.parity?.counts || null,
        sqlite: sqliteStats
      },
      worker: {
        running: Boolean(runtime.workerProcess),
        startedAt: runtime.workerStartedAt || null,
        lastLog: runtime.workerLastLog || '',
        configured: liveStatus.configured,
        live: liveStatus.live,
        missingCredentials: liveStatus.missingCredentials
      },
      cache: {
        exists: Boolean(cache),
        itemCount: Array.isArray(cache?.items) ? cache.items.length : 0,
        updatedAt: cacheUpdatedAt || null,
        ageSeconds: cacheAgeSeconds,
        live: liveStatus.live
      },
      sync: {
        lastCacheSyncAt: runtime.lastCacheSyncAt
          ? new Date(runtime.lastCacheSyncAt).toISOString()
          : null,
        lastOrdersFetchAt: runtime.lastOrdersFetchAt
          ? new Date(runtime.lastOrdersFetchAt).toISOString()
          : null
      },
      matchingSync: {
        enabled: Boolean(matchingSyncSettings.enabled),
        intervalMinutes: matchingSyncSettings.intervalMinutes,
        scheduled: Boolean(runtime.matchingSyncTimer),
        running: Boolean(runtime.matchingSyncRunning),
        lastRunAt: matchingSyncSettings.lastRunAt || null,
        lastRunOk: matchingSyncSettings.lastRunOk ?? null,
        lastError: matchingSyncSettings.lastError || null
      },
      channels: listChannels().map((channel) => ({
        id: channel.id,
        label: channel.label,
        status: channel.status
      }))
    };
  }

  return { buildOpsStatus };
}

function roundMb(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
