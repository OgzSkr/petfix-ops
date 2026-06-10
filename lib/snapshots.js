export const SNAPSHOTS_PER_BARCODE = 5;

export function trimBuyboxSnapshots(snapshots, limit = SNAPSHOTS_PER_BARCODE) {
  const byBarcode = new Map();

  for (const snapshot of snapshots) {
    const barcode = String(snapshot.barcode || '');
    if (!barcode) continue;
    if (!byBarcode.has(barcode)) byBarcode.set(barcode, []);
    byBarcode.get(barcode).push(snapshot);
  }

  const trimmed = [];
  for (const group of byBarcode.values()) {
    group.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    trimmed.push(...group.slice(0, limit));
  }

  return trimmed;
}
