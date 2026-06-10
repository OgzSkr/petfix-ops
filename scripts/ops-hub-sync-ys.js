#!/usr/bin/env node
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { ensureDefaultBranch } from '../lib/ops-hub/db/repository.js';
import { syncYemeksepetiReadOnly } from '../lib/ops-hub/sync/ys-sync.js';

async function main() {
  const days = Number(process.argv[2] || 7);
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);

  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL tanımlı değil.');
    process.exit(1);
  }

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);
    const branch = await ensureDefaultBranch(pool);
    const result = await syncYemeksepetiReadOnly(pool, {
      platformEnv,
      branchId: branch.id,
      days,
      shadowMode: true
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeOpsPool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
