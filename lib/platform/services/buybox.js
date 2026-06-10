import fs from 'node:fs/promises';
import { paths, limits } from '../../config.js';
import { readDb, writeDb, readJsonFile } from '../../db/store.js';
import { appendBuyboxHistory } from '../../buybox/history.js';
import { createLogger } from '../../logger.js';
import { ingestSnapshots } from '../../snapshot-ingest.js';
import { findByBarcode, toNumber } from '../../utils.js';
import { fetchBuyboxFromProductPageForBarcode } from '../../buybox/page-scrape.js';
import { fetchTrendyolBuybox } from './worker.js';
import { latestByBarcodeMap } from './profitability.js';

const log = createLogger('BUYBOX');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveBuyboxForBarcode(db, barcode) {
  const items = await fetchTrendyolBuybox([barcode]);
  const apiItem = items.find((entry) => String(entry.barcode || '') === String(barcode)) || items[0];
  if (apiItem) {
    return { item: apiItem, source: 'api' };
  }

  const scraped = await fetchBuyboxFromProductPageForBarcode(db, barcode);
  if (scraped) {
    return { item: scraped, source: 'product-page' };
  }

  return null;
}

function normalizePriority(value) {
  const priority = String(value || 'normal').toLowerCase();
  return ['critical', 'normal', 'low'].includes(priority) ? priority : 'normal';
}

function priorityRank(value) {
  return {
    critical: 0,
    normal: 1,
    low: 2
  }[normalizePriority(value)];
}

async function writeAutoTrackBarcodesFile(items) {
  const activeItems = (items || [])
    .filter((item) => item.enabled !== false && item.barcode)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || String(a.barcode).localeCompare(String(b.barcode)));
  const lines = [
    '# Bu dosya BuyBox Platform tarafindan yonetilir.',
    '# Panelde Otomatik Takip listesini degistirdiginizde otomatik guncellenir.',
    ...activeItems.map((item) => item.barcode)
  ];

  await fs.writeFile(paths.autoTrackBarcodes, `${lines.join('\n')}\n`, 'utf8');
}

