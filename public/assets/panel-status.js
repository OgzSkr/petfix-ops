'use strict';

/**
 * Panel geneli — yükleme, ilerleme ve tamamlanma geri bildirimi.
 */
window.PfStatus = (function initPfStatus() {
  const strip = () => document.getElementById('pfStatusStrip');
  const iconEl = () => document.getElementById('pfStatusIcon');
  const titleEl = () => document.getElementById('pfStatusTitle');
  const detailEl = () => document.getElementById('pfStatusDetail');
  const trackEl = () => document.getElementById('pfStatusTrack');
  const barEl = () => document.getElementById('pfStatusBar');
  const dismissEl = () => document.getElementById('pfStatusDismiss');

  let hideTimer = null;

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide(ms) {
    clearHideTimer();
    hideTimer = setTimeout(() => hide(), ms);
  }

  function applyState(state) {
    const root = strip();
    if (!root) return;
    root.classList.remove(
      'pf-status-strip--loading',
      'pf-status-strip--progress',
      'pf-status-strip--success',
      'pf-status-strip--error'
    );
    root.classList.add(`pf-status-strip--${state}`);
  }

  function showTrack(mode, percent) {
    const track = trackEl();
    const bar = barEl();
    if (!track || !bar) return;
    track.hidden = false;
    track.classList.toggle('is-indeterminate', mode === 'indeterminate');
    if (mode === 'indeterminate') {
      bar.style.width = '100%';
      track.setAttribute('aria-valuenow', '0');
    } else {
      const safe = Math.max(0, Math.min(100, Number(percent) || 0));
      bar.style.width = `${safe}%`;
      track.setAttribute('aria-valuenow', String(safe));
    }
  }

  function hideTrack() {
    const track = trackEl();
    if (track) track.hidden = true;
  }

  function show({ state = 'loading', title = '', detail = '', percent = null, autoHideMs = 0 } = {}) {
    const root = strip();
    if (!root) return;
    clearHideTimer();
    root.classList.remove('hidden');
    applyState(state);

    if (titleEl()) titleEl().textContent = title || '';
    if (detailEl()) detailEl().textContent = detail || '';

    const dismiss = dismissEl();
    if (dismiss) {
      dismiss.classList.toggle('hidden', state !== 'error');
    }

    if (state === 'loading') {
      showTrack('indeterminate');
    } else if (state === 'progress') {
      showTrack('determinate', percent);
    } else if (state === 'success') {
      showTrack('determinate', 100);
      if (autoHideMs > 0) scheduleHide(autoHideMs);
    } else if (state === 'error') {
      hideTrack();
      if (autoHideMs > 0) scheduleHide(autoHideMs);
    }

    document.body.classList.toggle('pf-status-active', state === 'loading' || state === 'progress');
  }

  function hide() {
    clearHideTimer();
    const root = strip();
    if (root) root.classList.add('hidden');
    hideTrack();
    document.body.classList.remove('pf-status-active');
  }

  function loading(title, detail = '') {
    show({ state: 'loading', title: title || 'Yükleniyor…', detail });
  }

  function progress(title, percent, detail = '') {
    show({ state: 'progress', title: title || 'Güncelleniyor…', detail, percent });
  }

  function success(title, detail = '', autoHideMs = 2800) {
    show({
      state: 'success',
      title: title || 'Tamamlandı',
      detail,
      autoHideMs
    });
  }

  function error(title, detail = '', autoHideMs = 6000) {
    show({
      state: 'error',
      title: title || 'İşlem başarısız',
      detail,
      autoHideMs
    });
  }

  async function run(title, fn, options = {}) {
    loading(title, options.detail || '');
    try {
      const result = await fn();
      success(
        options.successTitle || `${title} tamamlandı`,
        options.successDetail || '',
        options.autoHideMs
      );
      return result;
    } catch (err) {
      error(options.errorTitle || `${title} başarısız`, err?.message || String(err));
      throw err;
    }
  }

  dismissEl()?.addEventListener('click', () => hide());

  return { loading, progress, success, error, hide, run, show };
})();
