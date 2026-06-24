import { escapeHtml } from '../../platform/views/format.js';

/** Siparişler sayfasındaki kompakt üst şerit — tüm ops sayfalarında ortak. */
export function renderOpsCompactBar({ mainHtml = '', sideHtml = '', className = '' } = {}) {
  const extra = className ? ` ${className}` : '';
  return `<header class="ops-compact-bar ops-order-profit-bar${extra}">
    <div class="ops-compact-bar-main ops-order-profit-bar-main">${mainHtml}</div>
    <div class="ops-compact-bar-side ops-order-profit-bar-side">${sideHtml}</div>
  </header>`;
}

export function renderOpsStatPills(items = []) {
  const pills = items.map((item) => {
    const muted = item.muted ? ' ops-order-profit-count--muted' : '';
    const idAttr = item.id ? ` id="${escapeHtml(item.id)}"` : '';
    const valueClass = item.valueClass ? ` class="${escapeHtml(item.valueClass)}"` : '';
    const value = item.valueHtml != null ? item.valueHtml : escapeHtml(item.value ?? '—');
    const label = escapeHtml(item.label || '');
    return `<span class="ops-order-profit-count${muted}"><strong${idAttr}${valueClass}>${value}</strong> ${label}</span>`;
  }).join('');
  return `<div class="ops-order-profit-counts ops-compact-stat-pills">${pills}</div>`;
}