export function createBuyboxService({ runtime, dashboardRowForBarcode, migrateAutoTrackListFromFile }) {
  async function syncBuyboxCache(options = {}) {
    const now = Date.now();
    if (!options.force && now - runtime.lastCacheSyncAt < limits.cacheSyncCooldownMs) {
      return {
        ok: true,
        skipped: true,
        cooldownSeconds: Math.ceil((limits.cacheSyncCooldownMs - (now - runtime.lastCacheSyncAt)) / 1000),
        message: 'Cache senkronu için kısa süre bekleyin.'
      };
    }

    const db = await readDb();
    const cache = await readJsonFile(paths.buyboxCache, null);

    if (!cache || !Array.isArray(cache.items)) {
      return { ok: true, imported: 0, message: options.silent ? '' : 'BuyBox cache bulunamadı.' };
    }

    const result = ingestSnapshots(db, cache.items, { updatedAt: cache.updatedAt || new Date().toISOString() });
    if (result.imported > 0) {
      await appendBuyboxHistory(cache.items, { source: 'cache-sync', channel: 'trendyol' });
    }
    await writeDb(db);
    runtime.lastCacheSyncAt = now;
    log.info(`Cache senkron: ${result.imported} yeni snapshot`);

    return {
      ...result,
      message: result.imported ? `${result.imported} yeni snapshot eklendi.` : 'Yeni snapshot yok.'
    };
  }

  async function ingestLiveBuybox(payload) {
    const db = await readDb();
    const result = ingestSnapshots(db, payload.items || [], {
      updatedAt: payload.updatedAt || new Date().toISOString()
    });
    if (result.imported > 0) {
      const newSnapshots = (payload.items || []).filter((item) => item?.barcode);
      await appendBuyboxHistory(newSnapshots, {
        source: payload.source || 'webhook',
        channel: payload.channel || 'trendyol'
      });
    }
    await writeDb(db);
    return result;
  }

  async function refreshSingleBuybox(payload) {
    const barcode = String(payload?.barcode || '').trim();

    if (!barcode) {
      throw new Error('Barkod zorunludur.');
    }

    const db = await readDb();
    const latest = latestByBarcodeMap(db.buyboxSnapshots || [])[barcode];
    const ageMs = latest?.updatedAt ? Date.now() - new Date(latest.updatedAt).getTime() : Infinity;

    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < limits.manualRefreshCooldownMs) {
      return {
        ok: true,
        skipped: true,
        cooldownSeconds: Math.ceil((limits.manualRefreshCooldownMs - ageMs) / 1000),
        message: 'Bu ürün az önce güncellendi.',
        row: await dashboardRowForBarcode(barcode)
      };
    }

    const resolved = await resolveBuyboxForBarcode(db, barcode);

    if (!resolved?.item) {
      await updateAutoTrackError(barcode, 'Trendyol API ve ürün sayfasından BuyBox verisi alınamadı.');
      return {
        ok: false,
        message: 'Trendyol API ve ürün sayfasından BuyBox verisi alınamadı.'
      };
    }

    const result = await ingestLiveBuybox({
      updatedAt: new Date().toISOString(),
      items: [resolved.item],
      changedItems: [resolved.item],
      source: resolved.source
    });
    await updateAutoTrackSuccess(barcode);

    const sourceNote = resolved.source === 'product-page' ? ' (ürün sayfası)' : '';
    return {
      ok: true,
      skipped: false,
      imported: result.imported,
      source: resolved.source,
      message: 'Ürün canlı güncellendi' + sourceNote + '.',
      row: await dashboardRowForBarcode(barcode)
    };
  }

  function collectTariffMissingBuyboxBarcodes(db, latestMap) {
    const tariff = db.commissionTariff?.byBarcode || {};
    return Object.keys(tariff).filter((barcode) => !toNumber(latestMap[barcode]?.buyboxPrice));
  }

  async function refreshBatchBuybox(payload = {}) {
    const db = await readDb();
    const latestMap = latestByBarcodeMap(db.buyboxSnapshots || []);
    let barcodes = Array.isArray(payload.barcodes)
      ? payload.barcodes.map((value) => String(value).trim()).filter(Boolean)
      : [];

    if (payload.missingFromTariff) {
      barcodes = collectTariffMissingBuyboxBarcodes(db, latestMap);
    }

    const maxCount = Math.min(Math.max(Number(payload.maxCount) || 30, 1), 100);
    barcodes = [...new Set(barcodes)].slice(0, maxCount);

    const summary = { requested: barcodes.length, updated: 0, skipped: 0, noData: 0, imported: 0 };
    const eligible = [];

    for (const barcode of barcodes) {
      const latest = latestMap[barcode];
      const ageMs = latest?.updatedAt ? Date.now() - new Date(latest.updatedAt).getTime() : Infinity;
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < limits.manualRefreshCooldownMs) {
        summary.skipped += 1;
        continue;
      }
      eligible.push(barcode);
    }

    const allToIngest = [];
    let pageFetched = 0;

    for (let index = 0; index < eligible.length; index += 10) {
      const chunk = eligible.slice(index, index + 10);
      const items = await fetchTrendyolBuybox(chunk);
      const byBarcode = new Map(items.map((entry) => [String(entry.barcode || ''), entry]));
      const pendingPage = [];

      for (const barcode of chunk) {
        const item = byBarcode.get(barcode);
        if (item) {
          allToIngest.push(item);
          summary.updated += 1;
        } else {
          pendingPage.push(barcode);
        }
      }

      for (const barcode of pendingPage) {
        const scraped = await fetchBuyboxFromProductPageForBarcode(db, barcode);
        if (scraped) {
          allToIngest.push(scraped);
          summary.updated += 1;
          pageFetched += 1;
        } else {
          summary.noData += 1;
          await updateAutoTrackError(barcode, 'Trendyol API ve ürün sayfasından BuyBox verisi alınamadı.');
        }
        await sleep(300);
      }
    }

    if (allToIngest.length) {
      const result = await ingestLiveBuybox({
        updatedAt: new Date().toISOString(),
        items: allToIngest,
        changedItems: allToIngest,
        source: 'batch-refresh'
      });
      summary.imported = result.imported;
      for (const item of allToIngest) {
        await updateAutoTrackSuccess(String(item.barcode));
      }
    }

    return {
      ok: true,
      ...summary,
      message: `${summary.updated} ürün güncellendi · ${summary.noData} veri yok · ${summary.skipped} atlandı` +
        (pageFetched ? ` · ${pageFetched} ürün sayfasından` : '')
    };
  }

  async function addAutoTrackBulk(payload = {}) {
    const db = await readDb();
    let barcodes = Array.isArray(payload.barcodes)
      ? payload.barcodes.map((value) => String(value).trim()).filter(Boolean)
      : [];

    if (payload.missingFromTariff) {
      const tariff = db.commissionTariff?.byBarcode || {};
      const tracked = new Set((db.autoTrackList || []).map((item) => String(item.barcode)));
      barcodes = Object.keys(tariff).filter((barcode) => !tracked.has(barcode));
    }

    barcodes = [...new Set(barcodes)];
    db.autoTrackList = db.autoTrackList || [];
    let added = 0;

    for (const barcode of barcodes) {
      const existing = findByBarcode(db.autoTrackList, barcode);
      if (existing) {
        existing.enabled = true;
        existing.updatedAt = new Date().toISOString();
        continue;
      }

      db.autoTrackList.push({
        barcode,
        priority: normalizePriority(payload.priority),
        enabled: true,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastError: ''
      });
      added += 1;
    }

    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);
    await writeAutoTrackBarcodesFile(db.autoTrackList);

    return {
      ok: true,
      added,
      total: db.autoTrackList.filter((item) => item.enabled !== false).length,
      message: `${added} ürün takibe eklendi.`,
      list: await listAutoTrack()
    };
  }

  async function listAutoTrack() {
    const db = await readDb();
    await migrateAutoTrackListFromFile(db);
    const latestByBarcode = latestByBarcodeMap(db.buyboxSnapshots || []);
    const rows = (db.autoTrackList || [])
      .filter((item) => item.enabled !== false)
      .map((item) => {
        const product = findByBarcode(db.products || [], item.barcode) || {};
        const snapshot = latestByBarcode[item.barcode] || {};

        return {
          barcode: item.barcode,
          priority: item.priority || 'normal',
          title: product.title || '',
          brand: product.brand || '',
          buyboxPrice: snapshot.buyboxPrice ?? '',
          buyboxOrder: snapshot.buyboxOrder ?? '',
          buyboxSeller: snapshot.sellerName || snapshot.merchantName || snapshot.sellerId || snapshot.merchantId || '',
          updatedAt: snapshot.updatedAt || '',
          lastError: item.lastError || '',
          addedAt: item.addedAt || ''
        };
      })
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || String(a.brand).localeCompare(String(b.brand), 'tr'));

    return {
      updatedAt: new Date().toISOString(),
      total: rows.length,
      rows
    };
  }

  async function addAutoTrack(payload) {
    const barcode = String(payload?.barcode || '').trim();

    if (!barcode) {
      throw new Error('Barkod zorunludur.');
    }

    const db = await readDb();
    db.autoTrackList = db.autoTrackList || [];
    const existing = findByBarcode(db.autoTrackList, barcode);
    const next = {
      barcode,
      priority: normalizePriority(payload.priority),
      enabled: true,
      addedAt: existing?.addedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: existing?.lastError || ''
    };

    if (existing) {
      Object.assign(existing, next);
    } else {
      db.autoTrackList.push(next);
    }

    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);
    await writeAutoTrackBarcodesFile(db.autoTrackList);

    return { ok: true, item: next, list: await listAutoTrack() };
  }

  async function removeAutoTrack(payload) {
    const barcode = String(payload?.barcode || '').trim();

    if (!barcode) {
      throw new Error('Barkod zorunludur.');
    }

    const db = await readDb();
    db.autoTrackList = (db.autoTrackList || []).filter((item) => String(item.barcode) !== barcode);
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);
    await writeAutoTrackBarcodesFile(db.autoTrackList);

    return { ok: true, list: await listAutoTrack() };
  }

  async function updateAutoTrackSuccess(barcode) {
    const db = await readDb();
    const item = findByBarcode(db.autoTrackList || [], barcode);

    if (!item) {
      return;
    }

    item.lastError = '';
    item.updatedAt = new Date().toISOString();
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);
  }

  async function updateAutoTrackError(barcode, errorMessage) {
    const db = await readDb();
    const item = findByBarcode(db.autoTrackList || [], barcode);

    if (!item) {
      return;
    }

    item.lastError = errorMessage;
    item.updatedAt = new Date().toISOString();
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);
  }

  return {
    syncBuyboxCache,
    ingestLiveBuybox,
    refreshSingleBuybox,
    refreshBatchBuybox,
    listAutoTrack,
    addAutoTrack,
    addAutoTrackBulk,
    removeAutoTrack
  };
}
