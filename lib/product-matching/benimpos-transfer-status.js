import { buildChannelSalePreview } from './sale-preview.js';

const BENIMPOS_TRANSFER_CHANNELS = new Set(['yemeksepeti', 'uber-eats']);

/**
 * BenimPOS otomatik aktarım göstergesi — satış ön izlemesiyle aynı katı eşleştirme kuralları.
 * transferred | ready | blocked
 */
export function computeBenimposTransferStatus(row, db, channelId) {
  if (!BENIMPOS_TRANSFER_CHANNELS.has(String(channelId || '').trim())) {
    return null;
  }

  const salesCode = String(row.benimposSalesCode || '').trim();
  if (salesCode) {
    return {
      benimposTransferStatus: 'transferred',
      benimposTransferNote: `BenimPOS satışı: ${salesCode}`
    };
  }

  const preview = buildChannelSalePreview(
    { orderNumber: row.orderNumber, lines: row.lines || [] },
    db,
    { channelId }
  );

  if (!preview.totalLines) {
    return {
      benimposTransferStatus: 'blocked',
      benimposTransferNote: 'Ürün satırı yok — BenimPOS aktarımı yapılmaz'
    };
  }

  if (preview.canSend) {
    return {
      benimposTransferStatus: 'ready',
      benimposTransferNote: 'Barkod eşleştirmesi tamam — otomatik BenimPOS aktarımı yakında'
    };
  }

  return {
    benimposTransferStatus: 'blocked',
    benimposTransferNote: preview.blockReasons[0] || 'Barkod eşleştirmesi eksik — BenimPOS aktarımı yapılmaz'
  };
}

export function enrichRowsWithBenimposTransferStatus(rows, db, channelId) {
  for (const row of rows) {
    const meta = computeBenimposTransferStatus(row, db, channelId);
    if (meta) Object.assign(row, meta);
  }
  return rows;
}
