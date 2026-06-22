/**
 * Ops Hub poll worker — kanal sipariş poll/sync çekirdeği.
 *
 * Bu modül CLI'dan bağımsızdır: process.exit/argv kullanmaz, rapor nesnesi döndürür.
 * Hem `scripts/ops-hub-poll.js` (CLI) hem de in-process zamanlayıcı bunu çağırabilir.
 */
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { resolveOpsHubConfig } from '../config.js';
import { getOpsPool, applyOpsMigrations } from '../db/migrate.js';
import { bootstrapTenantAndGrants } from '../branches/branch-service.js';
import { listBranchesForTenant } from '../branches/branch-repository.js';
import { syncTgoReadOnly } from '../sync/tgo-sync.js';
import { syncYemeksepetiReadOnly } from '../sync/ys-sync.js';
import { syncGetirReadOnly, syncGetirDeliveredHistory } from '../sync/getir-sync.js';

export const DEFAULT_POLL_CHANNELS = ['trendyol_go', 'yemeksepeti', 'getir'];

/**
 * @param {object} options
 * @param {string[]} [options.channels]
 * @param {number} [options.tgoLimit]
 * @param {number} [options.ysDays]
 * @param {number} [options.getirDays]
 * @param {boolean} [options.activeOnly]
 * @param {object} [options.platformEnv] - önceden okunmuş env
 * @returns {Promise<object>} rapor { ok, channels, errors?, startedAt, finishedAt }
 */
export async function runOpsPoll(options = {}) {
  const channels = options.channels || DEFAULT_POLL_CHANNELS;
  const tgoLimit = options.tgoLimit ?? 50;
  const ysDays = options.ysDays ?? 14;
  const getirDays = options.getirDays ?? 0;
  const activeOnly = options.activeOnly ?? true;

  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const hubConfig = resolveOpsHubConfig(platformEnv);
  const defaultShadowMode = options.shadowMode ?? hubConfig.shadowModeDefault;
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    const err = new Error('OPS_POSTGRES_URL tanımlı değil.');
    err.code = 'OPS_POSTGRES_DISABLED';
    throw err;
  }

  const pool = await getOpsPool(config.postgresUrl);
  const report = { startedAt: new Date().toISOString(), channels: {} };

  try {
    await applyOpsMigrations(pool);
    const { tenant } = await bootstrapTenantAndGrants(pool, platformEnv);
    const branches = await listBranchesForTenant(pool, tenant.id);
    const targets = branches.length ? branches : [{ id: null, slug: 'main' }];

    report.branches = {};

    for (const branch of targets) {
      const branchKey = branch.slug || branch.id || 'main';
      report.branches[branchKey] = {};

      if (channels.includes('trendyol_go')) {
        try {
          report.branches[branchKey].trendyol_go = await syncTgoReadOnly(pool, {
            platformEnv,
            branchId: branch.id,
            limit: tgoLimit,
            maxPages: 3,
            activeOnly,
            shadowMode: defaultShadowMode
          });
        } catch (error) {
          report.branches[branchKey].trendyol_go = { error: error.message };
        }
      }

      if (channels.includes('yemeksepeti')) {
        try {
          report.branches[branchKey].yemeksepeti = await syncYemeksepetiReadOnly(pool, {
            platformEnv,
            branchId: branch.id,
            days: ysDays,
            shadowMode: defaultShadowMode
          });
        } catch (error) {
          report.branches[branchKey].yemeksepeti = { error: error.message };
        }
      }

      if (channels.includes('getir')) {
        try {
          report.branches[branchKey].getir = await syncGetirReadOnly(pool, {
            platformEnv,
            branchId: branch.id,
            shadowMode: defaultShadowMode
          });
          if (getirDays > 0) {
            report.branches[branchKey].getir_delivered = await syncGetirDeliveredHistory(pool, {
              platformEnv,
              branchId: branch.id,
              days: getirDays,
              shadowMode: defaultShadowMode
            });
          }
        } catch (error) {
          report.branches[branchKey].getir = { error: error.message };
        }
      }
    }

    // Geriye dönük özet — ilk şube veya main
    const primary = report.branches.main || Object.values(report.branches)[0] || {};
    report.channels = primary;
  } catch (error) {
    report.fatalError = error.message;
    throw error;
  }

  report.finishedAt = new Date().toISOString();

  const channelErrors = [];
  for (const [branchKey, branchReport] of Object.entries(report.branches || {})) {
    for (const [name, result] of Object.entries(branchReport || {})) {
      const label = `${branchKey}:${name}`;
      if (result?.error) {
        channelErrors.push(`${label}: ${result.error}`);
      } else if (Number(result?.failed) > 0) {
        channelErrors.push(`${label}: ${result.failed} sipariş yazılamadı`);
      }
    }
  }
  report.ok = channelErrors.length === 0;
  if (channelErrors.length) {
    report.errors = channelErrors;
  }

  return report;
}
