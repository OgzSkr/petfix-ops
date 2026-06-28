'use strict';

(function bootBenimposProductsPage() {
  const bootstrap = window.__PANEL__ || {};
  const common = window.BuyBoxCommon;

  const DISPLAY_CHANNELS = [
    { id: 'getir', pushChannel: 'getir', planned: false },
    { id: 'uber-eats', pushChannel: 'trendyol_go', planned: false },
    { id: 'yemeksepeti', pushChannel: 'yemeksepeti', planned: false }
  ];

  const MASTER_LIST_LABEL = 'Ürün listesi';
  const CHANNEL_MENU_LABELS = { ys: 'Yemeksepeti', tgo: 'Trendyol GO', getir: 'Getir' };

  function channelMenuLabel(kindOrLabel) {
    return CHANNEL_MENU_LABELS[kindOrLabel] || kindOrLabel;
  }

  function channelMenuProgressLabel(label) {
    return `${channelMenuLabel(label)} menüsü`;
  }

  const STATUS_LABELS = {
    ready: 'Hazır',
    diff: 'Fark Var',
    'no-stock': 'Stok Yok',
    waiting: 'Bekliyor'
  };

  const MATCHING_STATUS_LABELS = {
    unmapped: 'Eşleşmemiş',
    missing_master: 'Ana listede yok',
    auto_matched: 'Otomatik öneri',
    pending: 'Onay bekliyor',
    review_required: 'İnceleme gerekli',
    barcode_conflict: 'Çoklu aday',
    manual_confirmed: 'Eşleştirildi'
  };

  const ORPHAN_STATUS_LABELS = {
    missing_master: 'Ana listede yok',
    unmapped: 'Eşleşmemiş',
    pending: 'Onay bekliyor',
    review_required: 'İnceleme gerekli',
    barcode_conflict: 'Çoklu aday',
    auto_matched: 'Otomatik eşleşme'
  };

  let page = 1;
  let totalPages = 1;
  let total = 0;
  let limit = 20;
  let loading = false;
  let pushInFlight = false;
  let rowsCache = [];
  const selected = new Set();
  const pendingChannelPriceUpdates = new Map();
  let brandOptions = [];
  let viewMode = 'masters';
  let matchingRowsCache = [];
  let matchingSafeConfirmable = null;
  let cleanupSuggestionsCache = [];

  const state = {
    q: '',
    brand: '',
    channelFocus: '',
    channelSaleStatus: '',
    syncStatus: '',
    stock: '',
    matchStatus: 'action',
    confirmableOnly: '',
    sort: 'name',
    sortDir: 'asc'
  };

  const els = {};

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(value) {
    return esc(value).replace(/'/g, '&#39;');
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `₺${n.toFixed(2).replace('.', ',')}`;
  }

  function isMatchingView() {
    return viewMode === 'matching';
  }

  function confidenceTone(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return 'neutral';
    if (n >= 85) return 'high';
    if (n >= 60) return 'medium';
    return 'low';
  }

  function renderChannelImage(row) {
    const imageUrl = String(row.channelImageUrl || '').trim();
    if (imageUrl) {
      return `<img class="bp-match-thumb" src="${escAttr(imageUrl)}" alt="" width="56" height="56" loading="lazy" onerror="this.classList.add('bp-match-thumb--empty'); this.removeAttribute('src');">`;
    }
    const barcode = String(row.channelBarcode || row.linkedMasterBarcode || '').trim();
    if (barcode) {
      return `<img class="bp-match-thumb" src="/api/product-thumb-img?barcode=${escAttr(barcode)}" alt="" width="56" height="56" loading="lazy" onerror="this.classList.add('bp-match-thumb--empty'); this.removeAttribute('src');">`;
    }
    return '<span class="bp-match-thumb bp-match-thumb--empty" aria-hidden="true"></span>';
  }

  function renderMasterSuggestion(row) {
    if (!row.suggestedMasterProductId) {
      return '<span class="bp-match-empty">Öneri yok</span>';
    }
    const barcode = String(row.linkedMasterBarcode || '').trim();
    const thumb = barcode
      ? `<img class="bp-match-thumb bp-match-thumb--sm" src="/api/product-thumb-img?barcode=${escAttr(barcode)}" alt="" width="36" height="36" loading="lazy" onerror="this.classList.add('bp-match-thumb--empty'); this.removeAttribute('src');">`
      : '<span class="bp-match-thumb bp-match-thumb--sm bp-match-thumb--empty" aria-hidden="true"></span>';
    return `<div class="bp-match-suggest">
      ${thumb}
      <div>
        <div class="bp-match-suggest-name">${esc(row.suggestedMasterName || '—')}</div>
        <div class="bp-match-suggest-meta">${esc(barcode || row.suggestedMasterProductId || '')}</div>
        ${row.suggestionReason ? `<div class="bp-match-suggest-reason">${esc(row.suggestionReason)}</div>` : ''}
      </div>
    </div>`;
  }

  function renderMatchingStatusBadge(status) {
    const label = MATCHING_STATUS_LABELS[status] || status || '—';
    const cls = status === 'manual_confirmed' ? 'ready'
      : status === 'auto_matched' ? 'waiting'
        : status === 'barcode_conflict' ? 'diff'
          : status === 'missing_master' ? 'no-stock'
            : 'waiting';
    return `<span class="bp-status-badge ${cls}">${esc(label)}</span>`;
  }

  function renderConfidenceBadge(score) {
    const tone = confidenceTone(score);
    const text = Number.isFinite(Number(score)) ? `%${Math.round(Number(score))}` : '—';
    return `<span class="bp-confidence bp-confidence--${tone}">${esc(text)}</span>`;
  }

  function renderChannelBadge(channelId, label) {
    const logo = window.PetFixChannelLogos?.render
      ? window.PetFixChannelLogos.render(channelId, { size: 'sm' })
      : esc(label || channelId);
    return `<span class="bp-channel-badge">${logo}<span>${esc(label || channelLabel(channelId))}</span></span>`;
  }

  function renderChannelIconOnly(channelId, label) {
    const text = label || channelLabel(channelId);
    const logo = window.PetFixChannelLogos?.render
      ? window.PetFixChannelLogos.render(channelId, { size: 'sm' })
      : esc(text);
    return `<span class="bp-channel-icon-only" title="${escAttr(text)}" aria-label="${escAttr(text)}">${logo}</span>`;
  }

  function formatPosStock(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return { text: '—', cls: 'is-unknown' };
    if (n < 0) return { text: String(n), cls: 'is-negative' };
    if (n === 0) return { text: '0', cls: 'is-zero' };
    return { text: String(Math.round(n)), cls: 'is-in' };
  }

  function renderStockBadge(stock) {
    const { text, cls } = formatPosStock(stock);
    return `<span class="bp-stock-pill ${cls}" title="Kasa stoku">${esc(text)}</span>`;
  }

  function renderChannelCardThumb(cp, mappingDetail, fallbackBarcode) {
    const imageUrl = String(cp?.channelImageUrl || '').trim();
    if (imageUrl) {
      return `<img class="bp-channel-card-thumb" src="${escAttr(imageUrl)}" alt="" width="40" height="40" loading="lazy" onerror="this.classList.add('bp-channel-card-thumb--empty'); this.removeAttribute('src');">`;
    }
    const barcode = String(fallbackBarcode || mappingDetail?.channelBarcode || cp?.channelSku || '').trim();
    if (barcode) {
      return `<img class="bp-channel-card-thumb" src="/api/product-thumb-img?barcode=${escAttr(barcode)}" alt="" width="40" height="40" loading="lazy" onerror="this.classList.add('bp-channel-card-thumb--empty'); this.removeAttribute('src');">`;
    }
    return '<span class="bp-channel-card-thumb bp-channel-card-thumb--empty" aria-hidden="true"></span>';
  }

  function renderSaleBadge(onSale, canPush, channelId, barcode) {
    const label = onSale ? 'Satışta' : 'Stok Yok';
    const cls = onSale ? 'is-on' : 'is-off';
    const title = canPush
      ? (onSale ? 'Satışta — stok gönder' : 'Satışta değil — stok gönder')
      : label;
    if (canPush) {
      return `<button type="button" class="bp-sale-badge ${cls} is-clickable" data-stock-push="${escAttr(channelId)}" data-barcode="${escAttr(barcode)}" title="${escAttr(title)}" aria-label="${escAttr(title)}">${esc(label)}</button>`;
    }
    return `<span class="bp-sale-badge ${cls}">${esc(label)}</span>`;
  }

  function formatSyncInterval(minutes) {
    const n = Number(minutes);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n >= 1440 && n % 1440 === 0) {
      const days = n / 1440;
      return days === 1 ? 'günde 1 kez' : `${days} günde bir`;
    }
    if (n >= 60 && n % 60 === 0) {
      const hours = n / 60;
      return hours === 1 ? 'saatte 1 kez' : `${hours} saatte bir`;
    }
    return `${n} dakikada bir`;
  }

  function formatSyncChannels(channels) {
    const labels = (channels || []).map((id) => channelLabel(id));
    return labels.length ? labels.join(', ') : 'Getir, Yemeksepeti, Trendyol GO';
  }

  async function loadSyncScheduleInfo() {
    const target = document.getElementById('bpSyncScheduleLine');
    if (!target) return;
    try {
      const response = await authFetch('/api/product-matching/sync-schedule');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'schedule');
      const settings = data.settings || data;
      const enabled = Boolean(settings.enabled);
      const interval = formatSyncInterval(settings.intervalMinutes);
      const channels = formatSyncChannels(settings.channels);
      const lastRun = settings.lastRunAt
        ? new Date(settings.lastRunAt).toLocaleString('tr-TR')
        : 'henüz çalışmadı';
      target.innerHTML = enabled
        ? `<strong>Otomatik katalog yenileme açık.</strong> ${esc(interval)} — kanallar: ${esc(channels)}. Son çalışma: ${esc(lastRun)}.`
        : `<strong>Otomatik katalog yenileme kapalı.</strong> Listeler yalnızca üstteki manuel butonlarla veya Sistem sayfasından açılan zamanlayıcı ile güncellenir.`;
    } catch {
      target.textContent = 'Otomatik senkron durumu okunamadı — manuel «Listeleri güncelle» butonlarını kullanabilirsiniz.';
    }
  }

  function setStatus(text, tone) {
    if (!els.status) return;
    els.status.textContent = text || '';
    const resolved = tone === true ? 'error' : (tone || 'neutral');
    els.status.classList.toggle('is-error', resolved === 'error');
    els.status.classList.toggle('is-success', resolved === 'success');
    els.status.classList.toggle('is-warn', resolved === 'warn');
    if (text && !els.syncProgress?.hidden) {
      els.status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (text) {
      els.status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function setSyncProgress({ label = 'Güncelleniyor', percent = 0, detail = '', tone = 'running' } = {}) {
    if (!els.syncProgress) return;
    const safePct = Math.max(0, Math.min(100, Number(percent) || 0));
    els.syncProgress.hidden = false;
    els.syncProgress.classList.toggle('is-complete', tone === 'success');
    els.syncProgress.classList.toggle('is-error', tone === 'error');
    els.syncProgress.classList.toggle('is-running', tone === 'running' && safePct < 100);
    if (els.syncProgressLabel) els.syncProgressLabel.textContent = label;
    if (els.syncProgressPct) els.syncProgressPct.textContent = `${safePct}%`;
    if (els.syncProgressBar) els.syncProgressBar.style.width = `${safePct}%`;
    if (els.syncProgressTrack) els.syncProgressTrack.setAttribute('aria-valuenow', String(safePct));
    if (els.syncProgressDetail) els.syncProgressDetail.textContent = detail || '';

    if (window.PfStatus) {
      if (tone === 'error') {
        window.PfStatus.error(label, detail);
      } else if (tone === 'success') {
        window.PfStatus.success(label, detail || 'İşlem tamamlandı');
      } else if (safePct > 0 && safePct < 100) {
        window.PfStatus.progress(label, safePct, detail);
      } else {
        window.PfStatus.loading(label, detail);
      }
    }
  }

  function clearSyncProgress(delayMs = 2500) {
    if (!els.syncProgress) return;
    clearTimeout(clearSyncProgress._timer);
    clearSyncProgress._timer = setTimeout(() => {
      if (els.syncProgress) els.syncProgress.hidden = true;
    }, delayMs);
  }

  function setSyncButtonsDisabled(disabled) {
    for (const id of ['bpSyncMasterBtn', 'bpSyncYsBtn', 'bpSyncTgoBtn', 'bpSyncGetirBtn']) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = disabled;
    }
  }

  function showToast(text, tone) {
    if (!text) return;
    let toast = document.getElementById('bpToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'bpToast';
      toast.className = 'bp-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'assertive');
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.className = `bp-toast is-${tone || 'neutral'}`;
    toast.hidden = false;
    clearTimeout(showToast._hideTimer);
    showToast._hideTimer = setTimeout(() => {
      toast.hidden = true;
    }, 7000);
  }

  function humanizePushError(error, channel) {
    const message = String(error?.message || error || 'Bilinmeyen hata');
    if (/tekrarlı stok fiyat|çok sık güncelleme|429/.test(message)) {
      return 'Uber Eats: çok sık güncelleme — 2–3 dakika bekleyip tekrar deneyin';
    }
    if (channel === 'trendyol_go' && /TGO batch/.test(message)) {
      return message.replace(/^TGO batch [^:]+:\s*/, 'Uber Eats reddetti: ');
    }
    return message;
  }

  function rememberPendingChannelPrice(displayChannelId, barcodes, price) {
    if (!displayChannelId || !Number.isFinite(Number(price))) return;
    for (const barcode of barcodes || []) {
      const code = String(barcode || '').trim();
      if (!code) continue;
      pendingChannelPriceUpdates.set(`${code}:${displayChannelId}`, Number(price));
    }
  }

  function applyPendingChannelPriceUpdates(rows) {
    if (!pendingChannelPriceUpdates.size) return rows;
    return (rows || []).map((row) => {
      const barcode = String(row.benimposBarcode || '').trim();
      if (!barcode) return row;
      let changed = false;
      const channelPrices = (row.channelPrices || []).map((cp) => {
        const pending = pendingChannelPriceUpdates.get(`${barcode}:${cp.channelId}`);
        if (pending == null) return cp;
        changed = true;
        return { ...cp, channelPrice: pending };
      });
      return changed ? { ...row, channelPrices } : row;
    });
  }

  function notifyUser(text, tone) {
    setStatus(text, tone);
    if (tone === 'success' || tone === 'error' || tone === 'warn') showToast(text, tone);
  }

  function setModalBusy(busy) {
    if (els.modalConfirm) els.modalConfirm.disabled = Boolean(busy);
    if (els.modalCancel) els.modalCancel.disabled = Boolean(busy);
  }

  function formatPushResultMessage(data, options = {}) {
    const mode = options.mode || 'full';
    const label = options.displayLabel || 'Kanal';
    const price = options.customPrice;
    const pushed = data.plan?.items?.length ?? 0;
    const action = mode === 'price' ? 'Fiyat' : mode === 'stock' ? 'Stok' : 'Fiyat ve stok';

    if (data.dryRun) {
      if (data.pushResult?.blocked || data.pushResult?.reason) {
        return {
          text: `${label}: ${action} gönderilemedi — ${data.pushResult.reason || 'canlı gönderim kapalı'}`,
          tone: 'error'
        };
      }
      if (!data.flagEnabled) {
        return {
          text: `${label}: ${action} simüle edildi (FF_STOCK_PUSH kapalı — canlı gönderim yok)`,
          tone: 'warn'
        };
      }
      return { text: `${label}: ${action} simüle edildi`, tone: 'warn' };
    }

    if (pushed <= 0) {
      const skipped = data.plan?.skipped || {};
      if (skipped.inactiveChannelProduct > 0 && mode !== 'price') {
        return {
          text: `${label}: YS'de pasif ürün — stok gönderilemez`,
          tone: 'warn'
        };
      }
      return {
        text: `${label}: Gönderilecek ürün yok — eşleştirme veya filtreleri kontrol edin`,
        tone: 'warn'
      };
    }

    let detail = '';
    if (mode === 'price' && Number.isFinite(Number(price)) && Number(price) > 0) {
      detail = ` (${formatMoney(price)})`;
    } else if (mode === 'stock') {
      const qty = data.plan?.items?.[0]?.targetQuantity;
      if (qty != null) detail = ` (stok: ${qty})`;
    }

    return {
      text: `✓ ${label} — ${action} başarıyla gönderildi${detail}`,
      tone: 'success'
    };
  }

  function authFetch(url, options) {
    if (!common?.authFetch) throw new Error('Oturum modülü yüklenemedi');
    return common.authFetch(url, options);
  }

  async function apiPost(path, body) {
    const response = await authFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }
    return data;
  }

  function formatDiffPct(pct) {
    const n = Number(pct);
    if (!Number.isFinite(n)) return { text: '—', cls: 'is-neutral' };
    const sign = n > 0 ? '+' : '';
    const text = `${sign}${n.toFixed(1).replace('.', ',')}%`;
    const cls = Math.abs(n) <= 0.5 ? 'is-neutral' : (n > 0 ? 'is-up' : 'is-down');
    return { text, cls };
  }

  function isChannelOnSale(cp) {
    if (cp?.onSale === true) return true;
    if (cp?.onSale === false) return false;
    const price = Number(cp?.channelPrice);
    const stock = cp?.channelStock;
    if (!Number.isFinite(price) || price <= 0) return false;
    if (stock != null) return Number(stock) > 0;
    return false;
  }

  function channelPriceRow(row, channelId) {
    return (row.channelPrices || []).find((item) => item.channelId === channelId) || null;
  }

  function resolvePushChannel(displayChannelId) {
    const hit = DISPLAY_CHANNELS.find((item) => item.id === displayChannelId);
    return hit?.pushChannel || null;
  }

  function findRowByBarcode(barcode) {
    const code = String(barcode || '').trim();
    return rowsCache.find((row) => String(row.benimposBarcode || '').trim() === code) || null;
  }

  function masterChannelMapping(row, channelId) {
    return (row.channelMappingDetails || []).find((item) => item.channelId === channelId) || null;
  }

  function canRemoveChannelMapping(cp, mappingDetail) {
    if (mappingDetail?.channelProductId) return true;
    if (!cp?.channelProductId) return false;
    return Boolean(cp.canUnmap || cp.hasMapping);
  }

  function renderChannelDupRow(channel, item) {
    const wrongClass = item.likelyWrong ? ' bp-channel-dup-row--wrong' : '';
    const label = item.likelyWrong ? 'Muhtemelen hatalı eşleşme — kaldır' : `${item.channelProductId} eşleştirmesini kaldır`;
    return `<div class="bp-channel-dup-row${wrongClass}">
      <div class="bp-channel-dup-row-head">
        <span class="bp-channel-dup-code" title="${escAttr(item.channelName || item.channelProductId || '')}">${esc(item.channelProductId || '—')}</span>
        <span class="bp-channel-dup-price">${formatMoney(item.channelSalePrice)}</span>
      </div>
      <button type="button" class="bp-unmap-btn bp-unmap-btn--sm" data-unmap-channel="${escAttr(channel.id)}" data-unmap-by-product="1" data-channel-product="${escAttr(item.channelProductId)}" title="${escAttr(label)}" aria-label="Eşleştirmeyi kaldır">Kaldır</button>
    </div>`;
  }

  function renderChannelCell(row, channel) {
    if (channel.planned) {
      return `<td class="bp-col-channel bp-channel-cell"><span class="bp-channel-empty" title="Getir stok/fiyat gönderimi yakında">—</span></td>`;
    }
    const cp = channelPriceRow(row, channel.id);
    const mappingDetail = masterChannelMapping(row, channel.id);
    const dupGroup = duplicateMappingGroup(row, channel.id);
    if (dupGroup && (dupGroup.items || []).length > 1) {
      return `<td class="bp-col-channel bp-channel-cell bp-channel-cell--dup">
        <div class="bp-channel-dup-list">${(dupGroup.items || []).map((item) => renderChannelDupRow(channel, item)).join('')}</div>
      </td>`;
    }
    if (!cp?.linked && !mappingDetail) {
      return '<td class="bp-col-channel bp-channel-cell"><span class="bp-channel-empty">—</span></td>';
    }
    const onSale = isChannelOnSale(cp);
    const diff = formatDiffPct(cp?.saleDiffPct);
    const barcode = String(row.benimposBarcode || '').trim();
    const canPush = Boolean(channel.pushChannel);
    const priceTitle = canPush ? 'Fiyat gönder' : 'Kanal fiyatı';
    const channelProductId = String(cp?.channelProductId || mappingDetail?.channelProductId || '').trim();
    const channelPrice = cp?.channelPrice ?? mappingDetail?.channelSalePrice ?? null;
    const canUnmap = canRemoveChannelMapping(cp, mappingDetail);
    const channelName = String(cp?.channelName || mappingDetail?.channelName || '').trim();
    const channelSku = String(cp?.channelSku || mappingDetail?.channelBarcode || channelProductId || '').trim();
    const dupBadge = dupGroup
      ? `<span class="bp-channel-dup-badge" title="${escAttr(duplicateMappingTitle(dupGroup))}">×${esc(dupGroup.count)}</span>`
      : '';
    const unmapBtn = canUnmap
      ? `<button type="button" class="bp-unmap-btn" data-unmap-channel="${escAttr(channel.id)}" data-unmap-barcode="${escAttr(barcode)}" data-channel-product="${escAttr(channelProductId)}" title="${escAttr(channelLabel(channel.id))} eşleştirmesini kaldır" aria-label="Eşleştirmeyi kaldır">Kaldır</button>`
      : (cp?.barcodeMatchOnly ? '<div class="bp-channel-link-hint">Kayıtlı eşleştirme yok</div>' : '');
    return `<td class="bp-col-channel bp-channel-cell">
      <div class="bp-channel-card">
        <div class="bp-channel-card-top">
          ${renderSaleBadge(onSale, canPush, channel.id, barcode)}
          <button type="button" class="bp-channel-price${canPush ? ' is-clickable' : ''}" ${canPush ? `data-price-push="${escAttr(channel.id)}" data-barcode="${escAttr(barcode)}"` : ''} title="${escAttr(priceTitle)}">${formatMoney(channelPrice)}</button>
          ${dupBadge}
        </div>
        <div class="bp-channel-card-body">
          ${renderChannelCardThumb(cp, mappingDetail, barcode)}
          <div class="bp-channel-card-copy">
            <div class="bp-channel-card-name">${esc(channelName || '—')}</div>
            ${channelSku ? `<div class="bp-channel-card-sku">SKU: ${esc(channelSku)}</div>` : ''}
          </div>
        </div>
        <div class="bp-channel-diff ${diff.cls}">${esc(diff.text)}</div>
        ${unmapBtn}
      </div>
    </td>`;
  }

  function renderProductThumb(barcode) {
    if (!barcode) {
      return '<span class="bp-product-thumb bp-product-thumb--empty">—</span>';
    }
    return `<img class="bp-product-thumb" src="/api/product-thumb-img?barcode=${escAttr(barcode)}" alt="" width="40" height="40" loading="lazy" onerror="this.classList.add('bp-product-thumb--empty'); this.removeAttribute('src'); this.textContent='—';">`;
  }

  function renderRows(rows) {
    rowsCache = applyPendingChannelPriceUpdates(rows);
    if (!rows.length) {
      els.body.innerHTML = `<tr><td colspan="${tableColspan()}" class="bp-empty">Ürün bulunamadı. «Ürün listesini yenile» ile kasadan listeyi indirin.</td></tr>`;
      return;
    }

    els.body.innerHTML = rows.map((row) => {
      const barcode = String(row.benimposBarcode || '').trim();
      const brand = String(row.brand || '').trim();
      const category = String(row.categoryName || '').trim();
      const meta = brand
        ? `Marka: ${brand}${category ? ` · ${category}` : ''}`
        : category;
      const checked = selected.has(barcode) ? ' checked' : '';

      return `<tr data-barcode="${escAttr(barcode)}" data-id="${escAttr(row.id)}" class="${selected.has(barcode) ? 'is-selected' : ''}">
        <td class="bp-col-product">
          <div class="bp-product-cell">
            <input type="checkbox" class="pf-checkbox bp-row-check" data-barcode="${escAttr(barcode)}" aria-label="Seç"${checked}>
            ${renderProductThumb(barcode)}
            <div class="bp-product-copy">
              <div class="bp-product-name">${esc(row.name || '—')}</div>
              ${renderDuplicateMappingBadge(row)}
              <div class="bp-code-stack bp-code-stack--compact">
                <span class="bp-barcode bp-barcode--sub">
                  <span>${esc(barcode || '—')}</span>
                  ${renderStockBadge(row.stock)}
                  ${barcode ? `<button type="button" class="bp-copy-btn" data-copy-barcode="${escAttr(barcode)}" title="Kopyala">⧉</button>` : ''}
                </span>
              </div>
              ${meta ? `<div class="bp-product-meta">${esc(meta)}</div>` : ''}
            </div>
          </div>
        </td>
        <td class="bp-num bp-buy-price${Number(row.buyingPrice) > 0 ? '' : ' bp-buy-price--missing'}" title="Kâr hesabı kaynağı — BenimPOS sync ile güncellenir">${Number(row.buyingPrice) > 0 ? formatMoney(row.buyingPrice) : '—'}</td>
        <td class="bp-num bp-pos-price">${formatMoney(row.salePrice1)}</td>
        ${DISPLAY_CHANNELS.map((channel) => renderChannelCell(row, channel)).join('')}
      </tr>`;
    }).join('');

    syncSelectAllState();
    updateSelectionToolbar();
  }

  function tableColspan() {
    return isMatchingView() ? 7 : 6;
  }

  function channelLabel(channelId) {
    const hit = DISPLAY_CHANNELS.find((item) => item.id === channelId);
    if (hit?.id === 'uber-eats') return 'Uber Eats';
    if (hit?.id === 'yemeksepeti') return 'Yemeksepeti';
    if (hit?.id === 'getir') return 'Getir';
    return channelId || 'Kanal';
  }

  function duplicateMappingGroup(row, channelId) {
    return (row.duplicateChannelMappings?.byChannel || [])
      .find((group) => group.channelId === channelId) || null;
  }

  function duplicateMappingTitle(group) {
    if (!group) return '';
    const lines = (group.items || []).map((item) => {
      const flag = item.likelyWrong ? ' (muhtemelen hatalı)' : '';
      return `${item.channelBarcode || item.channelProductId}: ${item.channelName || '—'}${flag}`;
    });
    return `${channelLabel(group.channelId)} kanalında ${group.count} eşleşme.\n${lines.join('\n')}`;
  }

  function renderDuplicateMappingBadge(row) {
    const dup = row.duplicateChannelMappings;
    if (!dup?.hasDuplicates) return '';
    const parts = (dup.byChannel || []).map((group) => `${channelLabel(group.channelId)} ×${group.count}`);
    const wrong = (dup.byChannel || [])
      .flatMap((group) => group.likelyWrong || [])
      .map((item) => item.channelBarcode || item.channelProductId)
      .filter(Boolean);
    const title = [
      'Bu BenimPOS ürününe aynı kanaldan birden fazla liste bağlı.',
      parts.join(' · '),
      wrong.length ? `Kaldırılması önerilen: ${wrong.join(', ')}` : ''
    ].filter(Boolean).join(' ');
    return `<span class="bp-dup-map-badge" title="${escAttr(title)}">Çift eşleşme · ${esc(parts.join(' · '))}</span>`;
  }

  function isConfirmedMatchingQueue() {
    return state.matchStatus === 'confirmed';
  }

  function matchingStatusFilter() {
    const queueModes = new Set(['action', 'confirmed', '']);
    return queueModes.has(state.matchStatus) ? '' : state.matchStatus;
  }

  function normalizeMatchingMatchStatus(value) {
    const raw = String(value || '').trim();
    if (raw === 'confirmed') return 'confirmed';
    if (!raw || raw === 'queue') return 'action';
    return raw;
  }

  function updateTableHead() {
    if (!els.tableHead) return;
    if (isMatchingView()) {
      els.tableHead.innerHTML = `<tr>
        <th class="bp-col-thumb" scope="col">Görsel</th>
        <th class="bp-col-product" scope="col">Kanal ürün adı</th>
        <th class="bp-col-channel bp-col-channel-icon" scope="col" aria-label="Kanal">Kanal</th>
        <th scope="col">Eşleşme durumu</th>
        <th scope="col">${isConfirmedMatchingQueue() ? 'Bağlı BenimPOS ürünü' : 'Önerilen BenimPOS ürünü'}</th>
        <th scope="col">Güven</th>
        <th class="bp-col-actions" scope="col">İşlemler</th>
      </tr>`;
      return;
    }
    els.tableHead.innerHTML = `<tr>
      <th class="bp-col-product" scope="col">
        <div class="bp-product-head">
          <input type="checkbox" class="pf-checkbox" id="bpSelectAll" aria-label="Tümünü seç">
          <span>Ürün Bilgisi</span>
        </div>
      </th>
      <th scope="col">Alış (maliyet)</th>
      <th scope="col">Kasa satış</th>
      ${DISPLAY_CHANNELS.map((ch) => {
        const logo = window.PetFixChannelLogos?.render
          ? window.PetFixChannelLogos.render(ch.id, { size: 'sm' })
          : esc(ch.id);
        return `<th class="bp-col-channel" scope="col"><div class="bp-channel-head">${logo}</div></th>`;
      }).join('')}
    </tr>`;
    els.selectAll = document.getElementById('bpSelectAll');
    els.autoStockSelectAll = null;
    els.selectAll?.addEventListener('change', onSelectAllChange);
  }

  function syncAutoStockSelectAllState() {
    if (!els.autoStockSelectAll) return;
    const checks = els.body?.querySelectorAll('.bp-auto-stock-check') || [];
    if (!checks.length) {
      els.autoStockSelectAll.checked = false;
      els.autoStockSelectAll.indeterminate = false;
      return;
    }
    const checkedCount = [...checks].filter((node) => node.checked).length;
    els.autoStockSelectAll.checked = checkedCount === checks.length;
    els.autoStockSelectAll.indeterminate = checkedCount > 0 && checkedCount < checks.length;
  }

  async function setMasterAutoStock(masterId, enabled) {
    await apiPost('/api/product-matching/update-master', {
      masterProductId: masterId,
      autoStockSync: enabled
    });
  }

  async function setVisibleAutoStock(enabled) {
    const checks = [...(els.body?.querySelectorAll('.bp-auto-stock-check') || [])];
    const masterProductIds = checks.map((node) => node.getAttribute('data-master-id')).filter(Boolean);
    if (!masterProductIds.length) return;
    await apiPost('/api/product-matching/master-auto-stock-bulk', {
      masterProductIds,
      enabled
    });
    checks.forEach((node) => {
      node.checked = enabled;
    });
    syncAutoStockSelectAllState();
  }

  function onAutoStockSelectAllChange() {
    if (!els.autoStockSelectAll) return;
    setVisibleAutoStock(els.autoStockSelectAll.checked).catch((error) => {
      notifyUser(error.message, 'error');
      syncAutoStockSelectAllState();
    });
  }

  async function triggerStockAutoSyncAfterMaster() {
    try {
      const prefsRes = await authFetch('/api/ops/preferences');
      const prefs = await prefsRes.json().catch(() => ({}));
      if (!prefs?.preferences?.stockAutoSyncEnabled) return;
      await apiPost('/api/ops/stock-auto-sync/run', {});
    } catch {
      // Sessiz — master sync zaten başarılı
    }
  }

  function updateMatchingToolbar() {
    const confirmed = isConfirmedMatchingQueue();
    if (els.matchingToolbarHint) {
      els.matchingToolbarHint.innerHTML = confirmed
        ? 'Daha önce onaylanmış kanal eşleşmeleri. Yanlış bağlantıları <strong>Kaldır</strong> ile silebilirsiniz.'
        : 'Barkod eşleşmesi yapar; güven skoru <strong>%95+</strong> (barkod eşleşmesinde isim farkı tolere edilir) ürünleri otomatik onaylar.';
    }
    if (els.autoMatchBtn) els.autoMatchBtn.hidden = confirmed;
  }

  function setFilterPanelMode() {
    const matching = isMatchingView();
    document.body.classList.toggle('bp-matching-view', matching);
    document.body.classList.toggle('bp-orphan-view', matching);
    if (els.brand) els.brand.hidden = matching;
    if (els.channelSale) els.channelSale.hidden = matching;
    if (els.statusFilter) els.statusFilter.hidden = matching;
    if (els.stock) els.stock.hidden = matching;
    if (els.matchStatus) els.matchStatus.hidden = !matching;
    if (els.confirmable) els.confirmable.hidden = !matching;
    if (els.selectAllWrap) els.selectAllWrap.hidden = matching;
    if (els.exportBtn) els.exportBtn.hidden = matching;
    if (els.matchingToolbar) els.matchingToolbar.hidden = !matching;
    if (matching) updateMatchingToolbar();
    if (els.channel) {
      els.channel.querySelector('option[value=""]')?.toggleAttribute('disabled', false);
    }
  }

  function setViewMode(nextView) {
    viewMode = nextView === 'matching' || nextView === 'orphans' ? 'matching' : 'masters';
    if (isMatchingView() && (!state.matchStatus || state.matchStatus === '')) {
      state.matchStatus = 'action';
    }
    document.querySelectorAll('.bp-view-tab').forEach((node) => {
      node.classList.toggle('is-active', node.getAttribute('data-view') === viewMode);
    });
    page = 1;
    selected.clear();
    setFilterPanelMode();
    updateTableHead();
    syncFiltersToUrl();
    loadCleanupSuggestions();
    loadProducts();
  }

  async function loadCleanupSuggestions() {
    if (!els.cleanupBanner) return;
    if (isMatchingView()) {
      els.cleanupBanner.hidden = true;
      return;
    }
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (state.channelFocus) params.set('channelId', state.channelFocus);
      const data = await authFetch(`/api/product-matching/cleanup-suggestions?${params.toString()}`);
      cleanupSuggestionsCache = Array.isArray(data?.items) ? data.items : [];
      renderCleanupBanner(data);
    } catch {
      els.cleanupBanner.hidden = true;
      cleanupSuggestionsCache = [];
    }
  }

  function renderCleanupBanner(data) {
    if (!els.cleanupBanner || !els.cleanupList) return;
    const items = cleanupSuggestionsCache;
    if (!items.length) {
      els.cleanupBanner.hidden = true;
      return;
    }
    els.cleanupBanner.hidden = false;
    const total = Number(data?.total) || items.length;
    if (els.cleanupLead) {
      els.cleanupLead.textContent = total > items.length
        ? `${total} geçersiz eşleştirme — ilk ${items.length} gösteriliyor. BenimPOS veya kanal kataloğundan silinen ürünler.`
        : `${total} geçersiz eşleştirme — BenimPOS veya kanal kataloğundan silinen ürünler.`;
    }
    els.cleanupList.innerHTML = items.map((item) => `
      <li class="bp-cleanup-item">
        <div>
          <div class="bp-cleanup-item-text">${esc(item.message || '')}</div>
          <div class="bp-cleanup-item-meta">${esc(item.benimposBarcode || '—')}${item.channelLabel ? ` · ${esc(item.channelLabel)}` : ''}</div>
        </div>
        <div class="bp-cleanup-item-actions">
          <button type="button" class="bp-btn bp-btn-ghost bp-cleanup-dismiss-btn" data-dismiss-id="${escAttr(item.id)}">Yoksay</button>
          <button type="button" class="bp-btn bp-btn-danger bp-cleanup-apply-btn" data-apply-id="${escAttr(item.id)}">Kaldır</button>
        </div>
      </li>
    `).join('');
  }

  async function applyCleanupSuggestionIds(ids, { all = false } = {}) {
    const payload = all ? { all: true, channelId: state.channelFocus || undefined } : { suggestionIds: ids };
    const data = await apiPost('/api/product-matching/apply-cleanup-suggestions', payload);
    notifyUser(`${data.removed || 0} eşleştirme kaldırıldı.`, 'success');
    await loadCleanupSuggestions();
    await loadProducts({ silent: true });
    return data;
  }

  async function dismissCleanupSuggestionIds(ids, { all = false } = {}) {
    const payload = all ? { all: true, channelId: state.channelFocus || undefined } : { suggestionIds: ids };
    await apiPost('/api/product-matching/dismiss-cleanup-suggestions', payload);
    await loadCleanupSuggestions();
  }

  function renderMatchingRows(rows) {
    matchingRowsCache = rows;
    rowsCache = [];
    if (!rows.length) {
      const hint = isConfirmedMatchingQueue()
        ? 'Onaylı eşleşme bulunamadı. Durum filtresinde «Onaylı eşleşmeler» seçili; arama veya kanal filtresini genişletin.'
        : 'Eşleştirme bekleyen kanal ürünü bulunamadı. Onaylı kayıtlar için Durum → «Onaylı eşleşmeler»i seçin.';
      els.body.innerHTML = `<tr><td colspan="${tableColspan()}" class="bp-empty">${hint}</td></tr>`;
      return;
    }

    els.body.innerHTML = rows.map((row) => {
      const key = `${row.channelId}:${row.channelProductId}`;
      const barcode = String(row.channelBarcode || '').trim();
      const sku = String(row.channelSku || row.channelStockCode || row.channelProductId || '').trim();
      const brand = String(row.channelBrand || '').trim();
      const brandLine = brand ? `<div class="bp-product-meta">${esc(brand)}</div>` : '';
      const skuLine = sku && sku !== barcode ? `<span class="bp-sku">${esc(sku)}</span>` : '';
      const canConfirm = Boolean(row.canConfirm && row.suggestedMasterProductId);
      const canRemove = Boolean(row.mappingStatus && row.mappingStatus !== 'unmapped' && row.mappingStatus !== 'missing_master');
      return `<tr data-match-key="${escAttr(key)}" data-channel="${escAttr(row.channelId)}" data-channel-product="${escAttr(row.channelProductId)}">
        <td class="bp-col-thumb">${renderChannelImage(row)}</td>
        <td class="bp-col-product">
          <div class="bp-match-product bp-match-product--text">
            <div>
              <div class="bp-product-name">${esc(row.channelName || '—')}</div>
              ${brandLine}
              <div class="bp-code-stack bp-code-stack--compact">
                <span class="bp-barcode"><span>${esc(barcode || '—')}</span>${barcode ? `<button type="button" class="bp-copy-btn" data-copy-barcode="${escAttr(barcode)}" title="Kopyala">⧉</button>` : ''}</span>
                ${skuLine}
              </div>
              ${row.systemComment ? `<div class="bp-product-meta bp-product-meta--note">${esc(row.systemComment)}</div>` : ''}
            </div>
          </div>
        </td>
        <td class="bp-col-channel bp-col-channel-icon">${renderChannelIconOnly(row.channelId, row.channelLabel)}</td>
        <td>${renderMatchingStatusBadge(row.mappingStatus)}</td>
        <td>${renderMasterSuggestion(row)}</td>
        <td>${renderConfidenceBadge(row.confidenceScore)}</td>
        <td class="bp-col-actions">
          <div class="bp-match-actions">
            <button type="button" class="bp-btn bp-btn-primary bp-btn-xs" data-confirm-match="${escAttr(key)}" ${canConfirm ? '' : 'disabled'} title="Öneriyi onayla">Eşleştir</button>
            <button type="button" class="bp-btn bp-btn-ghost bp-btn-xs" data-search-master="${escAttr(key)}" title="BenimPOS ürünü ara">Ara</button>
            ${canRemove ? `<button type="button" class="bp-btn bp-btn-ghost bp-btn-xs bp-btn-danger" data-remove-match="${escAttr(key)}" title="Eşleştirmeyi kaldır">Kaldır</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function findMatchingRow(key) {
    return matchingRowsCache.find((row) => `${row.channelId}:${row.channelProductId}` === key) || null;
  }

  async function removeChannelMapping(channelId, channelProductId, { productName = '', benimposBarcode = '' } = {}) {
    const label = channelLabel(channelId);
    const name = String(productName || '').trim();
    const prompt = name
      ? `${name}\n\n${label} eşleştirmesini kaldırmak istediğinize emin misiniz?`
      : `${label} eşleştirmesini kaldırmak istediğinize emin misiniz?`;
    if (!window.confirm(prompt)) return;

    setStatus('Eşleştirme kaldırılıyor…');
    const barcode = String(benimposBarcode || '').trim();
    if (barcode) {
      await apiPost('/api/product-matching/remove-master-channel-mapping', {
        channelId,
        benimposBarcode: barcode
      });
    } else if (channelProductId) {
      await apiPost('/api/product-matching/remove-mapping', {
        channelId,
        channelProductId
      });
    } else {
      throw new Error('Kaldırılacak eşleştirme bulunamadı.');
    }
    notifyUser('Eşleştirme kaldırıldı.', 'success');
    await loadProducts({ silent: true });
  }

  async function removeMatchRow(row) {
    if (!row?.channelId || !row?.channelProductId) {
      notifyUser('Kaldırılacak eşleştirme bulunamadı.', 'warn');
      return;
    }
    await removeChannelMapping(row.channelId, row.channelProductId, { productName: row.channelName });
  }

  async function unmapSelectedMasters() {
    const barcodes = selectedBarcodes();
    if (!barcodes.length) {
      notifyUser('Önce en az bir ürün seçin.', 'warn');
      return;
    }

    const channelId = String(state.channelFocus || '').trim();
    if (channelId) {
      const label = channelLabel(channelId);
      if (!window.confirm(`${barcodes.length} ürün için ${label} eşleştirmesi kaldırılacak. Devam?`)) return;
      setStatus('Eşleştirmeler kaldırılıyor…');
      const data = await apiPost('/api/product-matching/remove-master-channel-mappings-bulk', {
        channelId,
        barcodes
      });
      const removed = Number(data.removed) || 0;
      const notFound = Number(data.notFound) || 0;
      notifyUser(
        removed
          ? `${removed} eşleştirme kaldırıldı${notFound ? ` · ${notFound} üründe kayıt yoktu` : ''}.`
          : 'Seçili ürünlerde kaldırılacak eşleştirme bulunamadı. Getir fiyatı yalnızca barkod eşleşmesiyse kayıt silinmez.',
        removed ? 'success' : 'warn'
      );
    } else {
      const masterIds = [...new Set(
        barcodes.map((code) => findRowByBarcode(code)?.id).filter(Boolean)
      )];
      if (!masterIds.length) {
        notifyUser('Seçili satırlarda ana ürün kimliği bulunamadı.', 'warn');
        return;
      }
      if (!window.confirm(`${masterIds.length} ürünün tüm kanal eşleştirmeleri kaldırılacak. Devam?`)) return;
      setStatus('Eşleştirmeler kaldırılıyor…');
      const data = await apiPost('/api/product-matching/master-pool-bulk', {
        action: 'unmap',
        masterProductIds: masterIds
      });
      const removed = Number(data.removed) || 0;
      notifyUser(
        removed
          ? `${removed} eşleştirme kaldırıldı.`
          : (data.message || 'Seçili ürünlerde kaldırılacak eşleştirme yok.'),
        removed ? 'success' : 'warn'
      );
    }

    selected.clear();
    await loadProducts({ silent: true });
  }

  async function confirmMatchRow(row) {
    if (!row?.suggestedMasterProductId) {
      notifyUser('Onaylanabilir öneri yok — BenimPOS ürünü arayın.', 'warn');
      return;
    }
    if (row.masterLinkConflict) {
      notifyUser('Çoklu aday var — manuel seçim gerekli.', 'warn');
      return;
    }
    setStatus('Eşleştirme kaydediliyor…');
    await apiPost('/api/product-matching/confirm', {
      channelId: row.channelId,
      channelProductId: row.channelProductId,
      masterProductId: row.suggestedMasterProductId,
      confirmedBy: 'matching_center'
    });
    notifyUser(`${row.channelName || 'Ürün'} eşleştirildi.`, 'success');
    await loadProducts({ silent: true });
  }

  async function openMasterSearchModal(row) {
    if (!row) return;
    const initial = String(row.suggestedMasterName || row.channelName || '').trim().slice(0, 40);
    let selectedMasterId = row.suggestedMasterProductId || '';

    openModal({
      title: 'BenimPOS ürünü seç',
      lead: `${row.channelName || 'Kanal ürünü'} için ana ürün arayın.`,
      bodyHtml: `<label class="bp-modal-field" for="bpMasterSearchInput">Ara</label>
        <input type="search" id="bpMasterSearchInput" class="bp-search" value="${escAttr(initial)}" autocomplete="off">
        <div class="bp-master-search-results" id="bpMasterSearchResults"></div>`,
      confirmLabel: 'Seçili ürünü eşleştir',
      onOpen: () => {
        const input = document.getElementById('bpMasterSearchInput');
        const resultsEl = document.getElementById('bpMasterSearchResults');

        async function renderResults(query) {
          const response = await authFetch(`/api/product-matching/search-masters?q=${encodeURIComponent(query || '')}`);
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
          const items = data.rows || [];
          if (!items.length) {
            resultsEl.innerHTML = '<p class="bp-empty-inline">Sonuç bulunamadı.</p>';
            return;
          }
          resultsEl.innerHTML = items.map((item) => {
            const active = item.id === selectedMasterId ? ' is-active' : '';
            return `<button type="button" class="bp-master-pick${active}" data-master-id="${escAttr(item.id)}">
              <img class="bp-match-thumb bp-match-thumb--sm" src="/api/product-thumb-img?barcode=${escAttr(item.benimposBarcode || '')}" alt="" width="36" height="36" loading="lazy" onerror="this.classList.add('bp-match-thumb--empty'); this.removeAttribute('src');">
              <span>
                <strong>${esc(item.name || '—')}</strong>
                <small>${esc(item.benimposBarcode || '')}</small>
              </span>
            </button>`;
          }).join('');
        }

        input?.addEventListener('input', () => {
          renderResults(input.value).catch((error) => {
            resultsEl.innerHTML = `<p class="bp-empty-inline">${esc(error.message)}</p>`;
          });
        });
        resultsEl?.addEventListener('click', (event) => {
          const btn = event.target.closest('[data-master-id]');
          if (!btn) return;
          selectedMasterId = btn.getAttribute('data-master-id') || '';
          resultsEl.querySelectorAll('[data-master-id]').forEach((node) => {
            node.classList.toggle('is-active', node.getAttribute('data-master-id') === selectedMasterId);
          });
        });

        renderResults(initial).catch((error) => {
          resultsEl.innerHTML = `<p class="bp-empty-inline">${esc(error.message)}</p>`;
        });
      },
      onConfirm: async () => {
        if (!selectedMasterId) throw new Error('BenimPOS ürünü seçin.');
        await apiPost('/api/product-matching/confirm', {
          channelId: row.channelId,
          channelProductId: row.channelProductId,
          masterProductId: selectedMasterId,
          confirmedBy: 'matching_center_manual'
        });
        notifyUser('Manuel eşleştirme kaydedildi.', 'success');
        await loadProducts({ silent: true });
      }
    });
  }

  function buildMatchingQueryParams() {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      queue: isConfirmedMatchingQueue() ? 'confirmed' : 'action'
    });
    if (state.q) params.set('q', state.q);
    if (state.channelFocus) params.set('channelId', state.channelFocus);
    const statusFilter = matchingStatusFilter();
    if (statusFilter) params.set('status', statusFilter);
    if (state.confirmableOnly === '1') params.set('quality', 'confirmable');
    return params;
  }

  async function loadMatchingCenter() {
    const response = await authFetch(`/api/product-matching/workbench?${buildMatchingQueryParams()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    total = Number(data.total) || 0;
    totalPages = Math.max(1, Number(data.totalPages) || 1);
    page = Math.min(page, totalPages);
    renderMatchingRows(data.rows || []);
    renderPagination();
    matchingSafeConfirmable = data.summary?.safeConfirmable ?? null;
    if (els.totalMeta) {
      els.totalMeta.textContent = `Gösterilen ${(data.rows || []).length} / ${Number(total).toLocaleString('tr-TR')} eşleştirme`;
      updateFilterSummary(data.summary?.filtered ?? total);
    }
  }

  function buildQueryParams() {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      sort: state.sort || 'name',
      sortDir: state.sortDir || 'asc'
    });
    if (state.q) params.set('q', state.q);
    if (state.brand) params.set('brand', state.brand);
    if (state.syncStatus) params.set('syncStatus', state.syncStatus);
    if (state.channelFocus) params.set('channelFocus', state.channelFocus);
    if (state.channelFocus && state.channelSaleStatus) {
      params.set('channelSaleStatus', state.channelSaleStatus);
    }
    if (state.stock === 'in') params.set('stock', 'in');
    if (state.stock === 'out') params.set('stock', 'out');
    if (state.sort && state.sort !== 'name') params.set('sort', state.sort);
    if (state.sortDir && state.sortDir !== 'asc') params.set('sortDir', state.sortDir);
    return params;
  }

  function parseSortValue(raw) {
    const value = String(raw || 'name:asc').trim();
    const [sort, sortDir] = value.split(':');
    const allowed = new Set(['name', 'stock', 'priceDiff', 'maxPriceDiff', 'cost', 'updated']);
    return {
      sort: allowed.has(sort) ? sort : 'name',
      sortDir: sortDir === 'desc' ? 'desc' : 'asc'
    };
  }

  function sortSelectValue() {
    return `${state.sort || 'name'}:${state.sortDir || 'asc'}`;
  }

  function activeFilterCount() {
    let count = 0;
    if (state.q) count += 1;
    if (state.brand) count += 1;
    if (state.channelFocus) count += 1;
    if (state.channelSaleStatus) count += 1;
    if (state.syncStatus) count += 1;
    if (state.stock) count += 1;
    if (state.matchStatus && state.matchStatus !== 'action') count += 1;
    if (state.confirmableOnly) count += 1;
    return count;
  }

  function syncFiltersToUrl() {
    const params = new URLSearchParams();
    if (isMatchingView()) params.set('view', 'matching');
    if (state.q) params.set('q', state.q);
    if (viewMode === 'masters') {
      if (state.brand) params.set('brand', state.brand);
      if (state.channelSaleStatus) params.set('channelSale', state.channelSaleStatus);
      if (state.syncStatus) params.set('status', state.syncStatus);
      if (state.stock) params.set('stock', state.stock);
      if (state.sort && state.sort !== 'name') params.set('sort', state.sort);
      if (state.sortDir && state.sortDir !== 'asc') params.set('sortDir', state.sortDir);
    } else {
      if (state.matchStatus && state.matchStatus !== 'action') params.set('matchStatus', state.matchStatus);
      if (state.confirmableOnly === '1') params.set('confirmable', '1');
    }
    if (state.channelFocus) params.set('channel', state.channelFocus);
    if (page > 1) params.set('page', String(page));
    if (limit !== 20) params.set('limit', String(limit));
    const qs = params.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
  }

  function readFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    viewMode = view === 'matching' || view === 'orphans' ? 'matching' : 'masters';
    state.q = params.get('q') || '';
    state.brand = params.get('brand') || '';
    state.channelFocus = params.get('channel') || params.get('channelFocus') || '';
    state.channelSaleStatus = params.get('channelSale') || params.get('channelSaleStatus') || '';
    state.syncStatus = params.get('status') || params.get('syncStatus') || '';
    state.stock = params.get('stock') || '';
    const urlMatchStatus = params.get('matchStatus') || (params.get('queue') === 'confirmed' ? 'confirmed' : '');
    state.matchStatus = isMatchingView()
      ? normalizeMatchingMatchStatus(urlMatchStatus)
      : '';
    state.confirmableOnly = params.get('confirmable') === '1' ? '1' : '';
    const parsedSort = parseSortValue(params.get('sort') && params.get('sortDir')
      ? `${params.get('sort')}:${params.get('sortDir')}`
      : (params.get('sort') || 'name:asc'));
    state.sort = parsedSort.sort;
    state.sortDir = parsedSort.sortDir;
    page = Math.max(1, Number(params.get('page')) || 1);
    limit = Math.max(10, Number(params.get('limit')) || 20);
  }

  function applyFiltersToControls() {
    if (els.search) els.search.value = state.q;
    if (els.brand) els.brand.value = state.brand;
    if (els.channel) els.channel.value = state.channelFocus;
    if (els.channelSale) {
      els.channelSale.disabled = !state.channelFocus;
      els.channelSale.value = state.channelFocus ? state.channelSaleStatus : '';
    }
    if (els.statusFilter) els.statusFilter.value = state.syncStatus;
    if (els.matchStatus) els.matchStatus.value = state.matchStatus || 'action';
    if (els.confirmable) els.confirmable.value = state.confirmableOnly;
    if (els.stock) els.stock.value = state.stock;
    if (els.sort) els.sort.value = sortSelectValue();
    if (els.pageSize) els.pageSize.value = String(limit);
  }

  function renderBrandOptions(brands) {
    if (!els.brand || !Array.isArray(brands)) return;
    const merged = [...new Set([...brandOptions, ...brands.map((item) => String(item || '').trim()).filter(Boolean)])]
      .sort((a, b) => a.localeCompare(b, 'tr-TR'));
    brandOptions = merged;
    const current = state.brand;
    els.brand.innerHTML = `<option value="">Marka: Tümü</option>${merged.map((name) =>
      `<option value="${escAttr(name)}"${name === current ? ' selected' : ''}>${esc(name)}</option>`
    ).join('')}`;
    if (current && !merged.includes(current)) {
      els.brand.insertAdjacentHTML('beforeend', `<option value="${escAttr(current)}" selected>${esc(current)}</option>`);
    }
  }

  function updateFilterSummary(poolTotal) {
    if (!els.filterSummary) return;
    if (isMatchingView()) {
      const active = activeFilterCount();
      const safe = matchingSafeConfirmable;
      els.filterSummary.textContent = [
        poolTotal != null ? `Kuyruk: ${Number(poolTotal).toLocaleString('tr-TR')} ürün` : '',
        total != null ? `Sonuç: ${Number(total).toLocaleString('tr-TR')}` : '',
        safe != null ? `Hızlı onay: ${Number(safe).toLocaleString('tr-TR')}` : '',
        active ? `${active} filtre aktif` : ''
      ].filter(Boolean).join(' · ');
      return;
    }
    const active = activeFilterCount();
    if (!active && !poolTotal) {
      els.filterSummary.textContent = '';
      return;
    }
    const parts = [];
    if (poolTotal != null) parts.push(`Havuz: ${Number(poolTotal).toLocaleString('tr-TR')} ürün`);
    if (total != null) parts.push(`Sonuç: ${Number(total).toLocaleString('tr-TR')}`);
    if (active) parts.push(`${active} filtre aktif`);
    if (state.sort === 'priceDiff') {
      const ch = state.channelFocus ? channelLabel(state.channelFocus) : 'Getir';
      parts.push(`Fiyat farkı sıralaması: ${ch}`);
    } else if (state.sort === 'maxPriceDiff') {
      parts.push('Sıralama: en büyük kanal farkı');
    }
    els.filterSummary.textContent = parts.join(' · ');
  }

  function resetFilters() {
    state.q = '';
    state.brand = '';
    state.channelFocus = '';
    state.channelSaleStatus = '';
    state.syncStatus = '';
    state.stock = '';
    state.matchStatus = 'action';
    state.confirmableOnly = '';
    state.sort = 'name';
    state.sortDir = 'asc';
    page = 1;
    applyFiltersToControls();
    syncFiltersToUrl();
    loadProducts();
  }

  function readFiltersFromControls() {
    state.q = String(els.search?.value || '').trim();
    state.brand = String(els.brand?.value || '').trim();
    state.channelFocus = String(els.channel?.value || '').trim();
    state.channelSaleStatus = state.channelFocus ? String(els.channelSale?.value || '').trim() : '';
    state.syncStatus = String(els.statusFilter?.value || '').trim();
    state.matchStatus = normalizeMatchingMatchStatus(els.matchStatus?.value || 'action');
    state.confirmableOnly = String(els.confirmable?.value || '').trim();
    state.stock = String(els.stock?.value || '').trim();
    const parsedSort = parseSortValue(els.sort?.value || 'name:asc');
    state.sort = parsedSort.sort;
    state.sortDir = parsedSort.sortDir;
  }

  function applyFilters() {
    readFiltersFromControls();
    page = 1;
    if (isMatchingView()) {
      updateMatchingToolbar();
      updateTableHead();
    }
    syncFiltersToUrl();
    loadProducts();
  }

  async function loadProducts(options = {}) {
    if (loading) return;
    loading = true;
    const silent = Boolean(options.silent);
    if (!silent && !options.keepStatus) {
      window.PfStatus?.loading?.(
        isMatchingView() ? 'Eşleştirme listesi yükleniyor' : 'Ürün listesi yükleniyor'
      );
    }
    if (!options.silent) setStatus('Liste yükleniyor…');
    try {
      if (isMatchingView()) {
        await loadMatchingCenter();
        setStatus('');
        syncFiltersToUrl();
        if (!silent) {
          window.PfStatus?.success?.('Eşleştirme listesi hazır');
        }
        return;
      }

      const response = await authFetch(`/api/product-matching/master-products?${buildQueryParams()}`);
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      let data;
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const snippet = (await response.text()).replace(/\s+/g, ' ').slice(0, 120);
        throw new Error(
          response.status >= 500 || response.status === 504
            ? `Sunucu yanıt vermedi (HTTP ${response.status}). Filtre çok geniş olabilir; biraz bekleyip tekrar deneyin.`
            : `Beklenmeyen sunucu yanıtı (HTTP ${response.status}): ${snippet}`
        );
      }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      total = Number(data.total) || 0;
      totalPages = Math.max(1, Number(data.totalPages) || 1);
      page = Math.min(page, totalPages);
      renderRows(data.rows || []);
      renderPagination();
      renderBrandOptions(data.brands || []);
      if (els.totalMeta) {
        const poolTotal = data.summary?.poolTotal ?? data.total;
        els.totalMeta.textContent = `Gösterilen ${(data.rows || []).length} / ${Number(total).toLocaleString('tr-TR')} ürün`;
        updateFilterSummary(poolTotal);
      }
      syncFiltersToUrl();
      if (!options.keepStatus) setStatus('');
      loadCleanupSuggestions();
      if (!silent) {
        window.PfStatus?.success?.(
          'Ürün listesi hazır',
          `${Number(total).toLocaleString('tr-TR')} ürün`
        );
      }
    } catch (error) {
      els.body.innerHTML = `<tr><td colspan="${tableColspan()}" class="bp-empty">${esc(error.message)}</td></tr>`;
      setStatus(error.message, true);
      if (!silent) {
        window.PfStatus?.error?.('Ürün listesi yüklenemedi', error.message);
      }
    } finally {
      loading = false;
    }
  }

  function renderPagination() {
    if (!els.pagination) return;
    const parts = [];
    parts.push(`<button type="button" class="bp-page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Önceki">‹</button>`);

    const windowSize = 5;
    let start = Math.max(1, page - Math.floor(windowSize / 2));
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    if (start > 1) {
      parts.push('<button type="button" class="bp-page-btn" data-page="1">1</button>');
      if (start > 2) parts.push('<span class="bp-page-ellipsis">…</span>');
    }

    for (let i = start; i <= end; i += 1) {
      parts.push(`<button type="button" class="bp-page-btn${i === page ? ' is-active' : ''}" data-page="${i}">${i}</button>`);
    }

    if (end < totalPages) {
      if (end < totalPages - 1) parts.push('<span class="bp-page-ellipsis">…</span>');
      parts.push(`<button type="button" class="bp-page-btn" data-page="${totalPages}">${totalPages}</button>`);
    }

    parts.push(`<button type="button" class="bp-page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} aria-label="Sonraki">›</button>`);
    els.pagination.innerHTML = parts.join('');
  }

  function syncSelectAllState() {
    if (!els.selectAll) return;
    const checks = els.body?.querySelectorAll('.bp-row-check') || [];
    if (!checks.length) {
      els.selectAll.checked = false;
      els.selectAll.indeterminate = false;
      return;
    }
    const checkedCount = [...checks].filter((node) => node.checked).length;
    els.selectAll.checked = checkedCount === checks.length;
    els.selectAll.indeterminate = checkedCount > 0 && checkedCount < checks.length;
  }

  function selectedBarcodes() {
    return [...selected];
  }

  async function syncMaster() {
    setSyncButtonsDisabled(true);
    setSyncProgress({ label: MASTER_LIST_LABEL, percent: 0, detail: 'Başlatılıyor…' });
    setStatus('');
    try {
      const data = await apiPost('/api/product-matching/sync-master', {});
      if (data.started || data.running) {
        await pollMasterSyncStatus();
        return;
      }
      if (data.skipped && data.running) {
        await pollMasterSyncStatus();
        return;
      }
      setSyncProgress({ label: MASTER_LIST_LABEL, percent: 100, detail: 'Tamamlandı', tone: 'success' });
      setStatus(`Ürün listesi güncellendi — ${data.imported ?? data.total ?? ''} ürün`, 'success');
      clearSyncProgress();
      page = 1;
      selected.clear();
      await loadProducts();
      await triggerStockAutoSyncAfterMaster();
    } catch (error) {
      setSyncProgress({ label: MASTER_LIST_LABEL, percent: 0, detail: error.message, tone: 'error' });
      setStatus(error.message, true);
    } finally {
      setSyncButtonsDisabled(false);
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollMasterSyncStatus() {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      await sleep(attempt === 0 ? 500 : 2000);
      const response = await authFetch('/api/product-matching/sync-master/status');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      if (data.running) {
        const pct = Number.isFinite(data.percent) ? data.percent : 0;
        const msg = data.progress?.message || 'Ürün listesi indiriliyor…';
        setSyncProgress({
          label: MASTER_LIST_LABEL,
          percent: pct,
          detail: `${msg} · API yavaş olabilir (15–25 dk)`
        });
        continue;
      }
      if (data.error) throw new Error(data.error);
      const result = data.result || {};
      setSyncProgress({
        label: MASTER_LIST_LABEL,
        percent: 100,
        detail: `${result.imported ?? result.total ?? ''} ürün güncellendi`,
        tone: 'success'
      });
      setStatus(`Ürün listesi güncellendi — ${result.imported ?? result.total ?? ''} ürün`, 'success');
      clearSyncProgress();
      page = 1;
      selected.clear();
      await loadProducts();
      await triggerStockAutoSyncAfterMaster();
      return;
    }
    throw new Error('Ürün listesi indirme zaman aşımı — birkaç dakika sonra sayfayı yenileyin.');
  }

  async function pollCatalogSyncStatus(channelId, label) {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      await sleep(attempt === 0 ? 400 : 1500);
      const response = await authFetch(
        `/api/product-matching/sync-catalog/status?channelId=${encodeURIComponent(channelId)}`
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      if (data.running) {
        const pct = Number.isFinite(data.percent) ? data.percent : 0;
        const msg = data.progress?.message || `${channelMenuProgressLabel(label)} indiriliyor…`;
        setSyncProgress({ label: channelMenuProgressLabel(label), percent: pct, detail: msg });
        continue;
      }
      if (data.error) throw new Error(data.error);
      const result = data.result || {};
      const linked = result.barcodeLink?.linked;
      setSyncProgress({
        label: channelMenuProgressLabel(label),
        percent: 100,
        detail: linked != null ? `${linked} barkod bağlandı` : 'Tamamlandı',
        tone: 'success'
      });
      setStatus(`${channelMenuProgressLabel(label)} güncellendi${linked != null ? ` · ${linked} barkod bağlandı` : ''}`, 'success');
      clearSyncProgress();
      await loadProducts();
      return result;
    }
    throw new Error(`${channelMenuProgressLabel(label)} indirme zaman aşımı — sayfayı yenileyin.`);
  }

  async function syncCatalog(kind) {
    const channelIds = { ys: 'yemeksepeti', tgo: 'uber-eats', getir: 'getir' };
    const label = CHANNEL_MENU_LABELS[kind] || kind;
    const channelId = channelIds[kind] || kind;
    const progressLabel = channelMenuProgressLabel(label);
    setSyncButtonsDisabled(true);
    setSyncProgress({ label: progressLabel, percent: 0, detail: 'Başlatılıyor…' });
    setStatus('');
    try {
      const paths = {
        ys: '/api/product-matching/sync-yemeksepeti-catalog',
        tgo: '/api/product-matching/sync-uber-catalog',
        getir: '/api/product-matching/sync-getir-catalog'
      };
      const path = paths[kind];
      if (!path) throw new Error('Bilinmeyen kanal menüsü');
      const payload = kind === 'ys' ? { maxPages: 120 } : {};
      const data = await apiPost(path, payload);
      if (data.started || data.running) {
        await pollCatalogSyncStatus(channelId, label);
        return;
      }
      if (data.skipped && data.running) {
        await pollCatalogSyncStatus(channelId, label);
        return;
      }
      setSyncProgress({ label: progressLabel, percent: 100, detail: 'Tamamlandı', tone: 'success' });
      const pruned = Number(data.prunedAbsent) || 0;
      setStatus(
        pruned > 0
          ? `${progressLabel} güncellendi · ${pruned} artık menüde olmayan ürün temizlendi`
          : `${progressLabel} güncellendi`,
        'success'
      );
      clearSyncProgress();
      await loadProducts();
    } catch (error) {
      setSyncProgress({ label: progressLabel, percent: 0, detail: error.message, tone: 'error' });
      setStatus(error.message, true);
    } finally {
      setSyncButtonsDisabled(false);
    }
  }

  async function autoMatchPerfect() {
    const channelId = String(state.channelFocus || '').trim();
    const scope = channelId ? channelLabel(channelId) : 'tüm kanallar';
    setStatus(`Otomatik eşleştirme çalışıyor (${scope}, güven ≥%95)…`);
    try {
      const payload = channelId ? { channelId } : {};
      const data = await apiPost('/api/product-matching/auto-match-perfect', payload);
      const confirmed = Number(data.confirmed) || 0;
      const skipped = Number(data.skipped) || 0;
      setStatus(`Otomatik eşleştirme tamam — ${confirmed} ürün onaylandı${skipped ? ` · ${skipped} atlandı` : ''}`);
      await loadProducts();
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  let modalState = null;

  function closeModal() {
    modalState = null;
    if (els.modalOverlay) {
      els.modalOverlay.hidden = true;
      els.modalOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  function openModal({ title, lead, bodyHtml, confirmLabel, onConfirm, onOpen }) {
    if (!els.modalOverlay) return;
    modalState = { onConfirm };
    if (els.modalTitle) els.modalTitle.textContent = title || '';
    if (els.modalLead) els.modalLead.textContent = lead || '';
    if (els.modalBody) els.modalBody.innerHTML = bodyHtml || '';
    if (els.modalConfirm) els.modalConfirm.textContent = confirmLabel || 'Gönder';
    els.modalOverlay.hidden = false;
    els.modalOverlay.setAttribute('aria-hidden', 'false');
    if (typeof onOpen === 'function') onOpen();
    els.modalConfirm?.focus();
  }

  function openPriceModal(displayChannelId, barcode) {
    const row = findRowByBarcode(barcode);
    const opsChannel = resolvePushChannel(displayChannelId);
    if (!row || !opsChannel) {
      setStatus('Bu kanal için fiyat gönderimi henüz desteklenmiyor.', true);
      return;
    }
    const cp = channelPriceRow(row, displayChannelId);
    const posPrice = Number(row.salePrice1);
    const defaultPrice = Number.isFinite(posPrice) && posPrice > 0 ? posPrice : Number(cp?.channelPrice);
    const priceValue = Number.isFinite(defaultPrice) && defaultPrice > 0 ? defaultPrice.toFixed(2) : '';
    const label = channelLabel(displayChannelId);
    openModal({
      title: `${label} — fiyat gönder`,
      lead: row.name || barcode,
      bodyHtml: `<dl class="bp-modal-dl">
        <div><dt>Kanal fiyatı</dt><dd>${formatMoney(cp?.channelPrice)}</dd></div>
        <div><dt>POS satış</dt><dd>${formatMoney(row.salePrice1)}</dd></div>
      </dl>
      <label class="bp-modal-field">
        <span>Gönderilecek fiyat (₺)</span>
        <input type="number" id="bpModalPriceInput" class="bp-modal-input" min="0.01" step="0.01" value="${escAttr(priceValue)}" inputmode="decimal">
      </label>
      <p class="bp-modal-note">BenimPOS stok bilgisi korunur; yalnızca fiyat kanala yazılır.</p>`,
      confirmLabel: 'Fiyat gönder',
      onConfirm: async () => {
        const input = document.getElementById('bpModalPriceInput');
        const customPrice = Number(String(input?.value || '').replace(',', '.'));
        if (!Number.isFinite(customPrice) || customPrice <= 0) {
          notifyUser('Geçerli bir fiyat girin.', 'error');
          return false;
        }
        setModalBusy(true);
        try {
          await pushChannel(opsChannel, [barcode], {
            mode: 'price',
            customPrice,
            displayLabel: label,
            displayChannelId
          });
          return true;
        } finally {
          setModalBusy(false);
        }
      }
    });
  }

  function openStockModal(displayChannelId, barcode) {
    const row = findRowByBarcode(barcode);
    const opsChannel = resolvePushChannel(displayChannelId);
    if (!row || !opsChannel) {
      setStatus('Bu kanal için stok gönderimi henüz desteklenmiyor.', true);
      return;
    }
    const cp = channelPriceRow(row, displayChannelId);
    const stock = Math.max(0, Math.floor(Number(row.stock) || 0));
    const channelOnSale = isChannelOnSale(cp);
    const label = channelLabel(displayChannelId);
    openModal({
      title: `${label} — stok gönder`,
      lead: row.name || barcode,
      bodyHtml: `<dl class="bp-modal-dl">
        <div><dt>BenimPOS stok</dt><dd>${esc(String(stock))}</dd></div>
        <div><dt>Kanal satış</dt><dd>${channelOnSale ? 'Açık' : 'Kapalı'}</dd></div>
        <div><dt>Kanal fiyatı</dt><dd>${formatMoney(cp?.channelPrice)}</dd></div>
      </dl>
      <p class="bp-modal-note">${stock > 0
        ? 'Ürün kanalda açık kalır; miktar BenimPOS stokundan yazılır. Fiyat değişmez.'
        : 'Stok 0 gönderilir; ürün kanalda kapatılır. Fiyat değişmez.'}</p>`,
      confirmLabel: 'Stok gönder',
      onConfirm: async () => {
        setModalBusy(true);
        try {
          await pushChannel(opsChannel, [barcode], { mode: 'stock', displayLabel: label, displayChannelId });
          return true;
        } finally {
          setModalBusy(false);
        }
      }
    });
  }

  async function pushChannel(channel, barcodes, options = {}) {
    const list = (barcodes || []).filter(Boolean);
    if (!list.length) {
      notifyUser('Göndermek için en az bir ürün seçin.', 'error');
      return;
    }
    if (pushInFlight) {
      notifyUser('Gönderim devam ediyor — lütfen bekleyin.', 'warn');
      return;
    }
    const mode = options.mode || 'full';
    const label = options.displayLabel || (channel === 'yemeksepeti' ? 'Yemeksepeti' : channel === 'getir' ? 'Getir' : 'Uber Eats');
    const actionLabel = mode === 'price' ? 'Fiyat' : mode === 'stock' ? 'Stok' : 'Stok/fiyat';
    pushInFlight = true;
    notifyUser(`${label} — ${actionLabel.toLowerCase()} gönderiliyor…`, 'warn');
    try {
      const body = {
        channel,
        barcodes: list,
        forceLive: true,
        mode
      };
      if (options.customPrice != null) body.customPrice = options.customPrice;
      const data = await apiPost('/ops/v1/stock/sync', body);
      const result = formatPushResultMessage(data, { mode, displayLabel: label, customPrice: options.customPrice });
      if (!data.dryRun && (data.plan?.items?.length ?? 0) > 0) {
        if (mode === 'price' && options.displayChannelId && options.customPrice != null) {
          rememberPendingChannelPrice(options.displayChannelId, list, options.customPrice);
        }
        await loadProducts({ silent: true, keepStatus: true });
      }
      notifyUser(result.text, result.tone);
    } catch (error) {
      notifyUser(`${label}: Gönderim başarısız — ${humanizePushError(error, channel)}`, 'error');
    } finally {
      pushInFlight = false;
    }
  }

  function exportCsv() {
    const source = rowsCache.length ? rowsCache : [];
    if (!source.length) {
      setStatus('Dışa aktarılacak satır yok.', true);
      return;
    }
    const headers = ['Barkod', 'Ürün', 'Marka', 'Kategori', 'BenimPOS Stok', 'POS Satış', 'Durum'];
    DISPLAY_CHANNELS.forEach((ch) => {
      headers.push(`${ch.id} fiyat`, `${ch.id} fark %`, `${ch.id} satışta`);
    });
    const lines = [headers.join(';')];
    source.forEach((row) => {
      const cols = [
        row.benimposBarcode || '',
        row.name || '',
        row.brand || '',
        row.categoryName || '',
        row.stock ?? '',
        row.salePrice1 ?? '',
        STATUS_LABELS[row.syncStatus] || row.syncStatus || ''
      ];
      DISPLAY_CHANNELS.forEach((ch) => {
        const cp = channelPriceRow(row, ch.id);
        cols.push(
          cp?.channelPrice ?? '',
          cp?.saleDiffPct ?? '',
          cp ? (isChannelOnSale(cp) ? 'evet' : 'hayır') : ''
        );
      });
      lines.push(cols.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(';'));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kanal-fiyat-stok-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`${source.length} satır Excel/CSV olarak indirildi.`);
  }

  function copyBarcode(barcode) {
    if (!barcode) return;
    navigator.clipboard?.writeText(barcode).then(() => {
      setStatus(`Barkod kopyalandı: ${barcode}`);
    }).catch(() => {
      setStatus('Kopyalama başarısız.', true);
    });
  }

  function onSelectAllChange() {
    const checks = els.body?.querySelectorAll('.bp-row-check') || [];
    checks.forEach((node) => {
      node.checked = els.selectAll.checked;
      const barcode = node.getAttribute('data-barcode');
      if (!barcode) return;
      if (els.selectAll.checked) selected.add(barcode);
      else selected.delete(barcode);
      node.closest('tr')?.classList.toggle('is-selected', node.checked);
    });
    updateSelectionToolbar();
  }

  function ensureSelectionToolbar() {
    if (els.selectionToolbar) return;
    const anchor = document.getElementById('bpFilterSummary') || document.querySelector('.bp-filter-card');
    if (!anchor) return;
    const bar = document.createElement('div');
    bar.id = 'bpSelectionToolbar';
    bar.className = 'bp-selection-toolbar';
    bar.hidden = true;
    bar.innerHTML =
      '<span class="bp-selection-count" id="bpSelectionCount">0 seçili</span>' +
      '<button type="button" class="bp-btn bp-btn-ghost bp-btn-danger" id="bpUnmapSelectedBtn">Eşleştirmeyi kaldır</button>';
    anchor.insertAdjacentElement('afterend', bar);
    els.selectionToolbar = bar;
    els.selectionCount = bar.querySelector('#bpSelectionCount');
    els.unmapSelectedBtn = bar.querySelector('#bpUnmapSelectedBtn');
    els.unmapSelectedBtn?.addEventListener('click', () => {
      unmapSelectedMasters().catch((error) => {
        setStatus(error.message, true);
        notifyUser(error.message, 'error');
      });
    });
  }

  function updateSelectionToolbar() {
    ensureSelectionToolbar();
    if (!els.selectionToolbar) return;
    if (isMatchingView()) {
      els.selectionToolbar.hidden = true;
      return;
    }
    const count = selected.size;
    els.selectionToolbar.hidden = count === 0;
    if (els.selectionCount) {
      els.selectionCount.textContent = `${count} seçili`;
    }
    if (els.unmapSelectedBtn) {
      const channelId = String(state.channelFocus || '').trim();
      els.unmapSelectedBtn.textContent = channelId
        ? `${channelLabel(channelId)} eşleştirmesini kaldır`
        : 'Tüm kanal eşleştirmelerini kaldır';
    }
  }

  function bindEvents() {
    els.body = document.getElementById('bpBody');
    els.tableHead = document.querySelector('.bp-table thead');
    els.status = document.getElementById('bpStatus');
    els.syncProgress = document.getElementById('bpSyncProgress');
    els.syncProgressLabel = document.getElementById('bpSyncProgressLabel');
    els.syncProgressPct = document.getElementById('bpSyncProgressPct');
    els.syncProgressBar = document.getElementById('bpSyncProgressBar');
    els.syncProgressTrack = document.getElementById('bpSyncProgressTrack');
    els.syncProgressDetail = document.getElementById('bpSyncProgressDetail');
    els.search = document.getElementById('bpSearch');
    els.pagination = document.getElementById('bpPagination');
    els.totalMeta = document.getElementById('bpTotalMeta');
    els.selectAll = document.getElementById('bpSelectAll');
    els.pageSize = document.getElementById('bpPageSize');
    els.brand = document.getElementById('bpFilterBrand');
    els.channel = document.getElementById('bpFilterChannel');
    els.channelSale = document.getElementById('bpFilterChannelSale');
    els.statusFilter = document.getElementById('bpFilterStatus');
    els.matchStatus = document.getElementById('bpFilterMatchStatus');
    els.confirmable = document.getElementById('bpFilterConfirmable');
    els.stock = document.getElementById('bpFilterStock');
    els.sort = document.getElementById('bpFilterSort');
    els.filterSummary = document.getElementById('bpFilterSummary');
    els.matchingToolbar = document.getElementById('bpMatchingToolbar');
    els.matchingToolbarHint = document.getElementById('bpMatchingToolbarHint');
    els.autoMatchBtn = document.getElementById('bpAutoMatchBtn');
    els.exportBtn = document.getElementById('bpExportBtn');
    els.modalOverlay = document.getElementById('bpModalOverlay');
    els.modalTitle = document.getElementById('bpModalTitle');
    els.modalLead = document.getElementById('bpModalLead');
    els.modalBody = document.getElementById('bpModalBody');
    els.modalConfirm = document.getElementById('bpModalConfirm');
    els.modalCancel = document.getElementById('bpModalCancel');
    els.cleanupBanner = document.getElementById('bpCleanupBanner');
    els.cleanupLead = document.getElementById('bpCleanupLead');
    els.cleanupList = document.getElementById('bpCleanupList');
    els.cleanupApplyAllBtn = document.getElementById('bpCleanupApplyAllBtn');
    els.cleanupDismissAllBtn = document.getElementById('bpCleanupDismissAllBtn');

    els.cleanupApplyAllBtn?.addEventListener('click', () => {
      if (!cleanupSuggestionsCache.length) return;
      const count = cleanupSuggestionsCache.length;
      if (!window.confirm(`${count} eşleştirmeyi kaldırmak istediğinize emin misiniz?`)) return;
      applyCleanupSuggestionIds([], { all: true }).catch((error) => notifyUser(error.message, 'error'));
    });
    els.cleanupDismissAllBtn?.addEventListener('click', () => {
      dismissCleanupSuggestionIds([], { all: true }).catch((error) => notifyUser(error.message, 'error'));
    });
    els.cleanupList?.addEventListener('click', (event) => {
      const applyBtn = event.target.closest('[data-apply-id]');
      if (applyBtn) {
        applyCleanupSuggestionIds([applyBtn.getAttribute('data-apply-id')]).catch((error) => notifyUser(error.message, 'error'));
        return;
      }
      const dismissBtn = event.target.closest('[data-dismiss-id]');
      if (dismissBtn) {
        dismissCleanupSuggestionIds([dismissBtn.getAttribute('data-dismiss-id')]).catch((error) => notifyUser(error.message, 'error'));
      }
    });

    document.getElementById('bpModalCancel')?.addEventListener('click', () => closeModal());
    els.modalOverlay?.addEventListener('click', (event) => {
      if (event.target === els.modalOverlay) closeModal();
    });
    document.getElementById('bpModalConfirm')?.addEventListener('click', async () => {
      if (!modalState?.onConfirm) return;
      try {
        const keepOpen = await modalState.onConfirm() === false;
        if (!keepOpen) closeModal();
      } catch (error) {
        notifyUser(`Gönderim başarısız — ${error.message}`, 'error');
        closeModal();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.modalOverlay && !els.modalOverlay.hidden) closeModal();
    });

    document.getElementById('bpSyncMasterBtn')?.addEventListener('click', () => syncMaster());
    document.getElementById('bpSyncYsBtn')?.addEventListener('click', () => syncCatalog('ys'));
    document.getElementById('bpSyncTgoBtn')?.addEventListener('click', () => syncCatalog('tgo'));
    document.getElementById('bpSyncGetirBtn')?.addEventListener('click', () => syncCatalog('getir'));
    document.getElementById('bpAutoMatchBtn')?.addEventListener('click', () => autoMatchPerfect());
    document.getElementById('bpExportBtn')?.addEventListener('click', () => exportCsv());
    document.getElementById('bpClearFilters')?.addEventListener('click', () => resetFilters());
    document.getElementById('bpApplyFilters')?.addEventListener('click', () => applyFilters());
    document.getElementById('bpViewMasters')?.addEventListener('click', () => setViewMode('masters'));
    document.getElementById('bpViewMatching')?.addEventListener('click', () => setViewMode('matching'));
    document.getElementById('bpViewOrphans')?.addEventListener('click', () => setViewMode('matching'));

    els.sort?.addEventListener('change', () => applyFilters());

    els.channel?.addEventListener('change', () => {
      if (els.channelSale) {
        els.channelSale.disabled = !String(els.channel?.value || '').trim();
        if (!els.channel?.value) els.channelSale.value = '';
      }
      applyFilters();
    });

    els.channelSale?.addEventListener('change', () => applyFilters());

    els.pageSize?.addEventListener('change', () => {
      readFiltersFromControls();
      limit = Math.max(10, Number(els.pageSize.value) || 20);
      page = 1;
      syncFiltersToUrl();
      loadProducts();
    });

    els.search?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      applyFilters();
    });

    els.selectAll?.addEventListener('change', onSelectAllChange);

    els.pagination?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      const next = Number(btn.getAttribute('data-page'));
      if (!Number.isFinite(next) || next < 1 || next > totalPages || next === page) return;
      page = next;
      syncFiltersToUrl();
      loadProducts();
    });

    els.body?.addEventListener('change', (event) => {
      const autoStock = event.target.closest('.bp-auto-stock-check');
      if (autoStock) {
        const masterId = autoStock.getAttribute('data-master-id');
        if (!masterId) return;
        setMasterAutoStock(masterId, autoStock.checked)
          .then(() => syncAutoStockSelectAllState())
          .catch((error) => {
            autoStock.checked = !autoStock.checked;
            notifyUser(error.message, 'error');
          });
        return;
      }
      const check = event.target.closest('.bp-row-check');
      if (!check) return;
      const barcode = check.getAttribute('data-barcode');
      if (!barcode) return;
      if (check.checked) selected.add(barcode);
      else selected.delete(barcode);
      check.closest('tr')?.classList.toggle('is-selected', check.checked);
      syncSelectAllState();
      updateSelectionToolbar();
    });

    els.body?.addEventListener('click', (event) => {
      const copyBtn = event.target.closest('[data-copy-barcode]');
      if (copyBtn) {
        copyBarcode(copyBtn.getAttribute('data-copy-barcode'));
        return;
      }

      const priceBtn = event.target.closest('[data-price-push]');
      if (priceBtn) {
        openPriceModal(priceBtn.getAttribute('data-price-push'), priceBtn.getAttribute('data-barcode'));
        return;
      }

      const stockBtn = event.target.closest('[data-stock-push]');
      if (stockBtn) {
        openStockModal(stockBtn.getAttribute('data-stock-push'), stockBtn.getAttribute('data-barcode'));
        return;
      }

      const unmapBtn = event.target.closest('[data-unmap-channel]');
      if (unmapBtn) {
        const rowBarcode = unmapBtn.closest('tr')?.getAttribute('data-barcode') || '';
        const productOnly = unmapBtn.hasAttribute('data-unmap-by-product');
        removeChannelMapping(
          unmapBtn.getAttribute('data-unmap-channel'),
          unmapBtn.getAttribute('data-channel-product'),
          {
            productName: findRowByBarcode(rowBarcode)?.name,
            benimposBarcode: productOnly ? '' : (unmapBtn.getAttribute('data-unmap-barcode') || rowBarcode)
          }
        ).catch((error) => notifyUser(error.message, 'error'));
        return;
      }

      const confirmBtn = event.target.closest('[data-confirm-match]');
      if (confirmBtn) {
        const row = findMatchingRow(confirmBtn.getAttribute('data-confirm-match') || '');
        confirmMatchRow(row).catch((error) => notifyUser(error.message, 'error'));
        return;
      }

      const searchBtn = event.target.closest('[data-search-master]');
      if (searchBtn) {
        const row = findMatchingRow(searchBtn.getAttribute('data-search-master') || '');
        openMasterSearchModal(row).catch((error) => notifyUser(error.message, 'error'));
        return;
      }

      const removeBtn = event.target.closest('[data-remove-match]');
      if (removeBtn) {
        const row = findMatchingRow(removeBtn.getAttribute('data-remove-match') || '');
        removeMatchRow(row).catch((error) => notifyUser(error.message, 'error'));
      }
    });
  }

  function init() {
    if (bootstrap.authRequired && common && !common.getStoredToken()) {
      common.redirectToLogin();
      return;
    }
    readFiltersFromUrl();
    bindEvents();
    document.querySelectorAll('.bp-view-tab').forEach((node) => {
      node.classList.toggle('is-active', node.getAttribute('data-view') === viewMode);
    });
    setFilterPanelMode();
    updateTableHead();
    applyFiltersToControls();
    loadSyncScheduleInfo();
    loadProducts();
    window.setTimeout(() => loadCleanupSuggestions(), 0);
    window.onPanelRefresh = () => loadProducts({ silent: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
