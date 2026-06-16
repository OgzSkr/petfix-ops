import { getYemeksepetiAccessToken } from '../../channels/yemeksepeti-auth.js';
import { loadYemeksepetiOpsConfig } from './yemeksepeti-status-write.js';

const API_BASE = 'https://yemeksepeti.partner.deliveryhero.io/v2';
const MAX_BATCH = 200;

/** @param {'full'|'price'|'stock'} mode */
export function buildYemeksepetiStockPayload(items = [], options = {}) {
  const mode = options.mode === 'price' || options.mode === 'stock' ? options.mode : 'full';
  const includeStock = mode === 'full' || mode === 'stock';
  const includePrice = mode === 'full' || mode === 'price';

  return {
    products: items.map((item) => {
      const product = {
        sku: String(item.channelProductId || '').trim()
      };
      if (includeStock) {
        product.quantity = Math.max(0, Math.floor(Number(item.targetQuantity) || 0));
        product.active = (Number(item.targetQuantity) || 0) > 0;
      }
      if (includePrice) {
        const price = Number(item.targetPrice);
        if (Number.isFinite(price) && price > 0) {
          product.price = price;
        }
      }
      return product;
    })
  };
}

export async function pushYemeksepetiStockUpdates(cfg, items = [], options = {}) {
  const chainId = String(cfg.chainId || '').trim();
  const vendorId = String(cfg.vendorId || '').trim();
  if (!chainId || !vendorId) {
    throw new Error('YS chainId ve vendorId zorunlu');
  }
  if (!Array.isArray(items) || !items.length) {
    return { batches: [], totalItems: 0 };
  }

  const token = await getYemeksepetiAccessToken(cfg);
  const batches = [];

  for (let offset = 0; offset < items.length; offset += MAX_BATCH) {
    const chunk = items.slice(offset, offset + MAX_BATCH);
    const body = buildYemeksepetiStockPayload(chunk, options);

    const response = await fetch(
      `${API_BASE}/chains/${encodeURIComponent(chainId)}/vendors/${encodeURIComponent(vendorId)}/catalog`,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      }
    );

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      throw Object.assign(
        new Error(`YS stok push HTTP ${response.status}: ${text.slice(0, 300)}`),
        { statusCode: response.status, details: data }
      );
    }

    batches.push({
      offset,
      count: chunk.length,
      jobId: data.job_id || data.jobId || null,
      result: data
    });
  }

  return {
    channel: 'yemeksepeti',
    totalItems: items.length,
    batches
  };
}

export async function writeYemeksepetiStock(items, platformEnv, options = {}) {
  const cfg = await loadYemeksepetiOpsConfig(platformEnv);
  return pushYemeksepetiStockUpdates(cfg, items, options);
}
