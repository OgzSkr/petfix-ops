#!/usr/bin/env node
'use strict';

/**
 * BenimPOS TRENDGO (27749256) satış denemesi — Uber Eats / Trendyol Go
 *
 * Önce her zaman --dry-run ile payload'ı kontrol edin.
 * --execute gerçek satış oluşturur ve BenimPOS stok düşer.
 *
 * Manuel deneme:
 *   node scripts/benimpos-test-trendgo-sale.js --dry-run --barcode=3182550707312 --qty=1
 *
 * Uber siparişinden deneme:
 *   node scripts/benimpos-test-trendgo-sale.js --dry-run --uber-order=SIPARIS_NO
 *
 * Gerçek gönderim (dikkat):
 *   node scripts/benimpos-test-trendgo-sale.js --execute --barcode=3182550707312 --qty=1 --note="TEST-TRENDGO"
 */

import { createBenimposClient, readBenimposConfig } from '../lib/benimpos/client.js';
import {
  BENIMPOS_PAYMENT,
  buildChannelSaleFromOrder,
  createSale
} from '../lib/benimpos/sales-create.js';
import { readDb, configureDbStore } from '../lib/db/store.js';
import { paths, resolveRuntimeConfig } from '../lib/config.js';
import { readEnvFile } from '../lib/env.js';
import { normalizeMatchingMode } from '../lib/product-matching/resolve.js';
import { UberEatsAdapter } from '../lib/channels/uber-eats.js';

