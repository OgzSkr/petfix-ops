const BASE_URL_PROD = 'https://api.mngkargo.com.tr';
const BASE_URL_TEST = 'https://testapi.mngkargo.com.tr';
const TOKEN_PATH = '/mngapi/api/token';
const TOKEN_TTL_MS = 7 * 60 * 60 * 1000;

const FINANCE_DETAIL_PATHS = [
  (id) => `/mngapi/api/financequeryapi/getshipmentinvoicedetaillistByShipmentId/${id}`,
  (id) => `/mngapi/api/financequeryapi/getinvoicedetaillistbyshipmentid/${id}`,
  (id) => `/mngapi/api/financequeryapi/getshipmentinvoicedetaillist/${id}`
];

const TRANSPORT_FEE_PATHS = [
  (id) => `/mngapi/api/standardqueryapi/getshipmenttransportfeeByShipmentId/${id}`,
  (id) => `/mngapi/api/standardqueryapi/calculateshipmenttransportfeeByShipmentId/${id}`
];

const SHIPMENT_INFO_PATHS = [
  (id) => `/mngapi/api/plusqueryapi/getshipmentinformationbybarcode/${id}`,
  (id) => `/mngapi/api/plusqueryapi/getshipmentinformationsbybarcode/${id}`,
  (id) => `/mngapi/api/standardqueryapi/getshipmentinformationByShipmentId/${id}`
];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function unwrapBody(data) {
  if (Array.isArray(data)) {
    return data.length === 1 ? data[0] : data;
  }
  return data;
}

function pickAmount(obj) {
  if (!obj || typeof obj !== 'object') return 0;

  const keys = [
    'amount',
    'totalAmount',
    'transportFee',
    'shippingFee',
    'invoiceAmount',
    'totalPrice',
    'kargoBedeli',
    'tasimaUcreti',
    'shipmentTransportFee',
    'totalTransportFee',
    'netAmount'
  ];

  for (const key of keys) {
    const value = toNumber(obj[key]);
    if (value > 0) return value;
  }

  if (Array.isArray(obj.invoiceDetailList)) {
    let sum = 0;
    for (const row of obj.invoiceDetailList) {
      sum += pickAmount(row);
    }
    if (sum > 0) return sum;
  }

  if (Array.isArray(obj.content)) {
    let sum = 0;
    for (const row of obj.content) {
      sum += pickAmount(row);
    }
    if (sum > 0) return sum;
  }

  return 0;
}

function pickDesi(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  const keys = ['desi', 'desiValue', 'volumeDesi', 'packageDesi', 'totalDesi'];
  for (const key of keys) {
    const value = toNumber(obj[key]);
    if (value > 0) return value;
  }
  return 0;
}

export function isShipmentIdLike(value) {
  const text = String(value || '').trim();
  return text !== '' && /^\d+$/.test(text);
}

export function readDhlConfig(env = {}) {
  return {
    clientId: String(env.DHL_API_CLIENT_ID || '').trim(),
    clientSecret: String(env.DHL_API_CLIENT_SECRET || '').trim(),
    customerNumber: String(env.DHL_CUSTOMER_NUMBER || '').trim(),
    password: String(env.DHL_API_PASSWORD || '').trim(),
    testMode: String(env.DHL_API_ENV || 'PROD').toUpperCase() === 'STAGE'
  };
}

export function isDhlConfigured(env = {}) {
  const cfg = readDhlConfig(env);
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.customerNumber && cfg.password);
}

