export const INTEGRATION_CHANNEL_META = Object.freeze({
  trendyol_go: {
    id: 'trendyol_go',
    label: 'Trendyol Go Market',
    gate: 'G1',
    gateNote: 'Sipariş okuma PARTIAL; stok push G2 FAIL',
    portalUrl: 'https://partner.trendyol.com/',
    fields: [
      { key: 'sellerId', label: 'Satıcı ID', type: 'text', placeholder: '862084' },
      { key: 'apiKey', label: 'API Key', type: 'password' },
      { key: 'apiSecret', label: 'API Secret', type: 'password' },
      { key: 'storeId', label: 'Şube / Mağaza ID', type: 'text', placeholder: '223508' }
    ],
    steps: [
      'Trendyol Satıcı Paneli → Entegrasyonlar → API bilgilerinizi oluşturun.',
      'Satıcı ID, API Key ve API Secret değerlerini kopyalayın.',
      'Trendyol Go Market mağaza/şube ID\'sini (storeId) girin.',
      'Bağlantı testi ile grocery packages okumasını doğrulayın.',
      'Stok push şu an G2 kapısı nedeniyle simülasyon modunda kalır.'
    ]
  },
  yemeksepeti: {
    id: 'yemeksepeti',
    label: 'Yemeksepeti Mahalle',
    gate: 'G4',
    gateNote: 'OAuth + katalog OK; webhook için public URL gerekli',
    portalUrl: 'https://partner-app.yemeksepeti.com/',
    fields: [
      { key: 'clientId', label: 'Client Name (OAuth)', type: 'text' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password' },
      { key: 'vendorId', label: 'Vendor ID', type: 'text' },
      { key: 'chainId', label: 'Chain ID', type: 'text' },
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'password' }
    ],
    steps: [
      'partner-app.yemeksepeti.com → Shop Integrations → Vendor ID (jk2w) ve adres çubuğundaki Chain ID.',
      'Ayarlar → API → Secrets Management: tek client (BuyBox veya petfix) — Client Name + Secret.',
      'Order Webhook Management → Siparis Webhook Ayarlari: PetFix sipariş URL + Basic secret, Kaydet.',
      'Aynı API ekranı → Ürün Güncelleme API - Webhook Ayarları: katalog callback URL + aynı secret.',
      'Test Siparisi Ver → Recent Deliveries\'te HTTP 201 olmalı (Direct Order için YS destek gerekebilir).',
      'PetFix panel → Entegrasyonlar: aynı 4 alan + bağlantı testi.'
    ],
    portalWebhook: {
      urlEnv: 'OPS_PUBLIC_API_BASE_URL',
      path: '/webhooks/v1/yemeksepeti/orders',
      basicUsername: 'petfix',
      secretEnv: 'YEMEKSEPETI_WEBHOOK_SECRET'
    },
    portalCatalogWebhook: {
      urlEnv: 'OPS_PUBLIC_API_BASE_URL',
      path: '/webhooks/v1/yemeksepeti/catalog',
      basicUsername: 'petfix',
      secretEnv: 'YEMEKSEPETI_WEBHOOK_SECRET',
      portalButton: 'Ürün Guncelleme API- Webhook Ayarları'
    }
  },
  getir: {
    id: 'getir',
    label: 'Getir Çarşı',
    gate: null,
    gateNote: 'API kullanıcı adı ve şifre Getir entegrasyon ekibinden gelir',
    portalUrl: 'https://panel-fe.artisandev.getirapi.com/login',
    fields: [
      { key: 'shopId', label: 'Shop ID (işletme)', type: 'text' },
      { key: 'apiBaseUrl', label: 'API base URL (dokümandan)', type: 'text' },
      { key: 'apiUsername', label: 'API kullanıcı adı', type: 'text' },
      { key: 'apiPassword', label: 'API şifresi', type: 'password' },
      { key: 'webhookSecret', label: 'x-api-key (webhook)', type: 'password' }
    ],
    steps: [
      'Getir’den gelen Shop ID, API kullanıcı adı ve şifreyi kaydedin.',
      'Dokümandaki API base URL’i (GETIR_API_BASE_URL) girin.',
      'İki webhook URL + x-api-key değerini Getir başvuru formuna iletin (getirçarşıapi cc).',
      'Bağlantı testi: /v1/orders/unapproved ve /v1/orders/cancelled erişimini doğrular.',
      'Canlı siparişler webhook ile; yedek olarak API poll eklenecek.'
    ],
    prerequisite:
      'Getir yanıt mailindeki doküman linkinden API base URL’i alın; panel şifresi için şifre sıfırlama linkini kullanın.'
  }
});

export function getIntegrationChannelMeta(channel) {
  return INTEGRATION_CHANNEL_META[channel] || null;
}

export function listIntegrationChannelMeta() {
  return Object.values(INTEGRATION_CHANNEL_META);
}
