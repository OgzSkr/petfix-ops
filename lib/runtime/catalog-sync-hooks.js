const DEBOUNCE_MS = 60_000;
let catalogSyncHandler = null;
let lastTriggerAt = 0;
let running = false;

export function registerYemeksepetiCatalogSyncHandler(handler) {
  catalogSyncHandler = typeof handler === 'function' ? handler : null;
}

export async function triggerYemeksepetiCatalogSync(reason = 'webhook') {
  if (!catalogSyncHandler) {
    return { ok: false, skipped: true, reason: 'no_handler' };
  }

  const now = Date.now();
  if (running) {
    return { ok: true, skipped: true, reason: 'already_running' };
  }
  if (now - lastTriggerAt < DEBOUNCE_MS) {
    return { ok: true, skipped: true, reason: 'debounced' };
  }

  lastTriggerAt = now;
  running = true;

  try {
    const result = await catalogSyncHandler({ reason });
    return { ok: true, skipped: false, reason, result };
  } catch (error) {
    return { ok: false, skipped: false, reason, error: error.message || String(error) };
  } finally {
    running = false;
  }
}

export function getCatalogSyncHookState() {
  return {
    registered: Boolean(catalogSyncHandler),
    running,
    lastTriggerAt: lastTriggerAt ? new Date(lastTriggerAt).toISOString() : null,
    debounceMs: DEBOUNCE_MS
  };
}
