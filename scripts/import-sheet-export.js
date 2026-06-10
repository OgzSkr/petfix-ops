/** @deprecated Legacy JSON import — yeni kurulumlarda scripts/import-xlsx.py kullanın. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', 'data', 'db.json');

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('Kullanım: node scripts/import-sheet-export.js <json-dosya>');
  process.exit(1);
}

const input = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
const db = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));

db.products = input.products || db.products || [];
db.costs = input.costs || db.costs || [];
db.commissionRules = input.commissionRules || db.commissionRules || [];
db.meta.updatedAt = new Date().toISOString();

await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
console.log('Import tamamlandı.');
