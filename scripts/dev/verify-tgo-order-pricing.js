import { readEnvFile } from '../../lib/env.js';
import { paths } from '../../lib/config.js';
import { getOpsPool, closeOpsPool } from '../../lib/ops-hub/db/migrate.js';
import { getOpsOrderById } from '../../lib/ops-hub/db/repository.js';
import { packageFromUberOpsRow } from '../../lib/channels/ops-orders-bridge.js';

const displayId = process.argv[2] || '11339327359';
const env = await readEnvFile(paths.platformEnv);
const pool = await getOpsPool(env.OPS_POSTGRES_URL);
const found = await pool.query(
  'SELECT id FROM ops_orders WHERE display_id = $1 LIMIT 1',
  [displayId]
);
if (!found.rows[0]) {
  console.log(JSON.stringify({ error: 'order not found', displayId }));
  await closeOpsPool();
  process.exit(1);
}

const detail = await getOpsOrderById(pool, found.rows[0].id);
await closeOpsPool();

const row = {
  ...detail.order,
  lines: detail.lines.map((line) => ({
    barcode: line.barcode,
    title: line.title,
    quantity: line.quantity,
    unit_price: line.unit_price,
    channel_product_id: line.channel_product_id
  }))
};

const pkg = packageFromUberOpsRow(row);
console.log(JSON.stringify({
  displayId: row.display_id,
  packageGrossAmount: pkg.packageGrossAmount,
  dbUnitPrices: detail.lines.map((l) => ({ barcode: l.barcode, qty: l.quantity, unit_price: l.unit_price })),
  lines: pkg.lines.map((l) => ({
    barcode: l.barcode,
    qty: l.quantity,
    unit: l.lineUnitPrice,
    total: l.lineSalesAmount
  }))
}, null, 2));
