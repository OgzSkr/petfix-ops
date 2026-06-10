import { getYemeksepetiAccessToken } from '../../channels/yemeksepeti-auth.js';
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';

const API_BASE = 'https://yemeksepeti.partner.deliveryhero.io/v2';

export async function loadYemeksepetiOpsConfig(platformEnv = null) {
  const env = platformEnv || (await readEnvFile(paths.platformEnv));
  return {
    chainId: env.YEMEKSEPETI_CHAIN_ID || process.env.YEMEKSEPETI_CHAIN_ID || '',
    vendorId: env.YEMEKSEPETI_VENDOR_ID || process.env.YEMEKSEPETI_VENDOR_ID || '',
    clientId: env.YEMEKSEPETI_CLIENT_ID || process.env.YEMEKSEPETI_CLIENT_ID || '',
    clientSecret: env.YEMEKSEPETI_CLIENT_SECRET || process.env.YEMEKSEPETI_CLIENT_SECRET || ''
  };
}

export function resolveYsReadyStatus(deliveryMode) {
  if (deliveryMode === 'own_courier') {
    return 'DISPATCHED';
  }
  return 'READY_FOR_PICKUP';
}

export async function updateYemeksepetiOrderStatus(
  cfg,
  { orderId, status, items = [] }
) {
  const chainId = String(cfg.chainId || '').trim();
  const ysOrderId = String(orderId || '').trim();
  if (!chainId || !ysOrderId) {
    throw new Error('YS chainId ve orderId zorunlu');
  }

  const token = await getYemeksepetiAccessToken(cfg);
  const response = await fetch(
    `${API_BASE}/chains/${encodeURIComponent(chainId)}/orders/${encodeURIComponent(ysOrderId)}`,
    {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        order_id: ysOrderId,
        status,
        items
      })
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
    throw new Error(`YS status güncelleme HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  return data;
}

export async function writeYemeksepetiChannelStatus(action, order, lines = [], platformEnv) {
  const cfg = await loadYemeksepetiOpsConfig(platformEnv);
  const raw = order.raw_payload || order.rawPayload || {};
  const ysOrderId = raw.orderId || raw.order_id;

  if (!ysOrderId) {
    throw new Error('YS order_id raw_payload içinde bulunamadı');
  }

  if (action === 'accept') {
    return {
      action,
      channel: 'yemeksepeti',
      orderId: ysOrderId,
      result: { skipped: true, note: 'YS accept — sipariş zaten RECEIVED; picking başlatıldı' }
    };
  }

  if (action === 'ready') {
    const status = resolveYsReadyStatus(order.delivery_mode || order.deliveryMode);
    const result = await updateYemeksepetiOrderStatus(cfg, {
      orderId: ysOrderId,
      status,
      items: buildYsItemsFromOrder(lines)
    });
    return { action, channel: 'yemeksepeti', orderId: ysOrderId, status, result };
  }

  throw new Error(`YS desteklenmeyen action: ${action}`);
}

function buildYsItemsFromOrder(lines) {
  return (lines || []).map((line) => ({
    sku: line.channel_product_id || line.channelProductId,
    barcode: line.barcode ? [line.barcode] : undefined,
    pricing: {
      quantity: Number(line.quantity || 1)
    }
  }));
}
