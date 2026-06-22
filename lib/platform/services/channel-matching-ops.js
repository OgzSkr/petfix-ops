import { readDb } from '../../db/store.js';
import {
  buildChannelSalesReadiness,
  resolveBenimposSaleConfirmLevel
} from '../../product-matching/sales-readiness.js';
import {
  catalogChannelOpsConfig,
  buildMatchingQueue
} from '../../product-matching/matching-queue.js';
import { buildCatalogMatchingOpsChecklist } from './channel-matching-ops-checklist.js';

export { buildCatalogMatchingOpsChecklist } from './channel-matching-ops-checklist.js';

export function createChannelMatchingOpsService({ productMatching, config = {} }) {
  function resolveOpsConfig(channelId) {
    return catalogChannelOpsConfig(channelId);
  }

  async function buildOpsStatus(channelId) {
    const opsConfig = resolveOpsConfig(channelId);
    if (!opsConfig) {
      const error = new Error('Bu kanal için katalog eşleştirme operasyonu tanımlı değil.');
      error.statusCode = 404;
      throw error;
    }

    const matchingStatus = await productMatching.getStatus();
    const db = await readDb();
    const confirmLevel = resolveBenimposSaleConfirmLevel(
      config.productMatchingMode,
      config.benimposSaleConfirmLevel
    );
    const readiness = buildChannelSalesReadiness(db, channelId, confirmLevel);
    const queue = buildMatchingQueue(db, config);
    const channelQueue = queue.channels.find((row) => row.channelId === channelId) || null;

    const checklist = buildCatalogMatchingOpsChecklist({
      channelId,
      channelLabel: opsConfig.label,
      catalogLabel: opsConfig.catalogLabel,
      matchingStatus,
      readiness
    });

    const completedSteps = checklist.filter((step) => step.done).length;

    return {
      ok: true,
      channelId,
      configured: true,
      matchingStatus,
      readiness,
      queue: channelQueue,
      checklist,
      progress: {
        completed: completedSteps,
        total: checklist.length,
        pct: checklist.length ? Math.round((completedSteps / checklist.length) * 100) : 0
      },
      saleConfirmLevel: confirmLevel,
      productMatchingMode: matchingStatus.mode
    };
  }

  async function runOpsPipeline(channelId, payload = {}) {
    const opsConfig = resolveOpsConfig(channelId);
    if (!opsConfig) {
      const error = new Error('Bu kanal için katalog eşleştirme operasyonu tanımlı değil.');
      error.statusCode = 404;
      throw error;
    }

    const steps = Array.isArray(payload.steps) && payload.steps.length
      ? payload.steps
      : opsConfig.steps;

    const results = {};
    const errors = [];

    for (const step of steps) {
      try {
        if (step === 'master') {
          results.master = await productMatching.syncMasterFromBenimpos();
        } else if (step === 'catalog') {
          if (channelId === 'yemeksepeti') {
            results.catalog = await productMatching.syncYemeksepetiCatalogProducts(payload.catalog || {});
          } else if (channelId === 'getir') {
            results.catalog = await productMatching.syncGetirCatalogProducts(payload.catalog || {});
          }
        } else if (step === 'auto-match') {
          results.autoMatch = await productMatching.runAutoMatch(channelId, {
            allowFuzzy: payload.allowFuzzy === true,
            confirm: payload.confirm !== false
          });
        } else if (step === 'barcode-link') {
          results.barcodeLink = await productMatching.linkChannelProductsByBarcode(channelId);
        }
      } catch (error) {
        errors.push({ step, error: error.message || String(error) });
        if (payload.stopOnError !== false) break;
      }
    }

    const status = await buildOpsStatus(channelId);

    return {
      ok: errors.length === 0,
      channelId,
      steps,
      results,
      errors,
      status
    };
  }

  async function getMatchingQueue() {
    const db = await readDb();
    return buildMatchingQueue(db, config);
  }

  return {
    buildOpsStatus,
    runOpsPipeline,
    getMatchingQueue
  };
}
