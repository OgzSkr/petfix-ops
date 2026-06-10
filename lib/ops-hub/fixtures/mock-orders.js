export const MOCK_TGO_ORDER = {
  channel: 'trendyol_go',
  externalId: 'mock-tgo-pkg-1001',
  displayId: '10654321001',
  channelStatus: 'Created',
  channelIntegrationMode: 'direct',
  deliveryMode: 'platform_courier',
  customer: {
    name: 'Test Musteri',
    phone: '5320001122'
  },
  rawPayload: {
    source: 'mock',
    packageId: 'mock-tgo-pkg-1001',
    storeId: '223508'
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
  channelStatus: 'RECEIVED',
  channelIntegrationMode: 'direct',
  deliveryMode: 'own_courier',
  customer: {
    name: 'YS Musteri',
    phone: '5331112233'
  },
  rawPayload: { source: 'mock', vendorId: 'jk2w' },
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
  displayId: 'G-3001',
  channelStatus: 'pending',
  channelIntegrationMode: 'direct',
  deliveryMode: 'platform_courier',
  customer: {
    name: 'Getir Musteri',
    phone: '5342223344'
  },
  rawPayload: { source: 'mock', shopId: 'pending' },
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
