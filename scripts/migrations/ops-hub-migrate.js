import { readEnvFile } from '../../lib/env.js';
import { paths } from '../../lib/config.js';
import { resolveOpsHubConfig } from '../../lib/ops-hub/config.js';
import {
  getOpsPool,
  closeOpsPool,
  applyOpsMigrations,
  getOpsMigrationStatus,
  checkOpsDbReady
} from '../../lib/ops-hub/db/migrate.js';
import { ensureDefaultBranch } from '../../lib/ops-hub/db/repository.js';

async function main() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);

  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL tanımlı değil (.env).');
    process.exit(1);
  }

  const pool = await getOpsPool(config.postgresUrl);

  try {
    const ready = await checkOpsDbReady(pool);
    if (!ready) {
      throw new Error('PostgreSQL bağlantı testi başarısız.');
    }

    const applied = await applyOpsMigrations(pool);
    const status = await getOpsMigrationStatus(pool);
    const branch = await ensureDefaultBranch(pool);

    console.log('Ops Hub migration tamamlandı.');
    console.log(`Uygulanan: ${applied.length ? applied.join(', ') : '(yeni migration yok)'}`);
    console.log('Durum:', status.map((row) => `${row.name}:${row.applied ? 'ok' : 'pending'}`).join(' | '));
    console.log(`Varsayılan şube: ${branch.slug} (${branch.id})`);
  } finally {
    await closeOpsPool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
