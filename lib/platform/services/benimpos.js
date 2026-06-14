import { createLogger } from '../../logger.js';
import { paths } from '../../config.js';

const log = createLogger('BENIMPOS');
import {
  isMaskedValue,
  isMissingConfigValue,
  persistPlatformConfigUpdates,
  readPlatformConfigEnv
} from '../../env.js';
import { createBenimposClient, readBenimposConfig } from '../../benimpos/client.js';
import { syncEmptyCostsFromBenimposApi } from '../../benimpos/sync-costs.js';
import { readDb, writeDb } from '../../db/store.js';
import { getChannelAdapter } from '../../channels/registry.js';
import { buildChannelSaleFromOrder, createSale, saleOrderFromBuilt } from '../../benimpos/sales-create.js';
import { summarizeUberOrderFinancials } from '../../benimpos/channel-sale-financials.js';
import { normalizeMatchingMode } from '../../product-matching/resolve.js';
import {
  buildChannelSalesReadiness,
  enrichPreviewWithSaleGate,
  resolveBenimposSaleConfirmLevel
} from '../../product-matching/sales-readiness.js';
import { buildChannelSalePreview } from '../../product-matching/sale-preview.js';
import { appendOrderMappingLog } from '../../product-matching/store.js';

function safeVisibleValue(value) {
  return isMissingConfigValue(value) ? '' : String(value || '');
}

function requiredPayloadValue(value, label) {
  const text = String(value || '').trim();
  if (!text || isMissingConfigValue(text)) {
    throw new Error(`${label} zorunludur.`);
  }
  return text;
}

async function fetchChannelOrderPackage(channelId, orderNumber, days) {
  const adapter = getChannelAdapter(channelId);
  if (!adapter) {
    throw new Error('Kanal bulunamadı.');
  }

  const cfg = await adapter.loadConfig();
  if (!adapter.isConfigured(cfg)) {
    throw new Error('Kanal API bilgileri eksik.');
  }

  const packages = await adapter.fetchOrders({ days });
  const orderPackage = packages.find((row) => String(row.orderNumber) === orderNumber);
  if (!orderPackage) {
    throw new Error(`Sipariş bulunamadı: ${orderNumber} (son ${days} gün)`);
  }

  return orderPackage;
}

