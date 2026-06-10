import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { ingestMockOrder, buildShadowReport } from '../lib/ops-hub/ingest/ingest-service.js';

async function main() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL tanımlı değil.');
    process.exit(1);
  }

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);
    const keys = ['tgo', 'ys', 'getir'];
    for (const fixtureKey of keys) {
      const result = await ingestMockOrder(pool, { fixtureKey });
      console.log(`${fixtureKey}: orderId=${result.orderId} duplicate=${result.duplicate}`);
    }

    const report = await buildShadowReport(pool);
    console.log('Shadow report:', JSON.stringify(report, null, 2));
  } finally {
    await closeOpsPool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
