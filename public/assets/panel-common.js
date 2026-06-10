'use strict';

(function initPanelCommon() {
  const toggle = document.getElementById('pfNavToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      document.body.classList.toggle('pf-nav-open');
    });
  }

  const search = document.getElementById('pfGlobalSearch');
  if (search) {
    search.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && search.value.trim()) {
        const q = encodeURIComponent(search.value.trim());
        window.location.href = `/products?q=${q}`;
      }
    });
  }

  const refreshBtn = document.getElementById('pfRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (typeof window.onPanelRefresh === 'function') {
        window.onPanelRefresh();
      } else {
        window.location.reload();
      }
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn && window.BuyBoxCommon?.logout) {
    logoutBtn.addEventListener('click', () => window.BuyBoxCommon.logout());
  }
})();

/**
 * Kanal logo HTML — matching-center ile paylaşılır (channel-logos.js).
 */
if (!window.PetFixChannelLogos) {
  console.warn('[panel-common] channel-logos.js yüklenmedi');
}
