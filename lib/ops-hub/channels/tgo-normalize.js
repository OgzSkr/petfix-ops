import { readEnvFile } from '../../env.js';
import { paths, resolveRuntimeConfig } from '../../config.js';
import { isMissingConfigValue } from '../../env.js';
import { resolveMatchingModeForChannel, resolveChannelLine } from '../../product-matching/resolve.js';
import { readDb } from '../../db/store.js';
import { extractTgoCustomerFields } from '../../channels/tgo-customer.js';
import { ACTIVE_PACKAGE_STATUSES } from '../../channels/tgo-package-statuses.js';

export async function loadTgoOpsConfig(platformEnv = null) {
  const env = platformEnv || (await readEnvFile(paths.platformEnv));
  const apiKey = env.UBER_EATS_API_KEY || process.env.UBER_EATS_API_KEY || '';
  const apiSecret = env.UBER_EATS_API_SECRET || process.env.UBER_EATS_API_SECRET || '';

  return {
    supplierId: env.UBER_EATS_SUPPLIER_ID || process.env.UBER_EATS_SUPPLIER_ID || '',
    integrationRef: env.UBER_EATS_INTEGRATION_REF || process.env.UBER_EATS_INTEGRATION_REF || '',
    storeId: env.UBER_EATS_STORE_ID || process.env.UBER_EATS_STORE_ID || '',
    environment: env.UBER_EATS_ENV || process.env.UBER_EATS_ENV || 'PROD',
    apiKey,
    apiSecret,
    authToken: buildAuthToken(apiKey, apiSecret)
  };
}

export function isTgoOpsConfigured(cfg) {
  return Boolean(
    cfg?.supplierId &&
    cfg?.apiKey &&
    cfg?.apiSecret &&
    !isMissingConfigValue(cfg.apiKey) &&
    !isMissingConfigValue(cfg.apiSecret)
  );
}

function buildAuthToken(apiKey, apiSecret) {
  if (!apiKey || !apiSecret) {
    return '';
  }
  return Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
}

const PACKAGE_STATUS_TO_OPS = Object.freeze({
  Created: 'received',
  Picking: 'picking',
  Invoiced: 'picked',
  Shipped: 'dispatched',
  Delivered: 'completed',
  Cancelled: 'cancelled',
  UnDelivered: 'failed',
  Returned: 'cancelled'
});

export function mapTgoPackageStatus(packageStatus) {
  return PACKAGE_STATUS_TO_OPS[String(packageStatus || '')] || 'received';
}

export function mapTgoDeliveryMode(deliveryModel) {
  const value = String(deliveryModel || '').trim().toUpperCase();
  if (value === 'GO') {
    return 'platform_courier';
  }
  if (value === 'STORE') {
    return 'pickup';
  }
  return 'unknown';
}

export function mapMatchingToOpsStatus(resolved, mode) {
  if (resolved.source === 'mapping') {
    return 'matched';
  }
  if (mode === 'strict') {
    return 'blocked';
  }
  if (resolved.mappingStatus === 'unmapped') {
    return 'unmapped';
  }
  return 'legacy';
}

export async function normalizeTgoGroceryPackage(pkg, options = {}) {
  const db = options.db || (await readDb());
  const runtime = resolveRuntimeConfig(options.platformEnv || {});
  const mode = resolveMatchingModeForChannel(
    runtime.productMatchingMode,
    'uber-eats',
    runtime.productMatchingModeByChannel
  );

  const lines = [];
  for (const [index, line] of (pkg.lines || []).entries()) {
    const barcode = String(line?.barcode || '').trim() || null;
    const resolved = barcode
      ? resolveChannelLineForOps(db, { channelBarcode: barcode, mode })
      : {
          source: 'none',
          mappingStatus: 'unmapped',
          includeInSale: false
        };

    const quantity = sumLineQuantity(line);
    lines.push({
      lineIndex: index,
      channelProductId: String(line?.items?.[0]?.id || line?.barcode || `line-${index}`),
      barcode,
      title: String(line?.product?.productSaleName || line?.product?.name || '').trim() || null,
      imageUrl: String(line?.product?.images?.[0]?.url || line?.product?.imageUrl || '').trim() || null,
      quantity,
      unitPrice: line?.price != null
        ? Number(line.price)
        : (line?.amount != null ? Number(line.amount) : null),
      matchingStatus: mapMatchingToOpsStatus(resolved, mode),
      reservedQty: resolved.source === 'mapping' ? quantity : 0
    });
  }

  if (!lines.length) {
    return { ok: false, errors: ['TGO paket satırı yok'] };
  }

  const orderedAtMs = Number(pkg.orderDate || pkg.lastModifiedDate || Date.now());
  const tgoCfg = options.tgoCfg || (await loadTgoOpsConfig(options.platformEnv));
  const customerFields = await extractTgoCustomerFields(
    pkg,
    isTgoOpsConfigured(tgoCfg) ? tgoCfg : null
  );
  const customer = {
    name: customerFields.customerName,
    phone: customerFields.customerPhone,
    address: customerFields.customerAddress,
    identityNumber: customerFields.customerIdentityNumber,
    note: customerFields.customerNote,
    locationMasked: customerFields.customerLocationMasked
  };

  return {
    ok: true,
    order: {
      channel: 'trendyol_go',
      externalId: String(pkg.id),
      displayId: String(pkg.orderNumber || pkg.id),
      status: mapTgoPackageStatus(pkg.packageStatus),
      channelStatus: String(pkg.packageStatus || ''),
      channelIntegrationMode: 'direct',
      deliveryMode: mapTgoDeliveryMode(pkg.deliveryModel),
      shadowMode: options.shadowMode ?? true,
      customer,
      rawPayload: {
        source: 'tgo-grocery-packages',
        packageId: pkg.id,
        orderId: pkg.orderId,
        storeId: pkg.storeId,
        sellerAccepted: pkg.sellerAccepted,
        grossAmount: pkg.grossAmount,
        totalPrice: pkg.totalPrice,
        locationMasked: pkg.locationMasked,
        customer,
        shipmentAddress: pkg.shipmentAddress || null,
        invoiceAddress: pkg.invoiceAddress || null
      },
      orderedAt: new Date(orderedAtMs).toISOString(),
      lines
    }
  };
}

function resolveChannelLineForOps(db, { channelBarcode, mode }) {
  return resolveChannelLine(db, {
    channelId: 'uber-eats',
    channelBarcode,
    mode
  });
}

function sumLineQuantity(line) {
  const items = Array.isArray(line?.items) ? line.items : [];
  const active = items.filter((item) => !item.isCancelled);
  if (active.length) {
    return active.length;
  }
  return 1;
}

export { ACTIVE_PACKAGE_STATUSES };
