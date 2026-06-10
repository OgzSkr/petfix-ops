/**
 * Kanal görsel tanımları — sunucu ve istemci ile paylaşılır.
 * image: gerçek marka logosu; yoksa SVG ikon fallback kullanılır.
 */
export const CHANNEL_VISUALS = Object.freeze({
  benimpos: {
    label: 'BenimPOS',
    shortLabel: 'BenimPOS',
    color: '#1e6fd9',
    accent: '#ffffff',
    icon: 'pos',
    image: '/assets/channels/benimpos.png',
    imageFit: 'contain'
  },
  'trendyol-marketplace': {
    label: 'Trendyol Pazaryeri',
    shortLabel: 'Trendyol',
    color: '#f27a1a',
    accent: '#ffffff',
    icon: 'trendyol',
    image: '/assets/channels/trendyol-marketplace.png'
  },
  'trendyol-go': {
    label: 'Trendyol Go',
    shortLabel: 'Trendyol GO',
    color: '#f27a1a',
    accent: '#ffffff',
    icon: 'tgo',
    image: '/assets/channels/trendyol-go.png'
  },
  'uber-eats': {
    label: 'Trendyol Go',
    shortLabel: 'TGO',
    color: '#f27a1a',
    accent: '#ffffff',
    icon: 'tgo',
    image: '/assets/channels/trendyol-go.png'
  },
  getir: {
    label: 'Getir Çarşı',
    shortLabel: 'Getir',
    color: '#5d3ebc',
    accent: '#ffd10d',
    icon: 'getir',
    image: '/assets/channels/getir-carsi.png'
  },
  yemeksepeti: {
    label: 'Yemeksepeti Mahalle',
    shortLabel: 'Mahalle',
    color: '#fa0050',
    accent: '#ffffff',
    icon: 'ys',
    image: '/assets/channels/yemeksepeti-mahalle.png'
  },
  woocommerce: {
    label: 'WooCommerce',
    shortLabel: 'Woo',
    color: '#7f54b3',
    accent: '#ffffff',
    icon: 'woo',
    image: '/assets/channels/woocommerce.png',
    imageFit: 'contain'
  }
});

export function getChannelVisual(channelId) {
  return CHANNEL_VISUALS[channelId] || {
    label: channelId,
    shortLabel: channelId,
    color: '#64748b',
    accent: '#ffffff',
    icon: 'pos'
  };
}
