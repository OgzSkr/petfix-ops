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
      'partner-app.yemeksepeti.com → Shop Integrations sayfasını açın.',
      'Vendor ID ve Chain ID değerlerini kopyalayıp forma yapıştırın.',
      'Secrets Management → yeni client oluşturun (ör. "petfix") → Client Name + Secret.',
      'Order Webhook Management → aşağıdaki URL ve secret değerlerini yapıştırın.',
      'Bağlantı testi ile OAuth ve katalog erişimini doğrulayın.'
    ]
  },
  getir: {
    id: 'getir',
    label: 'Getir Çarşı',
    gate: 'G3',
    gateNote: 'Credential yok — bölge yöneticisinden PetFix whitelist talep edin',
    portalUrl: 'https://restoran.getir.com/',
    fields: [{ key: 'shopId', label: 'İşletme / Shop ID', type: 'text' }],
    steps: [
      'Getir bölge yöneticinize PetFix entegrasyonu için webhook whitelist talebi gönderin.',
      'Getir panelinden işletme (shop) ID\'nizi alın.',
      'Webhook URL\'yi Getir paneline kaydedin (deploy sonrası aktif olur).',
      'Credential gelene kadar kanal shadow modunda bekler.'
    ],
    prerequisite:
      'Getir entegrasyonu için bölge yöneticinizden PetFix webhook URL onayı gereklidir.'
  }
});

export function getIntegrationChannelMeta(channel) {
  return INTEGRATION_CHANNEL_META[channel] || null;
}

export function listIntegrationChannelMeta() {
  return Object.values(INTEGRATION_CHANNEL_META);
}
