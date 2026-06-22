#!/usr/bin/env node
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { ensureDefaultBranch } from '../lib/ops-hub/db/repository.js';
import { saveIntegration } from '../lib/ops-hub/integrations/integration-service.js';
import { OPS_CHANNELS } from '../lib/ops-hub/constants.js';
import { envFallbackForChannel } from '../lib/ops-hub/integrations/config-bridge.js';

async function seedChannel(pool, branchId, channel, platformEnv) {
  const fallback = envFallbackForChannel(channel, platformEnv);
  const hasAny = Object.entries(fallback).some(
    ([key, value]) => key !== 'autoAcceptOrders' && String(value || '').trim()
  );
  if (!hasAny) {
    return { channel, skipped: true, reason: 'env_empty' };
  }

  try {
    const result = await saveIntegration(pool, channel, { config: fallback }, {
      branchId,
      platformEnv
    });
    return { channel, skipped: false, ok: true, result };
  } catch (error) {
    return { channel, skipped: false, ok: false, error: error.message };
  }
}

async function main() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL yok');
    process.exit(1);
  }

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);
    const branch = await ensureDefaultBranch(pool);
    const results = [];

    for (const channel of OPS_CHANNELS) {
      results.push(await seedChannel(pool, branch.id, channel, platformEnv));
    }

    console.log(JSON.stringify({ ok: true, branch: branch.slug, results }, null, 2));
  } finally {
    await closeOpsPool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