function parseArgs(argv) {
  const args = {
    dryRun: true,
    execute: false,
    barcode: '',
    name: '',
    price: 0,
    qty: 1,
    taxRate: 20,
    note: '',
    uberOrder: '',
    days: 14,
    mode: ''
  };

  for (const arg of argv) {
    if (arg === '--execute') {
      args.execute = true;
      args.dryRun = false;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
      args.execute = false;
    } else if (arg.startsWith('--barcode=')) {
      args.barcode = arg.slice('--barcode='.length).trim();
    } else if (arg.startsWith('--name=')) {
      args.name = arg.slice('--name='.length).trim();
    } else if (arg.startsWith('--price=')) {
      args.price = Number(arg.slice('--price='.length));
    } else if (arg.startsWith('--qty=')) {
      args.qty = Number(arg.slice('--qty='.length)) || 1;
    } else if (arg.startsWith('--tax-rate=')) {
      args.taxRate = Number(arg.slice('--tax-rate='.length)) || 20;
    } else if (arg.startsWith('--note=')) {
      args.note = arg.slice('--note='.length).trim();
    } else if (arg.startsWith('--uber-order=')) {
      args.uberOrder = arg.slice('--uber-order='.length).trim();
    } else if (arg.startsWith('--days=')) {
      args.days = Number(arg.slice('--days='.length)) || 14;
    } else if (arg.startsWith('--mode=')) {
      args.mode = arg.slice('--mode='.length).trim();
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
BenimPOS TRENDGO satış denemesi (paymentType: ${BENIMPOS_PAYMENT.TRENDGO})

Seçenekler:
  --dry-run              Payload göster, BenimPOS'a gönderme (varsayılan)
  --execute              Gerçek satış oluştur (stok düşer!)
  --barcode=...          Ürün barkodu (manuel mod)
  --name=...             Ürün adı (opsiyonel, BenimPOS'tan da çekilir)
  --price=...            Birim satış fiyatı (opsiyonel, BenimPOS salePrice1)
  --qty=1                Adet
  --tax-rate=20          KDV oranı
  --note=...             Satış notu
  --uber-order=...       Uber/TRENDGO sipariş numarasından payload üret
  --days=14              Uber sipariş arama gün aralığı
  --mode=legacy|hybrid|strict   Eşleştirme modu (varsayılan: .env PRODUCT_MATCHING_MODE)

Örnekler:
  node scripts/benimpos-test-trendgo-sale.js --dry-run --barcode=3182550707312
  node scripts/benimpos-test-trendgo-sale.js --dry-run --uber-order=123456789
  node scripts/benimpos-test-trendgo-sale.js --execute --barcode=3182550707312 --note=TEST-TRENDGO
`);
}

async function lookupProduct(client, barcode) {
  const result = await client.listProductsPage(1, { orderByColumn: 'barcode', orderByType: 'ASC' });
  const match = (result.data || []).find((p) => String(p.barcode) === String(barcode));
  if (match) return match;

  for (let page = 1; page <= Math.min(Number(result.totalPage) || 1, 24); page += 1) {
    const pageResult = page === 1 ? result : await client.listProductsPage(page);
    const found = (pageResult.data || []).find((p) => String(p.barcode) === String(barcode));
    if (found) return found;
  }

  return null;
}

async function fetchUberOrderPackage(orderNumber, days) {
  const adapter = new UberEatsAdapter();
  const cfg = await adapter.loadConfig();
  if (!adapter.isConfigured(cfg)) {
    throw new Error('Uber Eats API bilgileri eksik — .env dosyasında UBER_EATS_* alanlarını doldurun.');
  }

  const packages = await adapter.fetchOrders({ days });
  const match = packages.find((pkg) => String(pkg.orderNumber) === String(orderNumber));
  if (!match) {
    throw new Error(`Son ${days} günde Uber siparişi bulunamadı: ${orderNumber}`);
  }
  return match;
}

async function buildManualOrder(client, args) {
  if (!args.barcode) {
    throw new Error('Manuel mod için --barcode zorunlu (veya --uber-order kullanın).');
  }

  const product = await lookupProduct(client, args.barcode);
  if (!product) {
    throw new Error(`BenimPOS'ta barkod bulunamadı: ${args.barcode}`);
  }

  const price = args.price > 0 ? args.price : Number(product.salePrice1) || 0;
  const name = args.name || product.name || 'Ürün';

  return {
    orderNumber: args.note || 'MANUEL-TEST',
    lines: [{
      barcode: args.barcode,
      productName: name,
      lineUnitPrice: price,
      quantity: args.qty,
      taxRate: args.taxRate || Number(product.taxRate) || 20
    }]
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const cfg = await readBenimposConfig();
  const client = createBenimposClient(cfg);

  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveRuntimeConfig(platformEnv);
  await configureDbStore({
    sqliteDualWrite: config.sqliteDualWrite,
    dbReadBackend: config.dbReadBackend
  });
  const mode = normalizeMatchingMode(args.mode || config.productMatchingMode);
  const db = await readDb();

  let orderPackage;
  if (args.uberOrder) {
    console.log(`Uber siparişi aranıyor: ${args.uberOrder} (son ${args.days} gün)...`);
    orderPackage = await fetchUberOrderPackage(args.uberOrder, args.days);
    console.log(`Bulundu: ${orderPackage.lines?.length || 0} kalem, tutar ~${orderPackage.packageGrossAmount || 0} TL`);
  } else {
    orderPackage = await buildManualOrder(client, args);
    console.log(`Manuel test ürünü: ${args.barcode} x ${args.qty}`);
  }

  const built = buildChannelSaleFromOrder({
    ...orderPackage,
    orderNumber: args.uberOrder || orderPackage.orderNumber,
    customerCode: 'TRENDGO-Musteri'
  }, db, { channelId: 'uber-eats', mode, salePolicy: 'sale-strict' });

  const payload = built.payload;
  if (built.skippedLines.length) {
    console.log(`\nAtlanan satırlar (${mode}):`, built.skippedLines);
  }
  console.log(`Eşleştirme modu: ${mode} · satışa dahil: ${built.saleLines.length} kalem`);

  if (args.note) {
    payload.data.note = args.note;
  }

  console.log('\n--- TRENDGO payload (paymentType: ' + BENIMPOS_PAYMENT.TRENDGO + ') ---');
  console.log(JSON.stringify(payload, null, 2));

  if (args.dryRun) {
    console.log('\nDry-run tamam. Gerçek gönderim için --execute ekleyin (stok düşer).');
    return;
  }

  console.log('\n⚠️  Gerçek satış gönderiliyor — BenimPOS stok düşecek...');
  const saleData = payload.data;
  const result = await createSale(client, {
    paymentType: saleData.paymentType,
    note: saleData.note,
    customerCode: saleData.customerCode,
    date: saleData.date,
    time: saleData.time,
    lines: saleData.products.map((p) => ({
      barcode: p.barcode,
      title: p.name,
      unitPrice: p.price,
      quantity: p.quantity,
      taxRate: p.taxRate
    }))
  });

  console.log('\n--- BenimPOS yanıtı ---');
  console.log(JSON.stringify(result, null, 2));
  console.log('\nSatış kodu (iptal için saklayın):', result.salesCode || '(yok)');
}

main().catch((error) => {
  console.error('\nHata:', error.message || error);
  process.exit(1);
});
