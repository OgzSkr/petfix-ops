export const YS_WEBHOOK_ORDER_FIXTURE = {
  order: {
    order_id: 'ys-wh-9001',
    order_code: 'YS-9001',
    status: 'RECEIVED',
    vendor_id: 'jk2w',
    chain_id: 'chain-1',
    sys: { created_at: '2026-06-09T10:15:00Z' },
    customer: {
      name: 'Webhook Musteri',
      phone: '5329998877'
    },
    delivery: {
      provider: 'platform_courier',
      address: { formatted: 'Kadikoy / Istanbul' }
    },
    items: [
      {
        sku: '2662ZF',
        barcode: ['8690001112223'],
        name: 'Test Urun',
        pricing: { quantity: 2, unit_price: 35.5 }
      }
    ]
  }
};

export const YS_WEBHOOK_CANCEL_FIXTURE = {
  order: {
    order_id: 'ys-wh-9001',
    order_code: 'YS-9001',
    status: 'CANCELLED',
    items: [
      {
        sku: '2662ZF',
        barcode: ['8690001112223'],
        name: 'Test Urun',
        pricing: { quantity: 2, unit_price: 35.5 }
      }
    ]
  }
};