export function createBenimposService({ config = {} } = {}) {
  function saleConfirmLevel() {
    return resolveBenimposSaleConfirmLevel(
      config.productMatchingMode,
      config.benimposSaleConfirmLevel
    );
  }

  async function getSettings() {
    const env = await readPlatformConfigEnv(paths.platformEnv);
    const apiKey = safeVisibleValue(env.BENIMPOS_API_KEY);
    const secretKey = safeVisibleValue(env.BENIMPOS_SECRET_KEY);

    return {
      branchId: safeVisibleValue(env.BENIMPOS_BRANCH_ID),
      apiUrl: safeVisibleValue(env.BENIMPOS_API_URL) || 'https://dev.benimpos.com/api',
      apiKey: '',
      apiKeyConfigured: !isMissingConfigValue(apiKey),
      secretKey: '',
      secretKeyConfigured: !isMissingConfigValue(secretKey),
      readOnly: true,
      productMatchingMode: normalizeMatchingMode(config.productMatchingMode),
      salePolicy: 'matching-before-sale',
      saleConfirmLevel: saleConfirmLevel()
    };
  }

  async function saveSettings(payload) {
    const existing = await readPlatformConfigEnv(paths.platformEnv);
    const apiKeyInput = String(payload.apiKey || '').trim();
    const secretKeyInput = String(payload.secretKey || '').trim();
    const nextApiKey = isMaskedValue(apiKeyInput) || !apiKeyInput
      ? existing.BENIMPOS_API_KEY
      : apiKeyInput;
    const nextSecretKey = !secretKeyInput || isMaskedValue(secretKeyInput)
      ? existing.BENIMPOS_SECRET_KEY
      : secretKeyInput;

    if (isMissingConfigValue(nextApiKey)) {
      throw new Error('API Key zorunludur.');
    }
    if (isMissingConfigValue(nextSecretKey)) {
      throw new Error('Secret Key zorunludur.');
    }

    await persistPlatformConfigUpdates(paths.platformEnv, {
      BENIMPOS_BRANCH_ID: requiredPayloadValue(payload.branchId, 'Branch ID'),
      BENIMPOS_API_URL: String(payload.apiUrl || existing.BENIMPOS_API_URL || 'https://dev.benimpos.com/api').trim(),
      BENIMPOS_API_KEY: nextApiKey,
      BENIMPOS_SECRET_KEY: nextSecretKey
    });

    const cfg = await readBenimposConfig();
    const client = createBenimposClient(cfg);
    const health = await client.healthCheck();

    return { ok: true, health, readOnly: true };
  }

  async function getStatus() {
    const cfg = await readBenimposConfig();
    if (
      isMissingConfigValue(cfg.branchId)
      || isMissingConfigValue(cfg.apiKey)
      || isMissingConfigValue(cfg.secretKey)
    ) {
      return {
        ok: false,
        configured: false,
        message: 'BenimPOS API bilgileri eksik. Ayarlar sayfasından girin.'
      };
    }

    const client = createBenimposClient(cfg);
    const health = await client.healthCheck();
    return {
      ok: true,
      configured: true,
      readOnly: true,
      productMatchingMode: normalizeMatchingMode(config.productMatchingMode),
      salePolicy: 'matching-before-sale',
      saleConfirmLevel: saleConfirmLevel(),
      ...health
    };
  }

  async function syncCosts(options = {}) {
    const result = await syncEmptyCostsFromBenimposApi(options);
    return result;
  }

  async function getSalesReadiness(channelId = 'uber-eats') {
    const db = await readDb();
    const confirmLevel = saleConfirmLevel();
    const readiness = buildChannelSalesReadiness(db, channelId, confirmLevel);
    return {
      ok: true,
      productMatchingMode: normalizeMatchingMode(config.productMatchingMode),
      saleConfirmLevel: saleConfirmLevel(),
      ...readiness
    };
  }

  /**
   * Satış ön izleme — eşleştirme kapısı dahil.
   */
  async function previewChannelSale(payload = {}) {
    const channelId = String(payload.channelId || 'uber-eats').trim();
    const orderNumber = String(payload.orderNumber || '').trim();
    const days = Math.min(Math.max(Number(payload.days) || 14, 1), 90);
    const confirmLevel = saleConfirmLevel();

    if (!orderNumber) {
      throw new Error('orderNumber zorunlu.');
    }

    const orderPackage = await fetchChannelOrderPackage(channelId, orderNumber, days);
    const db = await readDb();
    const channelReadiness = buildChannelSalesReadiness(db, channelId, confirmLevel);
    const preview = enrichPreviewWithSaleGate(
      buildChannelSalePreview(orderPackage, db, { channelId }),
      confirmLevel
    );

    let payloadPreview = null;
    if (preview.canSend) {
      try {
        const built = buildChannelSaleFromOrder(orderPackage, db, {
          channelId,
          salePolicy: 'sale-strict',
          confirmLevel
        });
        payloadPreview = built.payload;
      } catch (error) {
        preview.canSend = false;
        preview.canSendRealSale = false;
        preview.blockReasons.push(error.message);
      }
    }

    return {
      ok: true,
      dryRun: true,
      productMatchingMode: normalizeMatchingMode(config.productMatchingMode),
      salePolicy: 'matching-before-sale',
      saleConfirmLevel: confirmLevel,
      channelReadiness,
      financials: channelId === 'uber-eats' ? summarizeUberOrderFinancials(orderPackage) : null,
      ...preview,
      payload: payloadPreview
    };
  }

  /**
   * Manuel BenimPOS satışı — yalnızca preview.canSend=true iken ve confirmed=true ile.
   */
  async function createChannelSale(payload = {}) {
    const channelId = String(payload.channelId || 'uber-eats').trim();
    const orderNumber = String(payload.orderNumber || '').trim();
    const dryRun = payload.dryRun !== false;
    const confirmed = Boolean(payload.confirmed);
    const days = Math.min(Math.max(Number(payload.days) || 14, 1), 90);

    if (!orderNumber) {
      throw new Error('orderNumber zorunlu.');
    }

    const confirmLevel = saleConfirmLevel();
    const orderPackage = await fetchChannelOrderPackage(channelId, orderNumber, days);
    const db = await readDb();
    const preview = enrichPreviewWithSaleGate(
      buildChannelSalePreview(orderPackage, db, { channelId }),
      confirmLevel
    );

    if (!preview.canSend || !preview.canSendRealSale) {
      const error = new Error(
        preview.blockReasons?.[0]
          || 'Gerçek satış engellendi — tüm satırlar manuel onaylı eşleştirme gerektirir.'
      );
      error.preview = preview;
      error.code = 'MATCHING_GATE_BLOCKED';
      throw error;
    }

    let built;
    try {
      built = buildChannelSaleFromOrder(orderPackage, db, {
        channelId,
        salePolicy: 'sale-strict',
        confirmLevel
      });
    } catch (error) {
      error.preview = preview;
      throw error;
    }

    if (!dryRun && !confirmed) {
      throw new Error('Gerçek satış için confirmed:true ve dryRun:false gönderin.');
    }

    const benimposCfg = await readBenimposConfig();
    if (
      !dryRun && (
        isMissingConfigValue(benimposCfg.branchId)
        || isMissingConfigValue(benimposCfg.apiKey)
        || isMissingConfigValue(benimposCfg.secretKey)
      )
    ) {
      throw new Error('BenimPOS API bilgileri eksik — satış gönderilemez.');
    }

    const client = createBenimposClient(benimposCfg);
    const result = await createSale(client, saleOrderFromBuilt(built), { dryRun });
    let logWriteWarning = null;

    if (!dryRun) {
      appendOrderMappingLog(db, {
        action: 'benimpos_sale',
        channelId,
        orderNumber,
        mode: normalizeMatchingMode(config.productMatchingMode),
        salePolicy: 'matching-before-sale',
      saleConfirmLevel: confirmLevel,
        salesCode: result.salesCode || null,
        lineCount: built.saleLines.length,
        skippedCount: built.skippedLines.length,
        saleLines: built.saleLines.map((line) => ({
          channelBarcode: line.channelBarcode,
          saleBarcode: line.saleBarcode,
          mappingStatus: line.mappingStatus,
          title: line.title
        })),
        skippedLines: built.skippedLines
      });
      db.meta = db.meta || {};
      db.meta.updatedAt = new Date().toISOString();
      try {
        await writeDb(db);
      } catch (error) {
        logWriteWarning = error.message;
        log.warn(`BenimPOS satış kaydı db.json'a yazılamadı (${error.message}) — satış BenimPOS'ta oluşturulmuş olabilir.`);
      }
    }

    return {
      ok: true,
      dryRun,
      confirmed,
      productMatchingMode: normalizeMatchingMode(config.productMatchingMode),
      salePolicy: 'matching-before-sale',
      saleConfirmLevel: confirmLevel,
      channelId,
      orderNumber,
      salesCode: result.salesCode || null,
      message: logWriteWarning
        ? `Satış BenimPOS'ta oluşturuldu (${result.salesCode || 'kod yok'}) ancak yerel kayıt yazılamadı: ${logWriteWarning}`
        : (result.message || (dryRun ? 'Dry-run payload hazır.' : 'Satış oluşturuldu.')),
      logWriteWarning,
      payload: result.payload || built.payload,
      financials: built.financials || null,
      preview,
      saleLines: built.saleLines,
      skippedLines: built.skippedLines
    };
  }

  return {
    getSettings,
    saveSettings,
    getStatus,
    syncCosts,
    getSalesReadiness,
    previewChannelSale,
    createChannelSale
  };
}
