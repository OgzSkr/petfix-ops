'use strict';

window.TrackView = (function trackViewModule() {
  const C = window.BuyBoxCommon;

  let loaded = false;
  let toastTimer;

  const el = (id) => document.getElementById(id);

  function invalidate() {
    loaded = false;
  }

  function init() {
    el('trackForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      addAutoTrack();
    });
    el('trackRemoveBtn')?.addEventListener('click', () => {
      removeAutoTrack(el('trackBarcodeInput')?.value || '');
    });
    el('trackRefreshStatusBtn')?.addEventListener('click', () => {
      loadWorkerStatus();
      loadList();
      if (window.loadWorkspaceStatus) window.loadWorkspaceStatus();
    });
    el('trackStartWorkerBtn')?.addEventListener('click', startWorker);
    el('trackPanel')?.addEventListener('click', (event) => {
      const refreshBtn = event.target.closest('[data-track-action="refresh"]');
      if (refreshBtn) {
        event.preventDefault();
        refreshSingleBuybox(refreshBtn.dataset.barcode, refreshBtn);
        return;
      }
      const removeBtn = event.target.closest('[data-track-action="remove"]');
      if (removeBtn) {
        event.preventDefault();
        removeAutoTrack(removeBtn.dataset.barcode);
      }
    });
  }

  async function ensureLoaded(force = false) {
    await loadWorkerStatus();
    if (loaded && !force) return;
    await loadList();
  }

  async function loadWorkerStatus() {
    const titleEl = el('trackWorkerTitle');
    const hintEl = el('trackWorkerHint');
    const startBtn = el('trackStartWorkerBtn');
    if (!titleEl) return;

    try {
      const response = await C.authFetch('/api/ops/status');
      const ops = response.ok ? await response.json() : {};
      const worker = ops.worker || {};
      const cache = ops.cache || {};

      if (!worker.configured) {
        titleEl.textContent = 'Trendyol API bilgileri eksik';
        if (hintEl) {
          hintEl.innerHTML = 'Takibe alınan ürünler otomatik sorgulanmaz. <a href="/admin/settings">Ayarlar</a> sayfasından API bilgilerini girin.';
        }
        if (startBtn) startBtn.hidden = true;
        return;
      }

      if (worker.live) {
        titleEl.textContent = 'Canlı BuyBox aktif';
        if (hintEl) {
          hintEl.textContent = 'Worker çalışıyor · cache ' + (cache.ageSeconds != null ? cache.ageSeconds + ' sn önce güncellendi' : 'güncelleniyor');
        }
        if (startBtn) startBtn.hidden = true;
        return;
      }

      if (worker.running) {
        titleEl.textContent = 'Worker başlatıldı, ilk veri bekleniyor';
        if (hintEl) hintEl.textContent = 'Birkaç saniye içinde cache dolmaya başlar.';
        if (startBtn) startBtn.hidden = true;
        return;
      }

      titleEl.textContent = 'Worker kapalı — otomatik sorgu yok';
      if (hintEl) {
        hintEl.textContent = 'Takibe aldığınız ürünler yalnızca worker çalışırken otomatik güncellenir. Manuel güncelleme için tablolardaki Canlı Güncelle kullanın.';
      }
      if (startBtn) startBtn.hidden = false;
    } catch (error) {
      titleEl.textContent = 'Worker durumu alınamadı';
      if (hintEl) hintEl.textContent = error.message || '';
    }
  }

  async function startWorker() {
    const button = el('trackStartWorkerBtn');
    C.setBusy(button, true);
    try {
      const response = await C.authFetch('/api/worker/start', { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        showToast(result.error || result.message || 'Worker başlatılamadı');
        return;
      }
      showToast(result.message || 'Worker başlatıldı');
      await loadWorkerStatus();
      if (window.loadWorkspaceStatus) window.loadWorkspaceStatus(true);
    } catch (error) {
      showToast(error.message || 'Worker başlatma hatası');
    } finally {
      C.setBusy(button, false);
    }
  }

  async function loadList() {
    const listEl = el('trackList');
    if (!listEl) return;

    try {
      const response = await C.authFetch('/api/auto-track');
      if (!response.ok) {
        listEl.innerHTML = '<p class="track-empty">Takip listesi alınamadı.</p>';
        return;
      }
      const payload = await response.json();
      loaded = true;
      renderList(payload.rows || []);
    } catch (error) {
      listEl.innerHTML = '<p class="track-empty">' + esc(error.message || 'Bağlantı hatası') + '</p>';
    }
  }

  function renderList(rows) {
    const listEl = el('trackList');
    if (!listEl) return;

    if (!rows.length) {
      listEl.innerHTML = '<p class="track-empty">Henüz otomatik takip ürünü yok. Barkod girerek ekleyin veya tablolardan <strong>Takibe Al</strong> kullanın.</p>';
      return;
    }

    listEl.innerHTML = rows.map((row) =>
      '<article class="track-card">' +
        '<div class="track-card-head">' +
          '<div class="track-card-product">' +
            '<strong>' + esc(row.brand || '—') + '</strong>' +
            '<span>' + esc(row.title || row.barcode) + '</span>' +
            '<small>' + esc(row.barcode) + '</small>' +
          '</div>' +
          '<span class="track-priority-badge track-priority-badge--' + esc(row.priority || 'normal') + '">' + priorityLabel(row.priority) + '</span>' +
        '</div>' +
        '<div class="track-card-metrics">' +
          '<span class="track-stat-chip">BuyBox <strong>' + money(row.buyboxPrice) + '</strong></span>' +
          '<span class="track-stat-chip">Sıra <strong>' + esc(String(row.buyboxOrder || '—')) + '</strong></span>' +
          '<span class="track-stat-chip">Güncelleme <strong>' + shortDate(row.updatedAt) + '</strong></span>' +
        '</div>' +
        (row.lastError ? '<p class="track-error">' + esc(row.lastError) + '</p>' : '') +
        '<div class="track-card-actions">' +
          '<button type="button" class="catalog-action-btn" data-track-action="refresh" data-barcode="' + escAttr(row.barcode) + '">Canlı Güncelle</button>' +
          '<a class="catalog-action-btn catalog-action-btn--link" href="/marketplace/trendyol?barcode=' + encodeURIComponent(row.barcode) + '">Tarife\'de aç</a>' +
          '<button type="button" class="catalog-action-btn catalog-action-btn--ghost" data-track-action="remove" data-barcode="' + escAttr(row.barcode) + '">Çıkar</button>' +
        '</div>' +
      '</article>'
    ).join('');
  }

  async function addAutoTrack() {
    const barcode = String(el('trackBarcodeInput')?.value || '').trim();
    const statusEl = el('trackFormStatus');
    if (!barcode) {
      if (statusEl) statusEl.textContent = 'Barkod gerekli.';
      return;
    }

    if (statusEl) statusEl.textContent = 'Takip listesine ekleniyor…';
    try {
      const response = await C.authFetch('/api/auto-track', {
        method: 'POST',
        body: JSON.stringify({
          barcode,
          priority: el('trackPriorityInput')?.value || 'normal'
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        if (statusEl) statusEl.textContent = result.error || 'Eklenemedi.';
        showToast(result.error || 'Takibe alınamadı');
        return;
      }
      if (statusEl) statusEl.textContent = 'Otomatik takibe alındı.';
      window.CatalogView?.invalidate?.();
      if (window.loadWorkspaceStatus) await window.loadWorkspaceStatus(true);
      await loadList();
      showToast('Ürün takip listesine eklendi');
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message || 'Bağlantı hatası';
    }
  }

  async function removeAutoTrack(barcodeArg) {
    const barcode = String(barcodeArg || el('trackBarcodeInput')?.value || '').trim();
    const statusEl = el('trackFormStatus');
    if (!barcode) {
      if (statusEl) statusEl.textContent = 'Barkod gerekli.';
      return;
    }

    if (statusEl) statusEl.textContent = 'Takipten çıkarılıyor…';
    try {
      const response = await C.authFetch('/api/auto-track/remove', {
        method: 'POST',
        body: JSON.stringify({ barcode })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        if (statusEl) statusEl.textContent = result.error || 'Çıkarılamadı.';
        return;
      }
      if (statusEl) statusEl.textContent = 'Takip listesinden çıkarıldı.';
      window.CatalogView?.invalidate?.();
      if (window.loadWorkspaceStatus) await window.loadWorkspaceStatus(true);
      await loadList();
      showToast('Ürün takip listesinden çıkarıldı');
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message || 'Bağlantı hatası';
    }
  }

  async function refreshSingleBuybox(barcode, button) {
    if (!barcode) return;
    C.setBusy(button, true);
    showToast('Canlı BuyBox sorgulanıyor…');
    try {
      const response = await C.authFetch('/api/buybox/refresh', {
        method: 'POST',
        body: JSON.stringify({ barcode })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        showToast(result.error || result.message || 'Canlı güncelleme başarısız');
        return;
      }
      await loadList();
      showToast(result.skipped ? 'Az önce güncellendi.' : 'Ürün güncellendi');
    } catch (error) {
      showToast(error.message || 'Bağlantı hatası');
    } finally {
      C.setBusy(button, false);
    }
  }

  function showToast(message) {
    const toast = document.getElementById('tariffToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function priorityLabel(value) {
    return { critical: 'Kritik', normal: 'Normal', low: 'Düşük' }[value] || 'Normal';
  }

  function money(value) {
    if (value === '' || value === null || value === undefined) return '—';
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(value) || 0);
  }

  function shortDate(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Istanbul'
    }).format(new Date(value));
  }

  function esc(value) { return C.esc(value); }
  function escAttr(value) { return C.escAttr(value); }

  return { init, ensureLoaded, loadList, invalidate, loadWorkerStatus };
})();
