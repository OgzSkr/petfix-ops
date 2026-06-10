'use strict';
/**
 * Kanal logo bileşenleri — lib/panel/components/channel-visuals.js ile senkron tutun.
 */
(function initChannelLogos() {
  const VISUALS = {
    benimpos: { label: 'BenimPOS', shortLabel: 'BenimPOS', color: '#1e6fd9', accent: '#fff', icon: 'pos', image: '/assets/channels/benimpos.png', imageFit: 'contain' },
    'trendyol-marketplace': { label: 'Trendyol Pazaryeri', shortLabel: 'Trendyol', color: '#f27a1a', accent: '#fff', icon: 'trendyol', image: '/assets/channels/trendyol-marketplace.png' },
    'trendyol-go': { label: 'Trendyol Go', shortLabel: 'Trendyol GO', color: '#f27a1a', accent: '#fff', icon: 'tgo', image: '/assets/channels/trendyol-go.png' },
    'uber-eats': { label: 'Trendyol Go', shortLabel: 'TGO', color: '#f27a1a', accent: '#fff', icon: 'tgo', image: '/assets/channels/trendyol-go.png' },
    getir: { label: 'Getir Çarşı', shortLabel: 'Getir', color: '#5d3ebc', accent: '#ffd10d', icon: 'getir', image: '/assets/channels/getir-carsi.png' },
    yemeksepeti: { label: 'Yemeksepeti Mahalle', shortLabel: 'Mahalle', color: '#fa0050', accent: '#fff', icon: 'ys', image: '/assets/channels/yemeksepeti-mahalle.png' },
    woocommerce: { label: 'WooCommerce', shortLabel: 'Woo', color: '#7f54b3', accent: '#fff', icon: 'woo', image: '/assets/channels/woocommerce.png', imageFit: 'contain' }
  };

  function escAttr(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function escHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function svgIcon(kind) {
    const icons = {
      trendyol: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 18V6h3.2l4.1 7.2L15.4 6H18v12h-2.6V10.1l-3.8 6.6h-1.2L6.6 10.1V18H4z"/></svg>',
      tgo: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M5 17l2.5-9h2.3l1.4 5.4L12.6 8h2.2l2.5 9h-2.4l-.9-3.6-.9 3.6H9.8l-.9-3.6-.9 3.6H5z"/></svg>',
      getir: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor" opacity=".25"/><path fill="currentColor" d="M12 6a6 6 0 100 12 6 6 0 000-12z"/></svg>',
      ys: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 7h12v2.2H6V7zm0 4.4h8.6v2.2H6v-2.2zm0 4.4h10.4V18H6v-2.2z"/></svg>',
      woo: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 5c3.1 0 5.6 2.2 6.2 5.2L16.4 16c-.2 1-1 1.6-2 1.6H9.6c-1 0-1.8-.6-2-1.6L5.8 10.2C6.4 7.2 8.9 5 12 5z"/></svg>',
      pos: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="currentColor" d="M8 10h8v1.6H8V10zm0 3h5.2v1.6H8V13z"/></svg>'
    };
    return icons[kind] || icons.pos;
  }

  function getVisual(channelId) {
    return VISUALS[channelId] || { label: channelId, shortLabel: channelId, color: '#64748b', accent: '#fff', icon: 'pos' };
  }

  function render(channelId, opts = {}) {
    const visual = getVisual(channelId);
    const size = opts.size || 'sm';
    const state = opts.state ? ` pf-channel-logo--${opts.state}` : '';
    const title = escAttr(opts.title || visual.label);

    if (visual.image) {
      const sizeClass = size === 'lg' ? ' pf-channel-logo--lg' : size === 'md' ? ' pf-channel-logo--md' : ' pf-channel-logo--sm';
      const fitClass = visual.imageFit === 'contain' ? ' pf-channel-logo--contain' : '';
      return `<span class="pf-channel-logo pf-channel-logo--image pf-channel-logo--circle${sizeClass}${fitClass}${state}" title="${title}" data-channel="${escAttr(channelId)}"><img src="${escAttr(visual.image)}" alt="" width="28" height="28" loading="lazy" decoding="async"></span>`;
    }

    return `<span class="pf-channel-logo pf-channel-logo--${size}${state}" style="--pf-channel-color:${visual.color};--pf-channel-accent:${visual.accent}" title="${title}" data-channel="${escAttr(channelId)}"><span class="pf-channel-logo-icon">${svgIcon(visual.icon)}</span></span>`;
  }

  function renderRow(channelIds, opts = {}) {
    if (!channelIds?.length) return '<span class="pf-channel-logo-row pf-channel-logo-row--empty">—</span>';
    return `<span class="pf-channel-logo-row">${channelIds.map((id) => render(id, opts)).join('')}</span>`;
  }

  function renderTab(channelId, opts = {}) {
    const visual = getVisual(channelId);
    const label = escHtml(opts.label || visual.shortLabel || visual.label);
    const soon = opts.soon ? ' <span class="matching-tab-soon">yakında</span>' : '';
    return `${render(channelId, { size: opts.size || 'sm', state: opts.state })}<span class="pf-channel-tab-label">${label}</span>${soon}`;
  }

  function renderWithLabel(channelId, opts = {}) {
    const visual = getVisual(channelId);
    const label = escHtml(opts.label || visual.shortLabel || visual.label);
    return `<span class="pf-channel-label">${render(channelId, opts)}<span>${label}</span></span>`;
  }

  window.PetFixChannelLogos = {
    render,
    renderRow,
    renderTab,
    renderWithLabel,
    getVisual,
    VISUALS
  };
})();
