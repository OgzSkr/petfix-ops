#!/usr/bin/env node
/**
 * Mevcut ops_branch_channel_config satırlarındaki plaintext secret'ları şifreli sütuna taşır.
 *   ENCRYPTION_KEY=... node scripts/migrations/backfill-channel-secrets-crypto.js
 */
import { readEnvFile } from '../../lib/env.js';
import { paths } from '../../lib/config.js';
import { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } from '../../lib/ops-hub/bootstrap.js';
import { prepareConfigForStorage } from '../../lib/ops-hub/integrations/channel-secrets-crypto.js';
import { shouldUseEncryptedChannelSecrets } from '../../lib/crypto/secrets.js';

async function main() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  if (!shouldUseEncryptedChannelSecrets(platformEnv)) {
    console.error('ENCRYPTION_KEY veya CHANNEL_SECRETS_ENCRYPTED=true gerekli');
    process.exit(1);
  }

  if (!isOpsHubReady()) {
    await bootstrapOpsHub(platformEnv);
  }
  const pool = getOpsHubPool();
  if (!pool) {
    console.error('Ops Hub PostgreSQL hazır değil');
    process.exit(1);
  }

  const rows = await pool.query(
    `SELECT id, branch_id, channel, config_json, secrets_ciphertext
     FROM ops_branch_channel_config`
  );

  let updated = 0;
  for (const row of rows.rows) {
    if (row.secrets_ciphertext) continue;
    const config = row.config_json || {};
    const stored = prepareConfigForStorage(config, null, platformEnv);
    if (!stored.secretsCiphertext) continue;

    await pool.query(
      `UPDATE ops_branch_channel_config
       SET config_json = $1::jsonb, secrets_ciphertext = $2, updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(stored.config), stored.secretsCiphertext, row.id]
    );
    updated += 1;
    console.log(`encrypted: ${row.channel} (${row.id})`);
  }

  console.log(JSON.stringify({ ok: true, scanned: rows.rows.length, updated }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
