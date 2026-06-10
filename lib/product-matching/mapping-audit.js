import { MAPPING_STATUS } from './mapping-types.js';
import { ensureProductMatching } from './schema.js';

/**
 * BenimPOS master sync sonrası geçersiz kalan eşleştirmeleri işaretler.
 */
export function auditMappingsAfterMasterSync(db) {
  const pm = ensureProductMatching(db);
  const masterIds = new Set(pm.masterProducts.map((m) => m.id));
  const now = new Date().toISOString();

  const summary = {
    orphanMaster: 0,
    markedReview: 0,
    samples: []
  };

  const protectedBefore = new Set([
    MAPPING_STATUS.AUTO_MATCHED,
    MAPPING_STATUS.MANUAL_CONFIRMED
  ]);

  for (const mapping of pm.mappings) {
    if (!mapping.masterProductId) continue;
    if (masterIds.has(mapping.masterProductId)) continue;

    summary.orphanMaster += 1;

    if (protectedBefore.has(mapping.status)) {
      mapping.status = MAPPING_STATUS.REVIEW_REQUIRED;
      mapping.reasons = [...new Set([...(mapping.reasons || []), 'master_silindi'])];
      mapping.updatedAt = now;
      mapping.confirmedAt = null;
      mapping.confirmedBy = null;
      summary.markedReview += 1;
    }

    if (summary.samples.length < 20) {
      summary.samples.push({
        mappingId: mapping.id,
        channelId: mapping.channelId,
        channelProductId: mapping.channelProductId,
        masterProductId: mapping.masterProductId,
        status: mapping.status
      });
    }
  }

  return summary;
}
