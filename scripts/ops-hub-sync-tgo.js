import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { syncTgoReadOnly } from '../lib/ops-hub/sync/tgo-sync.js';

async function main() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL tanımlı değil.');
    process.exit(1);
  }

  const limit = Number(process.argv[2] || 10);
  const activeOnly = process.argv.includes('--active');

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);
    const result = await syncTgoReadOnly(pool, {
      platformEnv,
      limit,
      maxPages: 2,
      activeOnly,
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
