import { barcodesEquivalent } from './normalize.js';
import { MAPPING_STATUS } from './mapping-types.js';

const CONFIRMED_STATUSES = new Set([
  MAPPING_STATUS.MANUAL_CONFIRMED,
  MAPPING_STATUS.AUTO_MATCHED
]);

/**
 * Aynı BenimPOS master'a aynı kanaldan birden fazla onaylı eşleşme var mı?
 */
export function analyzeDuplicateChannelMappings(channelMappingDetails = [], masterBarcode = '') {
  const byChannel = new Map();

  for (const detail of channelMappingDetails || []) {
    if (!CONFIRMED_STATUSES.has(detail.status)) continue;
    const channelId = String(detail.channelId || '').trim();
    if (!channelId) continue;
    if (!byChannel.has(channelId)) byChannel.set(channelId, []);
    byChannel.get(channelId).push(detail);
  }

  const byChannelDuplicates = [];

  for (const [channelId, items] of byChannel) {
    if (items.length <= 1) continue;

    const enriched = items.map((item) => {
      const barcodeMatch = barcodesEquivalent(item.channelBarcode, masterBarcode);
      return {
        ...item,
        barcodeMatch,
        likelyWrong: false
      };
    });

    const barcodeMatches = enriched.filter((item) => item.barcodeMatch);
    const prices = enriched
      .map((item) => Number(item.channelSalePrice))
      .filter((price) => Number.isFinite(price) && price > 0);

    if (barcodeMatches.length === 1) {
      for (const item of enriched) {
        if (!item.barcodeMatch) item.likelyWrong = true;
      }
    } else if (barcodeMatches.length === 0 && prices.length >= 2) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      if (min > 0 && max / min >= 2) {
        const keep = enriched.reduce((best, item) => {
          const price = Number(item.channelSalePrice) || 0;
          if (!best) return item;
          const bestPrice = Number(best.channelSalePrice) || 0;
          return price > 0 && (bestPrice <= 0 || price < bestPrice) ? item : best;
        }, null);
        for (const item of enriched) {
          if (keep && item.channelProductId !== keep.channelProductId) {
            item.likelyWrong = true;
          }
        }
      }
    }

    byChannelDuplicates.push({
      channelId,
      count: enriched.length,
      items: enriched,
      likelyWrong: enriched.filter((item) => item.likelyWrong)
    });
  }

  const extraMappingCount = byChannelDuplicates.reduce(
    (sum, group) => sum + Math.max(0, group.count - 1),
    0
  );

  return {
    hasDuplicates: byChannelDuplicates.length > 0,
    extraMappingCount,
    byChannel: byChannelDuplicates
  };
}
