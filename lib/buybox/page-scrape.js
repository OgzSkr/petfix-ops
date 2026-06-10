import { readTrendyolEnv } from '../trendyol-env.js';
import { productLinkMeta } from '../product-thumb.js';
import { toNumber } from '../utils.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; PetFixBuyBox/1.0; +https://petfix.local)';

function extractJsonObjectAfter(html, key) {
  const idx = html.indexOf(key);
  if (idx < 0) return null;
  const start = html.indexOf('{', idx);
  if (start < 0) return null;

  let depth = 0;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function priceFromNode(node) {
  if (!node) return 0;

  const direct = node?.price?.discountedPrice?.value ?? node?.price?.sellingPrice?.value;
  if (toNumber(direct) > 0) return toNumber(direct);

  const winnerVariant = node?.winnerVariant;
  const fromWinner = winnerVariant?.price?.discountedPrice?.value ?? winnerVariant?.price?.sellingPrice?.value;
  if (toNumber(fromWinner) > 0) return toNumber(fromWinner);

  const variant = node?.variants?.[0];
  const fromVariant = variant?.price?.discountedPrice?.value ?? variant?.price?.sellingPrice?.value;
  return toNumber(fromVariant);
}

function normalizeMerchantEntry(merchant) {
  const id = String(merchant?.id ?? merchant?.merchant?.id ?? '').trim();
  const name = String(merchant?.name ?? merchant?.merchant?.name ?? '').trim();
  const price = priceFromNode(merchant);
  if (!id || price <= 0) return null;
  return { id, name, price };
}

function extractLdOfferPrice(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return 0;
  try {
    const data = JSON.parse(match[1]);
    return toNumber(data?.offers?.price);
  } catch {
    return 0;
  }
}

function buildRankedMerchants(html) {
  const listing = extractJsonObjectAfter(html, '"merchantListing":');
  const entries = [];

  if (listing?.merchant) {
    const winner = normalizeMerchantEntry({
      id: listing.merchant.id,
      name: listing.merchant.name,
      winnerVariant: listing.winnerVariant,
      variants: listing.variants
    });
    if (winner) entries.push(winner);
  }

  for (const merchant of listing?.otherMerchants || []) {
    const entry = normalizeMerchantEntry(merchant);
    if (entry) entries.push(entry);
  }

  if (!entries.length) {
    const ldPrice = extractLdOfferPrice(html);
    if (ldPrice > 0) {
      entries.push({ id: '', name: '', price: ldPrice });
    }
  }

  const seen = new Set();
  const unique = [];
  for (const entry of entries) {
    const key = `${entry.id}|${entry.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  unique.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
  return unique;
}

export async function fetchBuyboxFromProductPage(productUrl, { sellerId = '', barcode = '' } = {}) {
  const url = String(productUrl || '').trim();
  if (!url || !/^https:\/\/www\.trendyol\.com\//i.test(url)) {
    throw new Error('Geçerli Trendyol ürün linki gerekli.');
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'tr-TR,tr;q=0.9'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`Ürün sayfası açılamadı (HTTP ${response.status}).`);
  }

  const html = await response.text();
  const merchants = buildRankedMerchants(html);
  if (!merchants.length) {
    return null;
  }

  const normalizedSellerId = String(sellerId || '').trim();
  let buyboxOrder = '';
  if (normalizedSellerId) {
    const index = merchants.findIndex((entry) => entry.id === normalizedSellerId);
    if (index >= 0) buyboxOrder = index + 1;
  }

  const first = merchants[0];
  const second = merchants[1];
  const third = merchants[2];

  return {
    barcode: String(barcode || '').trim(),
    buyboxPrice: first.price,
    buyboxOrder,
    secondBuyboxPrice: second?.price ?? '',
    thirdBuyboxPrice: third?.price ?? '',
    hasMultipleSeller: merchants.length > 1,
    sellerId: first.id,
    sellerName: first.name,
    source: 'product-page',
    merchantCount: merchants.length
  };
}

export async function fetchBuyboxFromProductPageForBarcode(db, barcode) {
  const product = (db.products || []).find((row) => String(row.barcode) === String(barcode));
  const linkMeta = productLinkMeta(product || {});
  if (!linkMeta.productUrl) {
    return null;
  }

  const env = await readTrendyolEnv();
  const sellerId = String(env.TRENDYOL_SELLER_ID || '').trim();

  return fetchBuyboxFromProductPage(linkMeta.productUrl, { sellerId, barcode });
}
