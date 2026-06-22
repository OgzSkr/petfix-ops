import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { getChannelsHealth, listActiveChannels } from '../../channels/registry.js';
import { buildWebhookPanel } from '../../ops-hub/integrations/integration-service.js';
import { runDailySync } from '../../ops-hub/workers/daily-sync.js';
import { runOpsPoll } from '../../ops-hub/workers/poll-worker.js';

const OPS_REGISTRY_MAP = {
  trendyol_go: 'uber-eats',
  yemeksepeti: 'yemeksepeti',
  getir: 'getir'
};

export function createChannelControlService({ matchingSync, opsPollSync }) {
  async function buildControlBoard() {
    const platformEnv = await readEnvFile(paths.platformEnv);
    const channels = await getChannelsHealth();
    const matching = matchingSync ? await matchingSync.getSettings() : null;
    const opsPoll = opsPollSync ? await opsPollSync.getSettings() : null;
    const webhooks = buildWebhookPanel(platformEnv);

    const opsChannels = listActiveChannels()
      .filter((c) => ['getir', 'yemeksepeti', 'uber-eats'].includes(c.id))
      .map((c) => ({
        registryId: c.id,
        label: c.label,
        capabilities: c.capabilities,
        capabilityGaps: c.capabilityGaps,
        health: c.health
      }));

    return {
      ok: true,
      channels,
      opsChannels,
      webhooks,
      workers: {
        matchingSync: matching,
        opsPoll
      },
      actions: {
        poll: { label: 'Sipariş poll (TGO+YS+Getir)', endpoint: '/api/channels/control/actions' },
        matchingSync: { label: 'Katalog eşleştirme sync', endpoint: '/api/channels/control/actions' },
        dailySync: { label: 'Gün sonu mutabakat', endpoint: '/api/channels/control/actions' }
      }
    };
  }

  async function runAction(action, options = {}) {
    switch (action) {
      case 'ops-poll':
        if (opsPollSync) {
          return opsPollSync.runPoll(true);
        }
        return runOpsPoll({
          platformEnv: await readEnvFile(paths.platformEnv),
          ysDays: options.ysDays ?? 14,
          tgoLimit: options.tgoLimit ?? 50,
          getirDays: options.getirDays ?? 0
        });
      case 'matching-sync':
        if (!matchingSync) {
          throw Object.assign(new Error('matchingSync servisi yok'), { statusCode: 503 });
        }
        return matchingSync.runScheduledSync(true);
      case 'daily-sync':
        return runDailySync({
          onStep: () => {}
        });
      default:
        throw Object.assign(new Error(`Bilinmeyen action: ${action}`), { statusCode: 400 });
    }
  }

  return {
    buildControlBoard,
    runAction,
    opsRegistryMap: OPS_REGISTRY_MAP
  };
}
