import {
  loginGetirApi,
  verifyGetirOrder,
  prepareGetirOrder,
  handoverGetirOrder,
  deliverGetirOrder,
  fetchGetirOrderById
} from '../../channels/getir-api.js';
import { isGetirChannelCompleted, mapGetirOrderStatus } from './getir-normalize.js';
import { resolveGetirOpsConfig } from '../integrations/branch-config-resolver.js';

async function loadGetirSession(order, platformEnv, pool) {
  const orderId = String(order.external_id || order.externalId || '').trim();
  if (!orderId) {
    throw new Error('Getir external_id eksik');
  }

  const cfg = await resolveGetirOpsConfig(pool || null, {
    branchId: order.branch_id || order.branchId,
    platformEnv
  });
  const session = await loginGetirApi(cfg);
  return { orderId, cfg, session };
}

export async function writeGetirOrderDelivered(order, platformEnv, options = {}) {
  const { orderId, cfg, session } = await loadGetirSession(order, platformEnv, options.pool);
  const result = await deliverGetirOrder(cfg, session, orderId);

  const remote = await fetchGetirOrderById(cfg, session, orderId);
  const remoteStatus = remote?.status ?? remote?.orderStatus ?? remote?.state ?? null;
  const remoteCode = String(remoteStatus ?? '').trim();
  const remoteCompleted = isGetirChannelCompleted(remoteCode)
    || mapGetirOrderStatus(remote) === 'completed';
  if (!remoteCompleted) {
    throw new Error(
      `Getir teslim doğrulanamadı — panel durumu hâlâ ${remoteCode || 'bilinmiyor'}`
    );
  }

  return {
    action: 'deliver',
    channel: 'getir',
    orderId,
    deliveryMode: order.delivery_mode || order.deliveryMode,
    verifiedStatus: remoteCode,
    result
  };
}

export async function writeGetirChannelStatus(action, order, _lines = [], platformEnv, options = {}) {
  if (!['accept', 'ready'].includes(action)) {
    throw new Error(`Getir desteklenmeyen action: ${action}`);
  }

  const { orderId, cfg, session } = await loadGetirSession(order, platformEnv, options.pool);

  if (action === 'accept') {
    const result = await verifyGetirOrder(cfg, session, orderId);
    return { action, channel: 'getir', orderId, result };
  }

  if (action === 'ready') {
    const remote = await fetchGetirOrderById(cfg, session, orderId);
    const remoteCode = Number(remote?.status ?? remote?.orderStatus ?? remote?.state);
    const alreadyPrepared = Number.isFinite(remoteCode) && remoteCode >= 600;

    const prepareResult = alreadyPrepared
      ? { skipped: true, reason: 'Getir zaten hazır', remoteStatus: remoteCode }
      : await prepareGetirOrder(cfg, session, orderId, {
        remoteOrder: remote,
        lines: _lines
      });
    const deliveryMode = order.delivery_mode || order.deliveryMode;
    if (deliveryMode === 'platform_courier') {
      let handoverResult = null;
      try {
        handoverResult = await handoverGetirOrder(cfg, session, orderId);
      } catch (error) {
        handoverResult = { skipped: true, reason: error.message };
      }
      return {
        action,
        channel: 'getir',
        orderId,
        deliveryMode,
        result: { prepare: prepareResult, handover: handoverResult }
      };
    }
    return { action, channel: 'getir', orderId, deliveryMode, result: { prepare: prepareResult } };
  }

  throw new Error(`Getir desteklenmeyen action: ${action}`);
}
