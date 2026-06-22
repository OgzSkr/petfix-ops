'use strict';

window.BuyBoxCommon = {
  TOKEN_KEY: 'platformApiToken',

  getStoredToken() {
    return sessionStorage.getItem(this.TOKEN_KEY) || '';
  },

  redirectToLogin() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = '/login?next=' + next;
  },

  logout() {
    sessionStorage.removeItem(this.TOKEN_KEY);
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    this.redirectToLogin();
  },

  apiHeaders(includeJson = true) {
    const headers = {};
    if (includeJson) headers['Content-Type'] = 'application/json';
    const token = this.getStoredToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  },

  async authFetch(url, options = {}) {
    const common = window.BuyBoxCommon;
    const response = await fetch(url, {
      ...options,
      headers: { ...common.apiHeaders(options.body !== undefined), ...(options.headers || {}) }
    });

    if (response.status === 401) {
      sessionStorage.removeItem(common.TOKEN_KEY);
      common.redirectToLogin();
      throw new Error('Oturum süresi doldu veya yetkisiz erişim.');
    }

    return response;
  },

  showToast(element, message, durationMs = 2800) {
    if (!element) return;
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(element._toastTimer);
    element._toastTimer = setTimeout(() => element.classList.remove('show'), durationMs);
  },

  setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.disabled = true;
      if (busyLabel) button.textContent = busyLabel;
      return;
    }
    button.disabled = false;
    if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  },

  formatLocalTime(iso) {
    try {
      return new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    } catch {
      return iso || '';
    }
  },

  esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  escAttr(value) {
    return this.esc(value).replace(/'/g, '&#39;');
  },

  bindZoomControls({ zoomInId, zoomOutId, zoomResetId, tableWrapId, storageKey, defaultZoom = 100 }) {
    const tableWrap = document.getElementById(tableWrapId);
    const zoomIn = document.getElementById(zoomInId);
    const zoomOut = document.getElementById(zoomOutId);
    const zoomReset = document.getElementById(zoomResetId);
    if (!tableWrap) return;

    let zoom = Number(localStorage.getItem(storageKey)) || defaultZoom;

    function applyZoom() {
      tableWrap.style.zoom = zoom + '%';
      localStorage.setItem(storageKey, String(zoom));
    }

    zoomIn?.addEventListener('click', () => {
      zoom = Math.min(zoom + 10, 150);
      applyZoom();
    });
    zoomOut?.addEventListener('click', () => {
      zoom = Math.max(zoom - 10, 70);
      applyZoom();
    });
    zoomReset?.addEventListener('click', () => {
      zoom = defaultZoom;
      applyZoom();
    });

    applyZoom();
  }
};
