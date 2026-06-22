/**
 * Production günlük bakım worker'ı — BenimPOS master/maliyet + YS katalog + otomatik eşleştirme.
 *
 * CLI'dan bağımsız: rapor döndürür, isteğe bağlı `onStep(result)` geri çağrısı ile adım
 * loglanabilir. İlk hatada istisna fırlatır (fail-fast, eski script davranışı korunur).
 */
import { createBenimposService } from '../../platform/services/benimpos.js';
import { createProductMatchingService } from '../../platform/services/product-matching.js';

async function runStep(title, fn, onStep) {
  try {
    const result = await fn();
    const entry = { step: title, ok: true, ...result };
    if (typeof onStep === 'function') onStep(entry);
    return result;
  } catch (error) {
    const entry = { step: title, ok: false, error: error.message };
    if (typeof onStep === 'function') onStep(entry);
    throw error;
  }
}

/**
 * @param {object} [options]
 * @param {(entry: object) => void} [options.onStep] - her adım sonucu için geri çağrı
 * @returns {Promise<object>} { ok, steps, finishedAt }
 */
export async function runDailySync(options = {}) {
  const { onStep } = options;
  const steps = {};

  steps.syncMaster = await runStep('sync-master', async () => {
    const pm = createProductMatchingService();
    return pm.syncMasterFromBenimpos();
  }, onStep);

  steps.syncCosts = await runStep('sync-costs', async () => {
    const benimpos = createBenimposService();
    return benimpos.syncCosts();
  }, onStep);

  steps.syncYsCatalog = await runStep('sync-yemeksepeti-catalog', async () => {
    const pm = createProductMatchingService();
    return pm.syncYemeksepetiCatalogProducts();
  }, onStep);

  steps.autoMatchYs = await runStep('auto-match-yemeksepeti', async () => {
    const pm = createProductMatchingService();
    const match = await pm.runAutoMatch('yemeksepeti');
    const confirm = await pm.confirmAutoMatchedBulk({ channelId: 'yemeksepeti' });
    return { match, confirm };
  }, onStep);

  return { ok: true, steps, finishedAt: new Date().toISOString() };
}
