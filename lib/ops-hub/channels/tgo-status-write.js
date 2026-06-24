import { fetchTgoJson } from '../../channels/tgo-market-api.js';
import { loadTgoOpsConfig } from './tgo-normalize.js';

function isTgoTransitionConflict(error) {
  const msg = String(error?.message || '');
  if (/provizyon|fiş tutarı|receipt|invoice.*empty|tutar.*boş/i.test(msg)) {
    return false;
  }
  return /409|already|geçiş|transition|accepted|invoiced|picked/i.test(msg);
}

export function isTgoPackageUnaccepted(channelStatus) {
  const status = String(channelStatus || '').trim().toLowerCase();
  return !status || status === 'created';
}

export async function tgoAcceptPackage(cfg, packageId) {
  return fetchTgoJson(
    cfg,
    `/integrator/order/grocery/suppliers/${encodeURIComponent(cfg.supplierId)}/packages/${encodeURIComponent(packageId)}/accept`,
    { method: 'PUT', body: {} }
  );
}

export async function tgoMarkPackagePicked(cfg, packageId) {
  return fetchTgoJson(
    cfg,
    `/integrator/order/grocery/suppliers/${encodeURIComponent(cfg.supplierId)}/packages/${encodeURIComponent(packageId)}/picked`,
    { method: 'PUT', body: {} }
  );
}

export async function tgoMarkPackageInvoiced(cfg, packageId, { invoiceAmount } = {}) {
  const amount = Number(invoiceAmount);
  const body = Number.isFinite(amount) && amount > 0 ? { totalPrice: amount } : {};
  return fetchTgoJson(
    cfg,
    `/integrator/order/grocery/suppliers/${encodeURIComponent(cfg.supplierId)}/packages/${encodeURIComponent(packageId)}/invoiced`,
    { method: 'PUT', body }
  );
}

export async function writeTgoChannelStatus(
  action,
  { packageId, deliveryMode, channelStatus, invoiceAmount },
  platformEnv
) {
  const cfg = await loadTgoOpsConfig(platformEnv);
  const id = String(packageId);

  if (action === 'accept') {
    const result = await tgoAcceptPackage(cfg, id);
    return { action, channel: 'trendyol_go', packageId: id, result };
  }

  if (action === 'ready') {
    try {
      await tgoAcceptPackage(cfg, id);
    } catch (error) {
      if (!isTgoTransitionConflict(error)) {
        throw error;
      }
    }

    const picked = await tgoMarkPackagePicked(cfg, id);
    const invoiced = await tgoMarkPackageInvoiced(cfg, id, { invoiceAmount });
    return {
      action,
      channel: 'trendyol_go',
      packageId: id,
      deliveryMode,
      result: { picked, invoiced }
    };
  }

  throw new Error(`TGO desteklenmeyen action: ${action}`);
}
