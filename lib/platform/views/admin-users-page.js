import { renderPetfixShell } from '../../panel/shell/petfix-shell.js';
import { renderOpsInfoDisclosure } from '../../ops-hub/views/info-disclosure.js';

export function renderAdminUsersPage({ authRequired = true, auth = null } = {}) {
  const infoBlocks = [
    renderOpsInfoDisclosure({
      id: 'staffInfoRoles',
      title: 'Roller',
      items: [
        'Toplayıcı (depo): toplama ekranına erişir, siparişleri hazırlar.',
        'Kurye: teslimat ve kurye işlemlerini yürütür.',
        'Süpervizör: depo ve kurye ekibini denetler.'
      ]
    }),
    renderOpsInfoDisclosure({
      id: 'staffInfoMobile',
      title: 'Mobil giriş',
      paragraphs: [
        'Personel, HzlMrktOps mobil uygulamasına kullanıcı adı ve şifre ile giriş yapar.'
      ],
      items: [
        'Şifre sıfırlandığında tüm aktif oturumlar kapatılır.',
        'Pasif hesaplar uygulamaya giriş yapamaz.'
      ]
    })
  ].join('');

  const bodyHtml = `
    <div class="ops-staff-page pf-unified-page">
      <div class="ops-staff-hero">
        <div class="ops-staff-hero-copy">
          <p class="ops-analytics-eyebrow">Yönetim · Personel</p>
          <h1 class="ops-staff-title">Mobil ekip hesapları</h1>
          <p class="ops-staff-lead">Depo, kurye ve süpervizör hesaplarını yönetin. Bu kullanıcılar HzlMrktOps mobil uygulamasına giriş yapar.</p>
          <div class="ops-info-stack">${infoBlocks}</div>
        </div>
        <div class="ops-staff-stats">
          <div class="ops-staff-stat">
            <span class="ops-staff-stat-value" id="staffStatTotal">—</span>
            <span class="ops-staff-stat-label">Toplam personel</span>
          </div>
          <div class="ops-staff-stat">
            <span class="ops-staff-stat-value" id="staffStatActive">—</span>
            <span class="ops-staff-stat-label">Aktif hesap</span>
          </div>
          <div class="ops-staff-stat ops-staff-stat--muted">
            <span class="ops-staff-stat-value ops-staff-stat-value--sm" id="staffStatSessions">—</span>
            <span class="ops-staff-stat-label">Açık oturum</span>
          </div>
        </div>
      </div>

      <section class="ops-alert ops-alert--warn ops-staff-warning hidden" id="staffAcceptWarning" role="status">
        <strong>Otomatik kabul uyarısı</strong>
        <p id="staffAcceptWarningText"></p>
        <p class="ops-staff-warning-link"><a href="/hzlmrktops/integrations">Kanal ayarları → otomatik kabul</a></p>
      </section>

      <section class="ops-panel ops-staff-panel">
        <header class="ops-panel-head ops-panel-head--split">
          <div>
            <h3>Personel listesi</h3>
            <p class="ops-panel-sub">Aktif oturumlar, roller ve hesap durumu</p>
          </div>
        </header>
        <div id="staffList" class="ops-staff-list">Yükleniyor…</div>
      </section>

      <section class="ops-panel ops-staff-panel">
        <header class="ops-panel-head">
          <div>
            <h3>Yeni personel</h3>
            <p class="ops-panel-sub">Mobil uygulama için yeni hesap oluşturun</p>
          </div>
        </header>
        <div class="ops-staff-form-grid">
          <label class="ops-field">
            <span class="ops-field-label">Kullanıcı adı</span>
            <input id="staffUsername" placeholder="depo1" autocomplete="off" spellcheck="false">
          </label>
          <label class="ops-field">
            <span class="ops-field-label">Görünen ad</span>
            <input id="staffDisplayName" placeholder="Depo 1" autocomplete="off">
          </label>
          <label class="ops-field">
            <span class="ops-field-label">Rol</span>
            <select id="staffRole">
              <option value="picker">Toplayıcı (depo)</option>
              <option value="courier">Kurye</option>
              <option value="supervisor">Süpervizör</option>
            </select>
          </label>
          <label class="ops-field">
            <span class="ops-field-label">Şifre</span>
            <input id="staffPassword" type="password" placeholder="En az 4 karakter" autocomplete="new-password">
          </label>
        </div>
        <div class="ops-staff-form-actions">
          <button type="button" id="createStaffBtn" class="ops-btn ops-btn-primary">Personel ekle</button>
        </div>
        <p id="staffFormResult" class="ops-feedback" aria-live="polite"></p>
      </section>
    </div>

    <dialog id="staffResetDialog" class="ops-staff-dialog">
      <form method="dialog" id="staffResetForm" class="ops-staff-dialog-inner">
        <h3 class="ops-staff-dialog-title">Şifre sıfırla</h3>
        <p class="ops-meta" id="staffResetTarget"></p>
        <label class="ops-field">
          <span class="ops-field-label">Yeni şifre</span>
          <input id="staffResetPassword" type="password" autocomplete="new-password" required>
        </label>
        <div class="ops-staff-form-actions">
          <button type="submit" class="ops-btn ops-btn-primary">Kaydet</button>
          <button type="button" class="ops-btn ops-btn-secondary" id="staffResetCancel">İptal</button>
        </div>
        <p id="staffResetResult" class="ops-feedback" aria-live="polite"></p>
      </form>
    </dialog>`;

  return renderPetfixShell({
    title: 'Personel',
    activeModule: 'admin',
    activeItem: 'users',
    bodyClass: 'pf-unified-page',
    auth,
    bootstrapVar: '__ADMIN_USERS__',
    bootstrapData: { authRequired },
    bodyHtml,
    stylesheets: [
      '/assets/ops-tokens.css?v=2',
      '/assets/ops-components.css?v=corp1'
    ],
    scripts: ['/assets/admin-users.js?v=3']
  });
}