export function createDhlEcommerceClient(config) {
  const cfg = {
    clientId: String(config.clientId || '').trim(),
    clientSecret: String(config.clientSecret || '').trim(),
    customerNumber: String(config.customerNumber || '').trim(),
    password: String(config.password || '').trim(),
    testMode: Boolean(config.testMode)
  };

  let tokenCache = null;
  let tokenExpiresAt = 0;

  function baseUrl() {
    return cfg.testMode ? BASE_URL_TEST : BASE_URL_PROD;
  }

  async function fetchJwt() {
    if (tokenCache && tokenExpiresAt > Date.now() + 30_000) {
      return tokenCache;
    }

    const response = await fetch(`${baseUrl()}${TOKEN_PATH}`, {
      method: 'POST',
      headers: {
        'X-IBM-Client-Id': cfg.clientId,
        'X-IBM-Client-Secret': cfg.clientSecret,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        customerNumber: cfg.customerNumber,
        password: cfg.password,
        identityType: 1
      })
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`DHL kimlik doğrulama hatası: HTTP ${response.status} - ${text.slice(0, 300)}`);
    }

    const data = text ? JSON.parse(text) : {};
    const jwt = String(data.jwt || '').trim();
    if (!jwt) {
      throw new Error('DHL kimlik doğrulama yanıtında JWT yok.');
    }

    tokenCache = jwt;
    tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    return jwt;
  }

  async function request(path, { method = 'GET', body = null } = {}) {
    const jwt = await fetchJwt();
    const headers = {
      'X-IBM-Client-Id': cfg.clientId,
      'X-IBM-Client-Secret': cfg.clientSecret,
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/json'
    };

    let payload = null;
    if (body != null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: payload
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: unwrapBody(data),
      raw: text
    };
  }

  async function tryPaths(paths, trackingId) {
    const id = encodeURIComponent(String(trackingId || '').trim());
    if (!id) return null;

    let lastError = null;
    for (const buildPath of paths) {
      try {
        const result = await request(buildPath(id));
        if (result.ok && result.data != null) {
          return result;
        }
        if (result.status === 404) continue;
        lastError = new Error(`HTTP ${result.status}`);
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;
    return null;
  }

  async function getShipmentStatus(trackingId) {
    const id = String(trackingId || '').trim();
    const suffix = isShipmentIdLike(id) ? 'ByShipmentId' : '';
    const path = `/mngapi/api/standardqueryapi/getshipmentstatus${suffix}/${encodeURIComponent(id)}`;
    const result = await request(path);
    if (!result.ok) {
      throw new Error(`DHL gönderi durumu alınamadı: HTTP ${result.status}`);
    }
    return result.data;
  }

  async function resolveShipmentCost(trackingId) {
    const id = String(trackingId || '').trim();
    if (!id) {
      return { ok: false, reason: 'missing_tracking' };
    }

    let status = null;
    try {
      status = await getShipmentStatus(id);
    } catch {
      status = null;
    }

    for (const buildPath of FINANCE_DETAIL_PATHS) {
      try {
        const result = await request(buildPath(encodeURIComponent(id)));
        if (!result.ok || result.data == null) continue;
        const amount = pickAmount(result.data);
        if (amount > 0) {
          return {
            ok: true,
            amount,
            desi: pickDesi(result.data),
            source: 'invoiced',
            direction: 'outbound',
            status,
            raw: result.data
          };
        }
      } catch {
        /* sonraki endpoint */
      }
    }

    for (const buildPath of TRANSPORT_FEE_PATHS) {
      try {
        const result = await request(buildPath(encodeURIComponent(id)));
        if (!result.ok || result.data == null) continue;
        const amount = pickAmount(result.data);
        if (amount > 0) {
          return {
            ok: true,
            amount,
            desi: pickDesi(result.data),
            source: 'calculated',
            direction: 'outbound',
            status,
            raw: result.data
          };
        }
      } catch {
        /* sonraki endpoint */
      }
    }

    for (const buildPath of SHIPMENT_INFO_PATHS) {
      try {
        const result = await request(buildPath(encodeURIComponent(id)));
        if (!result.ok || result.data == null) continue;
        const amount = pickAmount(result.data);
        if (amount > 0) {
          return {
            ok: true,
            amount,
            desi: pickDesi(result.data),
            source: 'info',
            direction: 'outbound',
            status,
            raw: result.data
          };
        }
      } catch {
        /* sonraki endpoint */
      }
    }

    return {
      ok: false,
      reason: 'not_invoiced_yet',
      status
    };
  }

  async function healthCheck() {
    if (!cfg.clientId || !cfg.clientSecret || !cfg.customerNumber || !cfg.password) {
      return {
        ok: false,
        message: 'DHL API bilgileri eksik (Client ID, Secret, Müşteri No, Şifre).'
      };
    }

    try {
      await fetchJwt();
      return {
        ok: true,
        message: `DHL eCommerce API bağlantısı başarılı (${cfg.testMode ? 'STAGE' : 'PROD'}).`
      };
    } catch (error) {
      return {
        ok: false,
        message: error.message || 'DHL API bağlantısı başarısız.'
      };
    }
  }

  return {
    config: cfg,
    fetchJwt,
    getShipmentStatus,
    resolveShipmentCost,
    healthCheck
  };
}
