import { UberEatsAdapter } from '../../channels/uber-eats.js';
import { probeUberEatsApis } from '../../channels/uber-eats-health.js';
import {
  buildChannelSalesReadiness,
  resolveBenimposSaleConfirmLevel
} from '../../product-matching/sales-readiness.js';
import { readDb } from '../../db/store.js';
import { buildUberOpsChecklist } from './uber-ops-checklist.js';

export { buildUberOpsChecklist } from './uber-ops-checklist.js';

export function createUberOpsService({ productMatching, config = {} }) {
  async function buildOpsStatus({ probe = true } = {}) {
    const adapter = new UberEatsAdapter();
    const cfg = await adapter.loadConfig();
    const configured = adapter.isConfigured(cfg);

    let probeResult = null;
    if (probe && configured) {
      probeResult = await probeUberEatsApis(cfg);
    }

    const matchingStatus = await productMatching.getStatus();
    const db = await readDb();
    const confirmLevel = resolveBenimposSaleConfirmLevel(
      config.productMatchingMode,
      config.benimposSaleConfirmLevel
    );
    const readiness = buildChannelSalesReadiness(db, 'uber-eats', confirmLevel);

    const checklist = buildUberOpsChecklist({
      health: {
        configured,
        probe: probeResult,
        message: probeResult?.catalog?.message
      },
      matchingStatus,
      readiness
    });

    const completedSteps = checklist.filter((step) => step.done).length;

    return {
      ok: true,
      channelId: 'uber-eats',
      configured,
      probe: probeResult,
      matchingStatus,
      readiness,
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

  async function runOpsPipeline(payload = {}) {
    const days = Math.min(Math.max(Number(payload.days) || 90, 7), 180);
    const steps = Array.isArray(payload.steps) && payload.steps.length
      ? payload.steps
      : ['master', 'catalog', 'auto-match'];

    const results = {};
    const errors = [];

    for (const step of steps) {
      try {
        if (step === 'master') {
          results.master = await productMatching.syncMasterFromBenimpos();
        } else if (step === 'catalog') {
          results.catalog = await productMatching.syncUberCatalogProducts({
            allListTypes: true
          });
        } else if (step === 'orders') {
          results.orders = await productMatching.syncUberChannelProducts(days);
        } else if (step === 'auto-match') {
          results.autoMatch = await productMatching.runAutoMatch('uber-eats', {
            allowFuzzy: payload.allowFuzzy === true,
            confirm: payload.confirm !== false
          });
        }
      } catch (error) {
        errors.push({ step, error: error.message || String(error) });
        if (payload.stopOnError !== false) break;
      }
    }

    const status = await buildOpsStatus({ probe: false });

    return {
      ok: errors.length === 0,
      steps,
      results,
      errors,
      status
    };
  }

  return {
    buildOpsStatus,
    runOpsPipeline
  };
}
