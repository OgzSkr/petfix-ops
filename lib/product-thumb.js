import { readDb } from './db/store.js';
import { findByBarcode } from './utils.js';

const cache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

function normalizeContentId(value) {
  if (value === '' || value === null || value === undefined) return '';
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return '';
  return String(Math.trunc(parsed));
}

function contentIdFromProduct(product) {
  const fromField = normalizeContentId(product.contentId);
  if (fromField) return fromField;

  const url = String(product.productUrl || '');
  const match = url.match(/-p-(\d+)/i);
  return match ? match[1] : '';
}

function slugifyTrendyolTitle(title) {
  return String(title || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'urun';
}

/** Build Trendyol product URL from contentId when productUrl is missing. */
export function trendyolProductUrlFromProduct(product = {}) {
  const existing = String(product.productUrl || '').trim();
  if (existing) return existing;

  const contentId = contentIdFromProduct(product);
  if (!contentId) return '';

  const slug = slugifyTrendyolTitle(product.title || product.name || '');
  return `https://www.trendyol.com/${slug}-p-${contentId}`;
}

function extractOgImage(html) {
  const patterns = [
    /property="og:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:image"/i,
    /property='og:image'\s+content='([^']+)'/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/&amp;/g, '&');
    }
  }

  return '';
}

async function fetchOgImage(productUrl) {
  const response = await fetch(productUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PetFixBuyBox/1.0)',
      Accept: 'text/html,application/xhtml+xml'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error('product page unavailable');
  }

  const html = await response.text();
  return extractOgImage(html);
}

export async function resolveProductThumb(barcode, channelId = '') {
  const key = String(barcode || '').trim();
  if (!key) return null;

  const cacheKey = channelId ? `${channelId}:${key}` : key;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.imageUrl;
  }

  const db = await readDb();
  const product = findByBarcode(db.products || [], key) || {};

  if (product.imageUrl) {
    cache.set(cacheKey, { imageUrl: product.imageUrl, expiresAt: Date.now() + CACHE_TTL_MS });
    return product.imageUrl;
  }

  const channelFilter = String(channelId || '').trim();
  for (const cp of db.productMatching?.channelProducts || []) {
    if (channelFilter && cp.channelId !== channelFilter) continue;
    const cpBarcode = String(cp.channelBarcode || cp.channelProductId || '').trim();
    if (cpBarcode !== key) continue;
    const channelImage = String(cp.channelImageUrl || cp.catalogImageUrl || '').trim();
    if (channelImage) {
      cache.set(cacheKey, { imageUrl: channelImage, expiresAt: Date.now() + CACHE_TTL_MS });
      return channelImage;
    }
  }

  const productUrl = trendyolProductUrlFromProduct(product);
  if (!productUrl) {
    cache.set(cacheKey, { imageUrl: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }

  try {
    const imageUrl = await fetchOgImage(productUrl);
    cache.set(cacheKey, { imageUrl: imageUrl || null, expiresAt: Date.now() + CACHE_TTL_MS });
    return imageUrl || null;
  } catch {
    cache.set(cacheKey, { imageUrl: null, expiresAt: Date.now() + 1000 * 60 * 5 });
    return null;
  }
}

export function productLinkMeta(product = {}) {
  const contentId = contentIdFromProduct(product);
  const productUrl = trendyolProductUrlFromProduct(product);

  return {
    productUrl,
    contentId,
    imageUrl: product.imageUrl || ''
  };
}
