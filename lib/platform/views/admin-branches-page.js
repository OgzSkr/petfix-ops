import { renderPetfixShell } from '../../panel/shell/petfix-shell.js';
import { renderOpsInfoDisclosure } from '../../ops-hub/views/info-disclosure.js';
import { renderOpsCompactBar, renderOpsStatPills } from '../../ops-hub/views/compact-page-bar.js';

export function renderAdminBranchesPage({ authRequired = true, auth = null } = {}) {
  const infoBlocks = [
    renderOpsInfoDisclosure({
      id: 'branchInfoScope',
      title: 'Şube kapsamı',
      items: [
        'Her şubenin kendi kanal API bilgileri ve sipariş havuzu vardır.',
        'Sol alttaki şube seçici aktif şubeyi belirler.',
        'Webhook URL’leri şube slug’ına göre oluşturulur.'
      ]
    }),
    renderOpsInfoDisclosure({
      id: 'branchInfoRbac',
      title: 'RBAC yetkileri',
      paragraphs: [
        'Grant kayıtları hangi subject key’in hangi şubede hangi rolle çalışacağını tanımlar.'
      ],
      items: [
        'admin: tam erişim · operator: operasyon · viewer: salt okunur',
        'Platform token varsayılan olarak tüm şubelere admin erişimi alır.'
      ]
    })
  ].join('');

  const bar = renderOpsCompactBar({
    sideHtml: `${renderOpsStatPills([
      { id: 'branchStatTotal', label: 'şube' },
      { id: 'branchStatActive', label: 'aktif' },
      { id: 'branchStatGrants', label: 'grant', muted: true, valueClass: 'ops-compact-stat-value--sm' }
    ])}${infoBlocks}`
  });

  const bodyHtml = `
    <div class="ops-branches-page ops-compact-page pf-unified-page">
      <section class="ops-panel ops-compact-page-panel">
        ${bar}
        <p class="ops-order-profit-note">Her şubenin kendi kanal kimlik bilgileri ve RBAC yetkileri vardır.</p>
      </section>

      <section class="ops-panel ops-admin-panel">
        <header class="ops-panel-head">
          <div>
            <h3>Şube listesi</h3>
            <p class="ops-panel-sub">Slug, kimlik ve rol bilgileri</p>
          </div>
        </header>
        <div id="branchList" class="ops-admin-list">Yükleniyor…</div>
      </section>

      <section class="ops-panel ops-admin-panel">
        <header class="ops-panel-head">
          <div>
            <h3>Yeni şube</h3>
            <p class="ops-panel-sub">Depo veya mağaza şubesi ekleyin</p>
          </div>
        </header>
        <div class="ops-admin-form-grid">
          <label class="ops-field">
            <span class="ops-field-label">Slug</span>
            <input id="branchSlug" placeholder="kadikoy" autocomplete="off" spellcheck="false">
          </label>
          <label class="ops-field">
            <span class="ops-field-label">Ad</span>
            <input id="branchName" placeholder="Kadıköy Şubesi" autocomplete="off">
          </label>
        </div>
        <div class="ops-admin-form-actions">
          <button type="button" id="createBranchBtn" class="ops-btn ops-btn-primary">Şube oluştur</button>
        </div>
        <p id="branchFormResult" class="ops-feedback" aria-live="polite"></p>
      </section>

      <section class="ops-panel ops-admin-panel">
        <header class="ops-panel-head">
          <div>
            <h3>RBAC yetkileri</h3>
            <p class="ops-panel-sub">Subject key ve rol atamaları</p>
          </div>
        </header>
        <div id="grantList" class="ops-admin-list">—</div>
        <div class="ops-admin-form-grid ops-admin-form-grid--triple">
          <label class="ops-field">
            <span class="ops-field-label">Şube ID</span>
            <input id="grantBranchId" placeholder="uuid" autocomplete="off">
          </label>
          <label class="ops-field">
            <span class="ops-field-label">Subject key</span>
            <input id="grantSubjectKey" value="platform" autocomplete="off">
          </label>
          <label class="ops-field">
            <span class="ops-field-label">Rol</span>
            <select id="grantRole">
              <option value="admin">admin</option>
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
            </select>
          </label>
        </div>
        <div class="ops-admin-form-actions">
          <button type="button" id="saveGrantBtn" class="ops-btn ops-btn-secondary">Grant kaydet</button>
        </div>
        <p id="grantFormResult" class="ops-feedback" aria-live="polite"></p>
      </section>
    </div>`;

  return renderPetfixShell({
    title: 'Şubeler',
    activeModule: 'admin',
    activeItem: 'branches',
    bodyClass: 'pf-unified-page',
    auth,
    bootstrapVar: '__ADMIN_BRANCHES__',
    bootstrapData: { authRequired },
    bodyHtml,
    stylesheets: [
      '/assets/ops-tokens.css?v=2',
      '/assets/ops-components.css?v=corp1'
    ],
    scripts: ['/assets/admin-branches.js?v=2']
  });
}
