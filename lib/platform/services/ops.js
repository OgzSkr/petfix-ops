import { getDbReadMeta, readDb } from '../../db/store.js';
import { getSqliteFileStats } from '../../db/sqlite-store.js';
import { listChannels } from '../../channels/registry.js';
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { ensureMatchingSyncState } from '../../product-matching/matching-sync-schedule.js';

export function createOpsService({ runtime, config, opsPollSync }) {
  async function buildOpsStatus() {
    const memory = process.memoryUsage();
    const dbMeta = getDbReadMeta();
    const sqliteStats = await getSqliteFileStats();

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
      sync: {
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
      opsPoll: opsPollSync ? await opsPollSync.getSettings() : {
        settings: { enabled: false },
        scheduled: Boolean(runtime.opsPollTimer),
        running: Boolean(runtime.opsPollRunning),
        lastRunAt: runtime.opsPollLastRunAt || null,
        lastRunOk: runtime.opsPollLastRunOk ?? null,
        lastError: runtime.opsPollLastError || null
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
