#!/usr/bin/env node
/**
 * G6 — BenimPOS satış oluştur + iptal canlı testi
 *
 * Varsayılan dry-run. Gerçek işlem için --execute (stok düşer + iptal dener).
 *
 *   node scripts/ops-hub-g6-cancel-test.js --barcode=8690001112223 --qty=1
 *   node scripts/ops-hub-g6-cancel-test.js --execute --barcode=8690001112223 --qty=1 --note=G6-TEST
 */
import { createBenimposClient, readBenimposConfig } from '../lib/benimpos/client.js';
import { createSale } from '../lib/benimpos/sales-create.js';
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';

function parseArgs(argv) {
  const args = {
    execute: false,
    barcode: '',
    qty: 1,
    price: 1,
    note: `G6-CANCEL-${new Date().toISOString().slice(0, 19)}`,
    paymentType: 'OPENACCOUNT'
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--execute') args.execute = true;
    else if (arg.startsWith('--barcode=')) args.barcode = arg.slice('--barcode='.length);
    else if (arg.startsWith('--qty=')) args.qty = Number(arg.slice('--qty='.length)) || 1;
    else if (arg.startsWith('--price=')) args.price = Number(arg.slice('--price='.length)) || 1;
    else if (arg.startsWith('--note=')) args.note = arg.slice('--note='.length);
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function printHelp() {
  console.log(`G6 BenimPOS satış → iptal testi

  --barcode=<barkod>   Zorunlu (execute modunda)
  --qty=<n>            Adet (varsayılan 1)
  --price=<n>          Birim fiyat (varsayılan 1 TL)
  --note=<metin>       Satış notu
  --execute            Canlı satış + iptal (dikkat!)
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  await readEnvFile(paths.platformEnv);
  const cfg = await readBenimposConfig();
  const client = createBenimposClient(cfg);

  const saleOrder = {
    paymentType: args.paymentType,
    note: args.note,
    lines: [
      {
        barcode: args.barcode,
        name: 'G6 Test Urun',
        price: args.price,
        quantity: args.qty,
        taxRate: 20
      }
    ]
  };

  if (!args.execute) {
    const preview = await createSale(client, saleOrder, { dryRun: true });
    console.log(JSON.stringify({
      ok: true,
      mode: 'dry-run',
      message: 'Satış payload hazır — canlı test için --execute ekleyin',
      preview
    }, null, 2));
    return;
  }

  if (!args.barcode) {
    console.error('--execute için --barcode zorunlu');
    process.exit(1);
  }

  console.error('⚠️  G6 canlı test: satış oluşturuluyor...');
  const sale = await createSale(client, saleOrder, { dryRun: false });
  const salesCode = sale.salesCode;
  if (!salesCode) {
    throw new Error('salesCode dönmedi — iptal testi yapılamaz');
  }

  console.log(JSON.stringify({ step: 'sale_created', salesCode, sale }, null, 2));

  console.error('⚠️  İptal gönderiliyor...');
  const cancel = await client.request('sales', {
    processType: 'cancel',
    data: { salesCode }
  });

  console.log(JSON.stringify({
    ok: true,
    mode: 'live',
    salesCode,
    cancel,
    message: 'G6 tamamlandı — BenimPOS panelinde stok geri dönüşünü doğrulayın'
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
