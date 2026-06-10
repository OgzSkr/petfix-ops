import { getChannelVisual } from './channel-visuals.js';

function svgIcon(kind) {
  switch (kind) {
    case 'trendyol':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 18V6h3.2l4.1 7.2L15.4 6H18v12h-2.6V10.1l-3.8 6.6h-1.2L6.6 10.1V18H4z"/></svg>';
    case 'tgo':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 17l2.5-9h2.3l1.4 5.4L12.6 8h2.2l2.5 9h-2.4l-.9-3.6-.9 3.6H9.8l-.9-3.6-.9 3.6H5zm8.8-9h6.2v1.8h-2v7.2h-2.2V9.8h-2V8z"/></svg>';
    case 'getir':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="currentColor" opacity=".25"/><path fill="currentColor" d="M12 6a6 6 0 100 12 6 6 0 000-12zm0 2.2a3.8 3.8 0 110 7.6 3.8 3.8 0 010-7.6z"/></svg>';
    case 'ys':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 7h12v2.2H6V7zm0 4.4h8.6v2.2H6v-2.2zm0 4.4h10.4V18H6v-2.2z"/></svg>';
    case 'woo':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 8.5c0-1.2.8-2 2-2.2l1.2 6.8c-.8-.2-1.4-.9-1.4-1.8V8.5zm16 0c0 1-.6 1.6-1.4 1.8L19.8 6c1.2.2 2 1 2 2.5zM12 5c3.1 0 5.6 2.2 6.2 5.2l-1.8 10.2c-.2 1-1 1.6-2 1.6H9.6c-1 0-1.8-.6-2-1.6L5.8 10.2C6.4 7.2 8.9 5 12 5z"/></svg>';
    case 'pos':
    default:
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="currentColor" d="M8 10h8v1.6H8V10zm0 3h5.2v1.6H8V13z"/></svg>';
  }
}

function escAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * @param {string} channelId
 * @param {{ size?: 'sm'|'md'|'lg', state?: string, title?: string, showLabel?: boolean }} [opts]
 */
export function renderChannelLogo(channelId, opts = {}) {
  const visual = getChannelVisual(channelId);
  const size = opts.size || 'sm';
  const state = opts.state ? ` pf-channel-logo--${opts.state}` : '';
  const title = opts.title || visual.label;
  const safeTitle = escAttr(title);

  if (visual.image) {
    const imgClass = size === 'lg' ? ' pf-channel-logo--lg' : size === 'md' ? ' pf-channel-logo--md' : ' pf-channel-logo--sm';
    const fitClass = visual.imageFit === 'contain' ? ' pf-channel-logo--contain' : '';
    return `<span class="pf-channel-logo pf-channel-logo--image pf-channel-logo--circle${imgClass}${fitClass}${state}" title="${safeTitle}" data-channel="${escAttr(channelId)}">
      <img src="${escAttr(visual.image)}" alt="" width="28" height="28" loading="lazy" decoding="async">
    </span>`;
  }

  return `<span class="pf-channel-logo pf-channel-logo--${size}${state}" style="--pf-channel-color:${visual.color};--pf-channel-accent:${visual.accent}" title="${safeTitle}" data-channel="${escAttr(channelId)}">
    <span class="pf-channel-logo-icon">${svgIcon(visual.icon)}</span>
  </span>`;
}

export function renderChannelLogoRow(channelIds, opts = {}) {
  const ids = Array.isArray(channelIds) ? channelIds : [];
  if (!ids.length) return '<span class="pf-channel-logo-row pf-channel-logo-row--empty">—</span>';
  return `<span class="pf-channel-logo-row">${ids.map((id) => renderChannelLogo(id, opts)).join('')}</span>`;
}

/** Sekme içeriği (logo + kısa etiket) */
export function renderChannelTabContent(channelId, opts = {}) {
  const visual = getChannelVisual(channelId);
  const label = opts.label || visual.shortLabel || visual.label;
  const logo = renderChannelLogo(channelId, { size: opts.size || 'sm', state: opts.state });
  const soon = opts.soon ? ' <span class="matching-tab-soon">yakında</span>' : '';
  return `${logo}<span class="pf-channel-tab-label">${label}</span>${soon}`;
}

/** Kanal logo şeridi — mockup tarzı büyük ikonlar */
export function renderChannelStripItem(channelId, { label, active = false, planned = false } = {}) {
  const visual = getChannelVisual(channelId || 'benimpos');
  const displayLabel = label || visual.shortLabel || visual.label;
  const logoId = channelId || 'benimpos';
  const plannedClass = planned ? ' is-planned' : '';
  const activeClass = active ? ' active' : '';
  const title = channelId
    ? `${visual.label} · tekrar tıkla: katalog`
    : 'Tüm kanallar';
  return `<button type="button" class="matching-channel-strip-item${activeClass}${plannedClass}" data-channel="${escAttr(channelId)}" title="${escAttr(title)}">
    ${renderChannelLogo(logoId, { size: 'lg' })}
    <span class="matching-channel-strip-label">${escAttr(displayLabel)}</span>
  </button>`;
}

export function renderMatchingChannelStrip(salesChannels = []) {
  const items = [
    renderChannelStripItem('', { label: 'Tümü', active: true })
  ];
  for (const channel of salesChannels) {
    items.push(renderChannelStripItem(channel.id, {
      label: channel.id === 'uber-eats' ? 'TGO' : undefined,
      planned: channel.status === 'planned'
    }));
  }
  return items.join('');
}

export { getChannelVisual };
