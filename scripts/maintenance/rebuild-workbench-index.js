#!/usr/bin/env node
/** Gelen Kutusu kuyruk indeksini yeniden oluşturur (zamanlanmış sync / bakım). */
import { configureDbStore, ensureDb, migrateDb } from '../lib/db/store.js';
import { resolveRuntimeConfig } from '../lib/config.js';
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { createProductMatchingService } from '../lib/platform/services/product-matching.js';

const platformEnv = await readEnvFile(paths.platformEnv);
const config = resolveRuntimeConfig(platformEnv);
await configureDbStore({
  sqliteDualWrite: config.sqliteDualWrite,
  dbReadBackend: config.dbReadBackend
});
await ensureDb();
await migrateDb();

const productMatching = createProductMatchingService();
const result = await productMatching.rebuildWorkbenchIndex();
console.log(JSON.stringify(result, null, 2));
