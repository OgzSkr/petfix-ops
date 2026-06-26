#!/usr/bin/env node
/** Product matching SQLite scaffold — tabloları oluşturur (veri taşımaz). */
import { isSqliteAvailable, readDbFromSqlite } from '../../lib/db/sqlite-store.js';

async function main() {
  if (!(await isSqliteAvailable())) {
    console.error('SQLite kullanılamıyor.');
    process.exit(1);
  }

  await readDbFromSqlite().catch(async (error) => {
    if (error.message === 'sqlite_file_missing') {
      const { syncJsonToSqlite } = await import('../../lib/db/sqlite-store.js');
      const { readJsonDb } = await import('../../lib/db/store.js');
      await syncJsonToSqlite(await readJsonDb());
      return;
    }
    throw error;
  });

  console.log(JSON.stringify({ ok: true, message: 'pm_* tabloları hazır' }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
