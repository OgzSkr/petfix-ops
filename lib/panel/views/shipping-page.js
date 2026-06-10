import { escapeHtml, jsonForHtml } from '../../platform/views/format.js';
import { wrapPanelPage } from '../shell/wrap-panel-page.js';
import { renderMarketplaceSubNav } from '../shell/marketplace-nav.js';
import { CARGO_BY_DESI, SERVICE_FEE } from '../../profit-constants.js';

function renderDesiTableRows() {
  return Object.entries(CARGO_BY_DESI)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([desi, fee]) => {
      return `<tr>
        <td>${escapeHtml(String(desi))} desi</td>
        <td><strong>₺${escapeHtml(fee.toFixed(2))}</strong></td>
      </tr>`;
    })
    .join('');
}

/**
 * Trendyol Pazaryeri kargo maliyetleri — desi tarifesi + DHL entegrasyon durumu.
 */
export function renderShippingPage({ auth } = {}) {
  const bootstrap = jsonForHtml({ authRequired: Boolean(auth?.isEnabled?.()) });
  const desiCount = Object.keys(CARGO_BY_DESI).length;

  const innerHtml = `
      ${renderMarketplaceSubNav('shipping')}
      <header class="pf-page-header">
        <div>
          <p class="pf-page-eyebrow">Pazaryeri &amp; Buybox</p>
          <h1>Kargo Maliyetleri</h1>
          <p class="pf-page-lead">
            Satıcı anlaşmalı kargo (whoPays=1) için Trendyol fatura bedeli kullanılmaz.
            Desi tablosu ve DHL eCommerce maliyetleri sipariş kârlılığı hesabına girer.
            Ürün desi değerleri <a href="/marketplace/products">Ürün Ayarları</a> sayfasından yönetilir.
          </p>
        </div>
        <div class="pf-page-actions">
          <a class="pf-btn pf-btn-ghost-sm" href="/admin/settings">DHL API Ayarları</a>
          <a class="pf-btn pf-btn-primary-sm" href="/marketplace/products">Ürün Desi Tablosu</a>
        </div>
      </header>

      <div class="pf-kpi-grid" id="shippingKpi" aria-live="polite">
        <article class="pf-kpi-card">
          <span class="pf-kpi-label">Desi kademesi</span>
          <strong class="pf-kpi-value">${desiCount}</strong>
          <span class="pf-kpi-trend pf-kpi-trend--warn">1–25 desi tarifesi</span>
        </article>
        <article class="pf-kpi-card">
          <span class="pf-kpi-label">Hizmet bedeli (sabit)</span>
          <strong class="pf-kpi-value">₺${escapeHtml(SERVICE_FEE.toFixed(2))}</strong>
          <span class="pf-kpi-trend">Sipariş başına</span>
        </article>
        <article class="pf-kpi-card" id="dhlKpiCard">
          <span class="pf-kpi-label">DHL eCommerce</span>
          <strong class="pf-kpi-value" id="dhlKpiValue">—</strong>
          <span class="pf-kpi-trend" id="dhlKpiHint">Durum yükleniyor…</span>
        </article>
        <article class="pf-kpi-card pf-kpi-card--link" data-href="/marketplace/orders">
          <span class="pf-kpi-label">Sipariş kârlılığı</span>
          <strong class="pf-kpi-value">→</strong>
          <span class="pf-kpi-trend">Kargo satır detayı</span>
        </article>
      </div>

      <div class="pf-shipping-grid">
        <section class="pf-panel">
          <div class="pf-panel-head">
            <div>
              <h2>Desi → Kargo ücreti tablosu</h2>
              <p class="pf-page-lead">DHL maliyeti netleşmeden önce paket desisine göre tahmin kullanılır.</p>
            </div>
          </div>
          <div class="pf-panel-body">
            <div class="pf-table-wrap">
              <table class="pf-table pf-desi-table">
                <thead>
                  <tr>
                    <th>Desi</th>
                    <th>Kargo bedeli (KDV dahil)</th>
                  </tr>
                </thead>
                <tbody>${renderDesiTableRows()}</tbody>
              </table>
            </div>
          </div>
        </section>

        <section class="pf-panel">
          <div class="pf-panel-head">
            <div>
              <h2>DHL eCommerce (MNG Kargo)</h2>
              <p class="pf-page-lead">
                Trendyol <code>cargoTrackingNumber</code> → DHL gönderi eşleştirmesi ile gerçek maliyet çekilir.
                Fatura kesilmeden önce desi tahmini geçerlidir.
              </p>
            </div>
          </div>
          <div class="pf-panel-body">
            <div id="dhlStatusPanel" class="pf-status-panel" aria-live="polite">
              <p class="muted">DHL bağlantı durumu kontrol ediliyor…</p>
            </div>
            <div class="pf-page-actions pf-shipping-actions">
              <a class="pf-btn pf-btn-primary-sm" href="/admin/settings">API bilgilerini düzenle</a>
              <a class="pf-btn pf-btn-ghost-sm" href="https://apizone.mngkargo.com.tr/tr/product" target="_blank" rel="noopener">MNG API dokümantasyonu</a>
            </div>
          </div>
        </section>
      </div>

      <section class="pf-panel pf-module-banner-wrap">
        <div class="pf-panel-body">
          <p class="pf-module-banner">
            Uber Eats, Yemeksepeti ve WooCommerce kargo maliyetleri bu tablodan bağımsızdır —
            kanal sipariş kârlılığı <a href="/products/costs">Diğer Kanal Maliyetleri</a> setini kullanır.
          </p>
        </div>
      </section>
      <script id="bootstrap" type="application/json">${bootstrap}</script>`;

  return wrapPanelPage({
    title: 'Kargo Maliyetleri',
    activeModule: 'marketplace',
    activeItem: 'shipping',
    auth,
    bodyClass: 'pf-shipping-page pf-marketplace-page',
    bodyHtml: innerHtml,
    stylesheets: ['/assets/styles.css'],
    scripts: ['/assets/shipping.js?v=1']
  });
}
