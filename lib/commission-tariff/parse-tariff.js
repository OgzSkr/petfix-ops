import { toNumber } from '../utils.js';

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'I')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ş/g, 'S')
    .replace(/Ç/g, 'C')
    .replace(/Ğ/g, 'G')
    .replace(/\s+/g, ' ');
}

const HEADER_ALIASES = {
  'URUN ISMI': 'title',
  'ÜRÜN İSMİ': 'title',
  BARKOD: 'barcode',
  'SATICI STOK KODU': 'sellerStockCode',
  BEDEN: 'size',
  'MODEL KODU': 'modelCode',
  KATEGORI: 'category',
  'KATEGORİ': 'category',
  MARKA: 'brand',
  STOK: 'stock',
  '1.FIYAT ALT LIMIT': 'tier1Lower',
  '2.FIYAT UST LIMITI': 'tier2Upper',
  '2.FIYAT ÜST LİMİTİ': 'tier2Upper',
  '2.FIYAT ALT LIMIT': 'tier2Lower',
  '3.FIYAT UST LIMITI': 'tier3Upper',
  '3.FIYAT ÜST LİMİTİ': 'tier3Upper',
  '3.FIYAT ALT LIMIT': 'tier3Lower',
  '4.FIYAT UST LIMITI': 'tier4Upper',
  '4.FIYAT ÜST LİMİTİ': 'tier4Upper',
  '1.KOMISYON': 'commission1',
  '1.KOMİSYON': 'commission1',
  '2.KOMISYON': 'commission2',
  '2.KOMİSYON': 'commission2',
  '3.KOMISYON': 'commission3',
  '3.KOMİSYON': 'commission3',
  '4.KOMISYON': 'commission4',
  '4.KOMİSYON': 'commission4',
  'KOMISYONA ESAS FIYAT': 'commissionBasePrice',
  'KOMİSYONA ESAS FİYAT': 'commissionBasePrice',
  'GUNCEL KOMISYON': 'currentCommission',
  'GÜNCEL KOMİSYON': 'currentCommission',
  'GUNCEL TSF': 'currentTsf',
  'GÜNCEL TSF': 'currentTsf',
  'YENI TSF (FIYAT GUNCELLE)': 'newTsf',
  'YENİ TSF (FİYAT GÜNCELLE)': 'newTsf',
  'HESAPLANAN KOMISYON': 'calculatedCommission',
  'HESAPLANAN KOMİSYON': 'calculatedCommission',
  'TARIFE SONUNA KADAR UYGULA': 'applyUntilEnd',
  'TARİFE SONUNA KADAR UYGULA': 'applyUntilEnd',
  'EXTERNAL ID': 'externalId',
  'TARIFE GRUBU': 'tariffGroup',
  'TARİFE GRUBU': 'tariffGroup'
};

function cleanBarcode(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/e\+/i.test(raw)) {
    return String(Math.round(Number(raw)));
  }
  return raw.replace(/\.0+$/, '');
}

function text(value) {
  const raw = String(value ?? '').trim();
  return raw || '';
}

function boolFromExcel(value) {
  const raw = String(value ?? '').trim().toLocaleLowerCase('tr-TR');
  return raw === 'evet' || raw === 'yes' || raw === '1' || raw === 'true';
}

function mapRow(headers, row) {
  const item = {};
  headers.forEach((header, index) => {
    const key = HEADER_ALIASES[normalizeHeader(header)];
    if (!key) return;
    item[key] = row[index] ?? '';
  });
  return item;
}

function numericFields(item) {
  const numericKeys = [
    'stock', 'tier1Lower', 'tier2Upper', 'tier2Lower', 'tier3Upper', 'tier3Lower', 'tier4Upper',
    'commission1', 'commission2', 'commission3', 'commission4',
    'commissionBasePrice', 'currentCommission', 'currentTsf', 'newTsf', 'calculatedCommission'
  ];

  for (const key of numericKeys) {
    if (item[key] !== undefined && item[key] !== '') {
      item[key] = toNumber(item[key]);
    } else {
      item[key] = '';
    }
  }

  item.barcode = cleanBarcode(item.barcode);
  item.title = text(item.title);
  item.brand = text(item.brand);
  item.category = text(item.category);
  item.applyUntilEnd = boolFromExcel(item.applyUntilEnd);
  item.selectedTier = item.selectedTier ?? null;
  return item;
}

export function parseTrendyolTariffRows(rows) {
  if (!rows?.length) {
    throw new Error('Excel dosyası boş.');
  }

  let headerIndex = rows.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) === 'BARKOD'));

  if (headerIndex < 0) {
    throw new Error('Trendyol komisyon tarifesi formatı tanınmadı (BARKOD sütunu yok).');
  }

  const headers = rows[headerIndex];
  const items = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const mapped = mapRow(headers, row);
    if (!mapped.barcode) continue;
    items.push(numericFields(mapped));
  }

  if (!items.length) {
    throw new Error('Excel dosyasında ürün satırı bulunamadı.');
  }

  return items;
}

export function indexTariffItems(items) {
  const byBarcode = {};
  for (const item of items) {
    byBarcode[item.barcode] = item;
  }
  return byBarcode;
}
