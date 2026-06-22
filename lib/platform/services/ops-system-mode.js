import { readPlatformConfigEnv } from '../../env.js';
import { paths } from '../../config.js';
import { getOpsHubPublicConfig } from '../../ops-hub/channel/channel-status-service.js';
import { OPS_FEATURE_FLAGS } from '../../ops-hub/constants.js';
import { readDb } from '../../db/store.js';
import { ensureMatchingSyncState } from '../../product-matching/matching-sync-schedule.js';

const FLAG_LABELS = {
  FF_CHANNEL_STATUS_WRITE: 'Kanal durumu yazma',
  FF_BENIMPOS_SALE_WRITE: 'BenimPOS satış yazma',
  FF_STOCK_PUSH: 'Kanallara stok/fiyat yazımı',
  FF_STAFF_AUTH: 'Mobil personel girişi zorunlu'
};

export function createOpsSystemModeService({ runtime, opsPollSync, matchingSync }) {
  async function buildSystemMode() {
    const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
    const opsConfig = await getOpsHubPublicConfig(platformEnv);
    const shadowMode = opsConfig.shadowModeDefault !== false;
    const poll = opsPollSync ? await opsPollSync.getSettings() : null;

    const db = await readDb();
    const matchingSyncSettings = ensureMatchingSyncState(db, platformEnv);

    const flags = OPS_FEATURE_FLAGS.map((key) => ({
      key,
      label: FLAG_LABELS[key] || key,
      enabled: opsConfig.flags?.[key] === true,
      effective: !shadowMode && opsConfig.flags?.[key] === true
    }));

    const liveFlags = flags.filter((f) => f.effective);

    return {
      ok: true,
      mode: shadowMode ? 'shadow' : 'live',
      modeLabel: shadowMode ? 'Eğitim modu' : 'Canlı mod',
      modeHint: shadowMode
        ? 'Gerçek kanal ve kasa yazması yapılmaz'
        : 'Onayladığınız işlemler gerçek sisteme yazılır',
      shadowModeDefault: shadowMode,
      flags,
      liveFlagsCount: liveFlags.length,
      poll: poll
        ? {
            enabled: Boolean(poll.settings?.enabled),
            intervalMinutes: poll.settings?.intervalMinutes ?? null,
            scheduled: Boolean(poll.scheduled),
            running: Boolean(poll.running),
            lastRunAt: poll.lastRunAt || null,
            lastRunOk: poll.lastRunOk ?? null,
            lastError: poll.lastError || null
          }
        : null,
      matchingSync: {
        enabled: Boolean(matchingSyncSettings.enabled),
        intervalMinutes: matchingSyncSettings.intervalMinutes,
        scheduled: Boolean(runtime.matchingSyncTimer),
        running: Boolean(runtime.matchingSyncRunning),
        lastRunAt: matchingSyncSettings.lastRunAt || null,
        lastRunOk: matchingSyncSettings.lastRunOk ?? null,
        lastError: matchingSyncSettings.lastError || null
      },
      worker: {
        running: Boolean(runtime.workerProcess),
        startedAt: runtime.workerStartedAt || null
      },
      activityFeedPath: '/api/ops/activity-feed',
      systemPagePath: '/hzlmrktops/sistem'
    };
  }

  return { buildSystemMode };
}
