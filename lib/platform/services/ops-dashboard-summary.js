import { getDbReadMeta } from '../../db/store.js';
import { buildProfitFootnote } from '../../ops-hub/reports/ops-reports-profit.js';

export function createOpsDashboardSummaryService({
  ops,
  channelMatchingOps,
  channelsSummary,
  getOpsHubContext
}) {
  async function buildDashboardSummary(searchParams = new URLSearchParams()) {
    const days = Number(searchParams.get('days') || 14) || 14;
    const params = new URLSearchParams({ days: String(days) });

    const [opsStatus, matchingQueue, channelSummary, dbMeta] = await Promise.all([
      ops.buildOpsStatus(),
      channelMatchingOps?.getMatchingQueue?.() || Promise.resolve(null),
      channelsSummary.buildChannelsSummary(params),
      Promise.resolve(getDbReadMeta())
    ]);

    let profitConfidence = null;
    const hubCtx = typeof getOpsHubContext === 'function' ? await getOpsHubContext() : null;
    if (hubCtx?.pool && hubCtx?.branchId) {
      try {
        const { buildOpsReportsProfit } = await import('../../ops-hub/reports/ops-reports-profit.js');
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const profitReport = await buildOpsReportsProfit(hubCtx.pool, {
          branchId: hubCtx.branchId,
          since,
          liveOnly: true,
          channel: 'all'
        });
        profitConfidence = {
          total: Number(profitReport.kpiCount || 0) + Number(profitReport.excludedFromKpi || 0),
          kpiIncluded: Number(profitReport.kpiCount || 0),
          kpiExcluded: Number(profitReport.excludedFromKpi || 0),
          reliablePct: profitReport.kpiCount + profitReport.excludedFromKpi > 0
            ? Math.round((profitReport.kpiCount / (profitReport.kpiCount + profitReport.excludedFromKpi)) * 1000) / 10
            : null,
          footnote: buildProfitFootnote({
            counts: {
              missing_cost: profitReport.excludedFromKpi || 0
            },
            kpiIncluded: profitReport.kpiCount || 0,
            total: (profitReport.kpiCount || 0) + (profitReport.excludedFromKpi || 0)
          })
        };
      } catch {
        profitConfidence = null;
      }
    }

    const parityWarning = dbMeta.fallback || dbMeta.error === 'parity_mismatch'
      ? {
          active: true,
          source: dbMeta.source,
          mismatches: dbMeta.parity?.mismatches || [],
          collectionMismatches: dbMeta.parity?.collectionMismatches || [],
          message: 'SQLite ve JSON verisi uyuşmuyor — JSON fallback kullanılıyor'
        }
      : { active: false };

    return {
      ok: true,
      updatedAt: new Date().toISOString(),
      days,
      matching: matchingQueue
        ? {
          queueTotal: matchingQueue.totals?.queue || 0,
          unmapped: matchingQueue.totals?.unmapped || 0,
          needsReview: matchingQueue.totals?.needsReview || 0,
          missingMaster: matchingQueue.totals?.missingMaster || 0,
          autoPendingConfirm: matchingQueue.totals?.autoPendingConfirm || 0,
          href: '/hzlmrktops/urunler'
        }
        : null,
      channels: {
        connected: (channelSummary.channels || []).filter((row) => row.configured && row.available).length,
        alerts: (channelSummary.channels || []).filter((row) => !row.configured || !row.available).length,
        lossOrders: Number(channelSummary.totals?.loss || 0)
      },
      profitConfidence,
      parity: parityWarning,
      ops: {
        mode: opsStatus.nodeEnv,
        dbReadBackend: opsStatus.db?.readBackend,
        matchingSyncEnabled: opsStatus.matchingSync?.enabled,
        opsPollEnabled: opsStatus.opsPoll?.settings?.enabled
      }
    };
  }

  return { buildDashboardSummary };
}
