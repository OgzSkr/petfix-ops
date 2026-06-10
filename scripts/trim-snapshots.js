import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimBuyboxSnapshots, SNAPSHOTS_PER_BARCODE } from '../lib/snapshots.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', 'data', 'db.json');
const limitArg = Number(process.argv[2]);
const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : SNAPSHOTS_PER_BARCODE;

const db = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
const before = Array.isArray(db.buyboxSnapshots) ? db.buyboxSnapshots.length : 0;
db.buyboxSnapshots = trimBuyboxSnapshots(db.buyboxSnapshots || [], limit);
const after = db.buyboxSnapshots.length;
db.meta = db.meta || {};
db.meta.updatedAt = new Date().toISOString();

await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  limit,
  before,
  after,
  removed: before - after
}, null, 2));
