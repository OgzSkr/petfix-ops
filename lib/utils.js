export function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = String(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

export function findByBarcode(rows, barcode) {
  return (rows || []).find((row) => String(row.barcode) === String(barcode));
}

export function toPositiveInteger(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : fallback;
}
