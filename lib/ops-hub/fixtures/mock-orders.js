/** Uber santral test hattı — gerçek relay senaryosu. */
const UBER_RELAY_PHONE = '02123653403';
const UBER_RELAY_ORDER_NUMBER = '11334556904';

export const MOCK_TGO_ORDER = {
  channel: 'trendyol_go',
  externalId: 'mock-tgo-pkg-1001',
  displayId: UBER_RELAY_ORDER_NUMBER,
  status: 'received',
  channelStatus: 'Created',
  channelIntegrationMode: 'direct',
  deliveryMode: 'platform_courier',
  customer: {
    name: 'Test Musteri',
    phone: UBER_RELAY_PHONE
  },
  rawPayload: {
    source: 'mock',
    orderNumber: UBER_RELAY_ORDER_NUMBER,
    packageId: 'mock-tgo-pkg-1001',
    storeId: '223508',
    payment: { method: 'Online' },
    shipmentAddress: {
      phone: UBER_RELAY_PHONE,
      firstName: 'Test',
      lastName: 'Musteri',
      addressDescription: 'Mock teslimat adresi',
      district: 'Zeytinburnu',
      city: 'Istanbul'
    },
    customer: {
      name: 'Test Musteri',
      phone: UBER_RELAY_PHONE
    }
  },
  lines: [
    {
      channelProductId: '2742-sku-a',
      barcode: '8690637037428',
      title: 'Mock Urun A',
      quantity: 2,
      unitPrice: 49.9,
      matchingStatus: 'matched'
    },
    {
      channelProductId: '2742-sku-b',
      barcode: null,
      title: 'Eslesmemis Urun',
      quantity: 1,
      unitPrice: 19.5,
      matchingStatus: 'unmapped'
    }
  ]
};

export const MOCK_YS_ORDER = {
  channel: 'yemeksepeti',
  externalId: 'mock-ys-ord-2001',
  displayId: 'YS-2001',
  status: 'received',
  channelStatus: 'RECEIVED',
  channelIntegrationMode: 'direct',
  deliveryMode: 'own_courier',
  customer: {
    name: 'YS Musteri',
    phone: '5331112233',
    address: 'Moda Mah. Test Sok. No:5 Kadikoy / Istanbul'
  },
  rawPayload: {
    source: 'mock',
    vendorId: 'jk2w',
    order_code: 'YS-2001',
    payment: { method: 'online' },
    yemeksepetiOrder: {
      customer: {
        name: 'YS Musteri',
        phone: '5331112233'
      },
      delivery: {
        address: 'Moda Mah. Test Sok. No:5 Kadikoy / Istanbul',
        note: 'Kapi zili calismiyor'
      }
    }
  },
  lines: [
    {
      channelProductId: 'ys-sku-1',
      barcode: '8690001112223',
      title: 'YS Mock Urun',
      quantity: 1,
      unitPrice: 35,
      matchingStatus: 'matched'
    }
  ]
};

export const MOCK_GETIR_ORDER = {
  channel: 'getir',
  externalId: 'mock-getir-3001',
  displayId: 'p3001',
  status: 'received',
  channelStatus: 'pending',
  channelIntegrationMode: 'direct',
  deliveryMode: 'platform_courier',
  customer: {
    name: 'Getir Musteri',
    phone: '08501234567',
    address: 'Cevizlibag Mah. Mock Sok. No:3 Istanbul'
  },
  rawPayload: {
    source: 'mock',
    shopId: 'pending',
    confirmationId: 'p3001',
    paymentMethod: 1,
    client: {
      name: 'Getir Musteri',
      phone: '08501234567'
    },
    clientNote: 'Kapida bekleyin'
  },
  lines: [
    {
      channelProductId: 'getir-prod-1',
      barcode: '8690003334445',
      title: 'Getir Mock',
      quantity: 3,
      unitPrice: 12.5,
      matchingStatus: 'blocked'
    }
  ]
};

export function listMockOrders() {
  return [MOCK_TGO_ORDER, MOCK_YS_ORDER, MOCK_GETIR_ORDER];
}

export function mockOrderByKey(key) {
  const map = {
    tgo: MOCK_TGO_ORDER,
    ys: MOCK_YS_ORDER,
    getir: MOCK_GETIR_ORDER
  };
  return map[key] ? structuredClone(map[key]) : null;
}
