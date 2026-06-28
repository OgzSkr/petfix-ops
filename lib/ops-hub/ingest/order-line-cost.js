import { readDb } from '../../db/store.js';
import { readEnvFile } from '../../env.js';
import { paths, resolveRuntimeConfig } from '../../config.js';
import { buildCostByBarcode } from '../../order-profitability.js';
import {
  createOrderLineResolver,
  resolveLineCostDetails,
  resolveMatchingModeForChannel
} from '../../product-matching/resolve.js';

const OPS_TO_BUYBOX = Object.freeze({
  trendyol_go: 'uber-eats',
  getir: 'getir',
  yemeksepeti: 'yemeksepeti'
});

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function resolveMatchingConfig(platformEnv = null) {
  const env = platformEnv || (await readEnvFile(paths.platformEnv));
  const runtime = resolveRuntimeConfig(env);
  return {
    productMatchingMode: runtime.productMatchingMode,
    productMatchingModeByChannel: runtime.productMatchingModeByChannel || {}
  };
}

/**
 * Ingest anında ana havuz alış fiyatını satıra yazar.
 * Sonraki BenimPOS sync yalnızca yeni siparişleri etkiler; mevcut unit_cost değişmez.
 */
export async function captureOrderLineCosts({ channel, lines = [], platformEnv = null, db: injectedDb = null } = {}) {
  const opsChannel = String(channel || '').trim();
  const buyboxChannel = OPS_TO_BUYBOX[opsChannel];
  if (!buyboxChannel || !lines.length) {
    return lines.map((line) => ({ ...line }));
  }

  const db = injectedDb || (await readDb());
  const matching = await resolveMatchingConfig(platformEnv);
  const productMatchingMode = resolveMatchingModeForChannel(
    matching.productMatchingMode,
    buyboxChannel,
    matching.productMatchingModeByChannel
  );
  const costByBarcode = buildCostByBarcode(db);
  const resolveLine = createOrderLineResolver(db, buyboxChannel, productMatchingMode);
  const capturedAt = new Date().toISOString();

  return lines.map((line) => {
    if (line.unitCost != null && Number(line.unitCost) > 0) {
      return { ...line };
    }

    const barcode = String(line.barcode || '').trim();
    const resolved = resolveLine({
      barcode,
      productName: line.title || '',
      name: line.title || '',
      quantity: line.quantity
    });
    const costDetails = resolveLineCostDetails(costByBarcode, resolved);
    const unitCost = roundMoney(costDetails.cost?.unitCost);

    return {
      ...line,
      unitCost: unitCost > 0 ? unitCost : null,
      costSource: unitCost > 0 ? (costDetails.costSource || 'master_buying_price') : null,
      costCapturedAt: unitCost > 0 ? capturedAt : null
    };
  });
}
