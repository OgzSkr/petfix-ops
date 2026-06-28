import { HZLMRKTOPS_BASE, HZLMRKTOPS_ORDER_PROFIT_REPORT } from '../../hzlmrktops/constants.js';

const REPORT_SECTION_TABS = [
  { id: 'order-profit', label: 'Sipariş Kârlılık Raporu', href: HZLMRKTOPS_ORDER_PROFIT_REPORT },
  { id: 'overview', label: 'Genel Özet', href: `${HZLMRKTOPS_BASE}/raporlar` }
];

export function renderReportsSectionNav(activeId) {
  const tabs = REPORT_SECTION_TABS.map((tab) => {
    const active = tab.id === activeId ? ' active' : '';
    const selected = tab.id === activeId ? 'true' : 'false';
    const ariaCurrent = tab.id === activeId ? ' aria-current="page"' : '';
    return `<a class="orders-subnav-tab ops-reports-section-tab${active}" href="${tab.href}" role="tab" aria-selected="${selected}"${ariaCurrent}>${tab.label}</a>`;
  }).join('');
  return `<nav class="orders-subnav ops-reports-section-nav" role="tablist" aria-label="Rapor türü">${tabs}</nav>`;
}
