import { resolveOpsHubConfig } from '../config.js';

/** Son Getir staff kuyruk sync zamanı (process içi debounce). */
let lastGetirStaffSyncAt = 0;

const DEFAULT_MIN_INTERVAL_MS = 5000;

/**
 * Depo uygulaması picking kuyruğunu okurken Getir unapproved + aktif yenileme.
 * Webhook kaçırılırsa veya Getir otomatik onay hızlıysa yedek yol.
 */
export async function maybeSyncGetirForStaffQueue(pool, platformEnv, options = {}) {
  const minIntervalMs = Math.max(3000, Number(options.minIntervalMs) || DEFAULT_MIN_INTERVAL_MS);
  const now = Date.now();
  if (now - lastGetirStaffSyncAt < minIntervalMs) {
    return { skipped: true, reason: 'debounced' };
  }
  lastGetirStaffSyncAt = now;

  try {
    const { syncGetirReadOnly } = await import('./getir-sync.js');
    const hubConfig = resolveOpsHubConfig(platformEnv);
    const result = await syncGetirReadOnly(pool, {
      platformEnv,
      branchId: options.branchId || null,
      shadowMode: hubConfig.shadowModeDefault
    });
    return { skipped: false, result };
  } catch (error) {
    return { skipped: false, error: error.message };
  }
}

/** Testler için debounce sıfırlama. */
export function resetStaffQueueSyncDebounce() {
  lastGetirStaffSyncAt = 0;
}
