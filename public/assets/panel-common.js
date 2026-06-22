'use strict';

(function initPanelCommon() {
  const toggle = document.getElementById('pfNavToggle');
  const mobileQuery = window.matchMedia('(max-width: 960px)');

  function isMobileNav() {
    return mobileQuery.matches;
  }

  function setNavOpen(open) {
    document.body.classList.toggle('pf-nav-open', open);
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  if (toggle) {
    toggle.addEventListener('click', () => {
      if (!isMobileNav()) return;
      setNavOpen(!document.body.classList.contains('pf-nav-open'));
    });
    mobileQuery.addEventListener('change', () => {
      setNavOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setNavOpen(false);
    });
    document.querySelector('.pf-sidebar')?.querySelectorAll('.pf-nav-rail-link')
      .forEach((link) => {
        link.addEventListener('click', () => {
          if (isMobileNav()) setNavOpen(false);
        });
      });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn && window.BuyBoxCommon?.logout) {
    logoutBtn.addEventListener('click', () => window.BuyBoxCommon.logout());
  }

  initBranchSelector();
})();

const BRANCH_STORAGE_KEY = 'pf_ops_branch_id';

async function initBranchSelector() {
  const select = document.getElementById('branchSelect');
  if (!select || !window.BuyBoxCommon?.authFetch) return;

  try {
    const response = await window.BuyBoxCommon.authFetch('/api/ops/branches');
    const data = await response.json();
    if (!response.ok || !data.branches?.length) return;

    select.disabled = false;
    select.innerHTML = '';
    for (const branch of data.branches) {
      const option = document.createElement('option');
      option.value = branch.id;
      option.textContent = branch.name || branch.slug;
      select.appendChild(option);
    }

    const saved = localStorage.getItem(BRANCH_STORAGE_KEY) || data.activeBranchId;
    if (saved) select.value = saved;

    select.addEventListener('change', async () => {
      localStorage.setItem(BRANCH_STORAGE_KEY, select.value);
      try {
        await window.PfStatus.run('Şube değiştiriliyor', async () => {
          await window.BuyBoxCommon.authFetch('/api/ops/branches/active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ branchId: select.value })
          });
          if (typeof window.onPanelRefresh === 'function') {
            await window.onPanelRefresh();
          } else {
            window.location.reload();
          }
        }, {
          successTitle: 'Şube güncellendi',
          successDetail: 'Liste yeni şubeye göre yenilendi'
        });
      } catch {
        /* PfStatus hata gösterdi */
      }
    });
  } catch {
    // Ops Hub kapalı veya yetkisiz
  }
}

/**
 * Kanal logo HTML — matching-center ile paylaşılır (channel-logos.js).
 */
if (!window.PetFixChannelLogos) {
  console.warn('[panel-common] channel-logos.js yüklenmedi');
}
