#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../lib/env.js';
import { configureDbStore } from '../lib/db/store.js';
import { readDb, writeDb } from '../lib/db/store.js';
import { mergeBenimposEmptyCosts } from '../lib/product-import/benimpos-trendyol-costs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PARSER = path.join(__dirname, 'parse-benimpos-xlsx.py');

const defaultBenimposPath = '/Users/petfix/Downloads/Ürünler Dışa Aktar -  BenimPOS (1).xlsx';

async function main() {
  const workbookPath = path.resolve(process.argv[2] || defaultBenimposPath);

  loadEnvFile(path.join(ROOT, '.env'));
  configureDbStore({
    sqliteDualWrite: process.env.SQLITE_DUAL_WRITE === 'true',
    dbReadBackend: (process.env.DB_READ_BACKEND || 'json').toLowerCase()
  });

  const parsed = parseBenimposWorkbook(workbookPath);
  if (!parsed.ok) {
    console.error(parsed.error || 'BenimPOS parse hatası');
    process.exit(1);
  }

  const db = await readDb();
  const summary = mergeBenimposEmptyCosts(db, parsed.items, { sourceName: parsed.source });
  await writeDb(db);

  console.log(JSON.stringify({
    ok: true,
    source: parsed.source,
    workbook: workbookPath,
    parsedRows: parsed.parsedRows,
    benimposItems: parsed.itemCount,
    ...summary,
    message: `${summary.filled} maliyet dolduruldu, ${summary.added} yeni kayıt eklendi, ${summary.skippedHasCost} mevcut maliyete dokunulmadı`
  }, null, 2));
}

function parseBenimposWorkbook(workbookPath) {
  const result = spawnSync('python3', [PARSER, workbookPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  if (result.status !== 0) {
    try {
      const payload = JSON.parse(result.stdout || '{}');
      return { ok: false, error: payload.error || result.stderr || 'Parse hatası' };
    } catch {
      return { ok: false, error: (result.stderr || result.stdout || 'Parse hatası').trim() };
    }
  }

  return JSON.parse(result.stdout);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
