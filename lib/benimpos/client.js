import { paths } from '../config.js';
import { isMissingConfigValue, readEnvFile } from '../env.js';

const DEFAULT_BASE_URL = 'https://dev.benimpos.com/api';

export async function readBenimposConfig(envFile = paths.platformEnv) {
  const env = envFile === process.env ? envFile : await readEnvFile(envFile);
  const source = envFile === process.env ? process.env : env;

  return {
    baseUrl: String(source.BENIMPOS_API_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    branchId: String(source.BENIMPOS_BRANCH_ID || '').trim(),
    apiKey: String(source.BENIMPOS_API_KEY || '').trim(),
    secretKey: String(source.BENIMPOS_SECRET_KEY || '').trim()
  };
}

export function assertBenimposConfig(cfg) {
  if (isMissingConfigValue(cfg.branchId)) {
    throw new Error('BenimPOS Branch ID tanımlı değil.');
  }
  if (isMissingConfigValue(cfg.apiKey)) {
    throw new Error('BenimPOS API Key tanımlı değil.');
  }
  if (isMissingConfigValue(cfg.secretKey)) {
    throw new Error('BenimPOS Secret Key tanımlı değil.');
  }
}

/**
 * Read-only BenimPOS API client.
 * Yazma işlemleri (ürün ekleme/güncelleme, satış oluşturma) bilinçli olarak burada yok.
 */
export function createBenimposClient(cfg) {
  assertBenimposConfig(cfg);

  async function request(endpoint, body) {
    const url = `${cfg.baseUrl}/${String(endpoint).replace(/^\//, '')}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        branch_id: cfg.branchId,
        api_key: cfg.apiKey,
        secret_key: cfg.secretKey
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`BenimPOS yanıtı JSON değil (${response.status})`);
    }

    if (!response.ok) {
      throw new Error(data.message || `BenimPOS HTTP ${response.status}`);
    }
    if (data.status === false) {
      throw new Error(data.message || 'BenimPOS isteği başarısız.');
    }

    return data;
  }

  async function listProductsPage(page = 1, options = {}) {
    return request('products', {
      processType: 'list',
      page,
      ...options
    });
  }

  async function listAllProducts(options = {}, { onPage } = {}) {
    const first = await listProductsPage(1, options);
    const totalPage = Number(first.totalPage) || 1;
    const all = [...(first.data || [])];

    if (onPage) {
      await onPage(1, totalPage, all.length);
    }

    for (let page = 2; page <= totalPage; page += 1) {
      const next = await listProductsPage(page, options);
      all.push(...(next.data || []));
      if (onPage) {
        await onPage(page, totalPage, all.length);
      }
    }

    return {
      products: all,
      totalProductsCount: Number(first.totalProductsCount) || all.length,
      totalPage
    };
  }

  async function listSalesPage(page = 1, dateRange = {}) {
    return request('sales', {
      processType: 'list',
      page,
      ...dateRange
    });
  }

  async function listCategoriesPage(page = 1, options = {}) {
    return request('categories', { processType: 'list', page, ...options });
  }

  async function listPaymentTypesPage(page = 1) {
    return request('paymentTypes', { processType: 'list', page });
  }

  async function listCustomersPage(page = 1, options = {}) {
    return request('customers', { processType: 'list', page, ...options });
  }

  async function listFirmsPage(page = 1) {
    return request('firms', { processType: 'list', page });
  }

  async function healthCheck() {
    const result = await listProductsPage(1);
    return {
      ok: true,
      message: `Bağlantı OK — ${result.totalProductsCount} ürün (${result.totalPage} sayfa)`,
      totalProductsCount: Number(result.totalProductsCount) || 0,
      totalPage: Number(result.totalPage) || 0
    };
  }

  return {
    request,
    listProductsPage,
    listAllProducts,
    listSalesPage,
    listCategoriesPage,
    listPaymentTypesPage,
    listCustomersPage,
    listFirmsPage,
    healthCheck
  };
}

export function mapProductToCostItem(product) {
  const buyingPrice = Number(product?.buyingPrice);
  return {
    barcode: String(product?.barcode || '').trim(),
    productCost: Number.isFinite(buyingPrice) && buyingPrice > 0 ? buyingPrice : 0,
    costVatRate: Number(product?.taxRate) || 20,
    name: String(product?.name || ''),
    quantity: Number(product?.quantity) || 0,
    salePrice1: Number(product?.salePrice1) || 0,
    categoryName: String(product?.categoryName || ''),
    stockCode: String(product?.stockCode || ''),
    updatedDate: String(product?.updatedDate || '')
  };
}
