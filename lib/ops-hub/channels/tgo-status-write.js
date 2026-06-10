import { fetchTgoJson } from '../../channels/tgo-market-api.js';
import { loadTgoOpsConfig } from './tgo-normalize.js';

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

export async function tgoMarkPackageInvoiced(cfg, packageId) {
  return fetchTgoJson(
    cfg,
    `/integrator/order/grocery/suppliers/${encodeURIComponent(cfg.supplierId)}/packages/${encodeURIComponent(packageId)}/invoiced`,
    { method: 'PUT', body: {} }
  );
}

export async function writeTgoChannelStatus(action, { packageId, deliveryMode }, platformEnv) {
  const cfg = await loadTgoOpsConfig(platformEnv);
  const id = String(packageId);

  if (action === 'accept') {
    const result = await tgoAcceptPackage(cfg, id);
    return { action, channel: 'trendyol_go', packageId: id, result };
  }

  if (action === 'ready') {
    const picked = await tgoMarkPackagePicked(cfg, id);
    let invoiced = null;
    try {
      invoiced = await tgoMarkPackageInvoiced(cfg, id);
    } catch (error) {
      if (!/409|geçiş|transition/i.test(error.message)) {
        throw error;
      }
      invoiced = { skipped: true, reason: error.message };
    }
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
