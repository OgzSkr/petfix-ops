'use strict';

(function bootBenimposProductsPage() {
  const bootstrap = window.__PANEL__ || {};
  const common = window.BuyBoxCommon;

  const DISPLAY_CHANNELS = [
    { id: 'getir', pushChannel: 'getir', planned: false },
    { id: 'uber-eats', pushChannel: 'trendyol_go', planned: false },
    { id: 'yemeksepeti', pushChannel: 'yemeksepeti', planned: false }
  ];

  const STATUS_LABELS = {
    ready: 'Hazır',
    diff: 'Fark Var',
    'no-stock': 'Stok Yok',
    waiting: 'Bekliyor'
  };

  const MATCHING_STATUS_LABELS = {
    unmapped: 'Eşleşmemiş',
    missing_master: 'BenimPOS\'ta yok',
    auto_matched: 'Otomatik öneri',
    pending: 'Onay bekliyor',
    review_required: 'İnceleme gerekli',
    barcode_conflict: 'Çoklu aday',
    manual_confirmed: 'Eşleştirildi'
  };

  const ORPHAN_STATUS_LABELS = {
    missing_master: 'BenimPOS\'ta yok',
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

  const state = {
    q: '',
    brand: '',
    channelFocus: '',
    channelSaleStatus: '',
    syncStatus: '',
    stock: '',
    matchStatus: '',
    confirmableOnly: ''
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

  function formatPosStock(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return { text: '—', cls: 'is-unknown' };
    if (n < 0) return { text: String(n), cls: 'is-negative' };
    if (n === 0) return { text: '0', cls: 'is-zero' };
    return { text: String(Math.round(n)), cls: 'is-in' };
  }

  function renderPosStockCell(stock) {
    const { text, cls } = formatPosStock(stock);
    return `<td class="bp-num bp-pos-stock ${cls}">${esc(text)}</td>`;
  }

  function setStatus(text, tone) {
    if (!els.status) return;
    els.status.textContent = text || '';
    const resolved = tone === true ? 'error' : (tone || 'neutral');
    els.status.classList.toggle('is-error', resolved === 'error');
    els.status.classList.toggle('is-success', resolved === 'success');
    els.status.classList.toggle('is-warn', resolved === 'warn');
    if (text) {
      els.status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      return 'Trendyol Go: çok sık güncelleme — 2–3 dakika bekleyip tekrar deneyin';
    }
    if (channel === 'trendyol_go' && /TGO batch/.test(message)) {
      return message.replace(/^TGO batch [^:]+:\s*/, 'Trendyol Go reddetti: ');
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

  function renderChannelCell(row, channel) {
    if (channel.planned) {
      return `<td class="bp-col-channel bp-channel-cell"><span class="bp-channel-empty" title="Getir stok/fiyat gönderimi yakında">—</span></td>`;
    }
    const cp = channelPriceRow(row, channel.id);
    if (!cp?.linked) {
      return '<td class="bp-col-channel bp-channel-cell"><span class="bp-channel-empty">—</span></td>';
    }
    const onSale = isChannelOnSale(cp);
    const saleClass = onSale ? 'is-on' : 'is-off';
    const saleTitle = onSale ? 'Satışta — stok gönder' : 'Satışta değil — stok gönder';
    const diff = formatDiffPct(cp.saleDiffPct);
    const barcode = String(row.benimposBarcode || '').trim();
    const canPush = Boolean(channel.pushChannel);
    const priceTitle = canPush ? 'Fiyat gönder' : 'Kanal fiyatı';
    return `<td class="bp-col-channel bp-channel-cell">
      <button type="button" class="bp-channel-price${canPush ? ' is-clickable' : ''}" ${canPush ? `data-price-push="${escAttr(channel.id)}" data-barcode="${escAttr(barcode)}"` : ''} title="${escAttr(priceTitle)}">${formatMoney(cp.channelPrice)}</button>
      <button type="button" class="bp-sale-indicator ${saleClass}${canPush ? ' is-clickable' : ''}" ${canPush ? `data-stock-push="${escAttr(channel.id)}" data-barcode="${escAttr(barcode)}"` : ''} title="${escAttr(canPush ? saleTitle : (onSale ? 'Satışta' : 'Satışta değil'))}" aria-label="${escAttr(canPush ? saleTitle : (onSale ? 'Satışta' : 'Satışta değil'))}"></button>
      <div class="bp-channel-diff ${diff.cls}">${esc(diff.text)}</div>
    </td>`;
  }

  function renderProductThumb(barcode) {
    if (!barcode) {
      return '<span class="bp-product-thumb bp-product-thumb--empty">—</span>';
    }
    return `<img class="bp-product-thumb" src="/api/product-thumb-img?barcode=${escAttr(barcode)}" alt="" width="40" height="40" loading="lazy" onerror="this.classList.add('bp-product-thumb--empty'); this.removeAttribute('src'); this.textContent='—';">`;
  }

  function renderStatusBadge(code) {
    const label = STATUS_LABELS[code] || code || '—';
    const cls = code === 'ready' ? 'ready'
      : code === 'diff' ? 'diff'
        : code === 'no-stock' ? 'no-stock'
          : 'waiting';
    return `<span class="bp-status-badge ${cls}">${esc(label)}</span>`;
  }

  function renderRows(rows) {
    rowsCache = applyPendingChannelPriceUpdates(rows);
    if (!rows.length) {
      els.body.innerHTML = `<tr><td colspan="${tableColspan()}" class="bp-empty">Ürün bulunamadı. «BenimPOS Sync» ile listeyi güncelleyin.</td></tr>`;
      return;
    }

    els.body.innerHTML = rows.map((row) => {
      const barcode = String(row.benimposBarcode || '').trim();
      const brand = String(row.brand || '').trim();
      const category = String(row.categoryName || '').trim();
      const meta = [brand, category].filter(Boolean).join(' • ');
      const checked = selected.has(barcode) ? ' checked' : '';

      return `<tr data-barcode="${escAttr(barcode)}" data-id="${escAttr(row.id)}" class="${selected.has(barcode) ? 'is-selected' : ''}">
        <td class="bp-col-check"><input type="checkbox" class="bp-row-check" data-barcode="${escAttr(barcode)}" aria-label="Seç"${checked}></td>
        <td class="bp-col-product">
          <div class="bp-product-cell">
            ${renderProductThumb(barcode)}
            <div>
              <div class="bp-product-name">${esc(row.name || '—')}</div>
              ${meta ? `<div class="bp-product-meta">${esc(meta)}</div>` : ''}
            </div>
          </div>
        </td>
        <td>
          <span class="bp-barcode">
            <span>${esc(barcode || '—')}</span>
            ${barcode ? `<button type="button" class="bp-copy-btn" data-copy-barcode="${escAttr(barcode)}" title="Kopyala">⧉</button>` : ''}
          </span>
        </td>
        ${renderPosStockCell(row.stock)}
        <td class="bp-num bp-pos-price">${formatMoney(row.salePrice1)}</td>
        ${DISPLAY_CHANNELS.map((channel) => renderChannelCell(row, channel)).join('')}
        <td class="bp-col-status">${renderStatusBadge(row.syncStatus)}</td>
      </tr>`;
    }).join('');

    syncSelectAllState();
  }

  function tableColspan() {
    return isMatchingView() ? 10 : 9;
  }

  function channelLabel(channelId) {
    const hit = DISPLAY_CHANNELS.find((item) => item.id === channelId);
    if (hit?.id === 'uber-eats') return 'Trendyol GO';
    if (hit?.id === 'yemeksepeti') return 'Yemeksepeti';
    if (hit?.id === 'getir') return 'Getir';
    return channelId || 'Kanal';
  }

  function updateTableHead() {
    if (!els.tableHead) return;
    if (isMatchingView()) {
      els.tableHead.innerHTML = `<tr>
        <th class="bp-col-thumb" scope="col">Görsel</th>
        <th class="bp-col-product" scope="col">Kanal ürün adı</th>
        <th scope="col">Marka</th>
        <th scope="col">Barkod / SKU</th>
        <th scope="col">Kanal</th>
        <th scope="col">Kanal fiyatı</th>
        <th scope="col">Eşleşme durumu</th>
        <th scope="col">Önerilen BenimPOS ürünü</th>
        <th scope="col">Güven</th>
        <th class="bp-col-actions" scope="col">İşlemler</th>
      </tr>`;
      return;
    }
    els.tableHead.innerHTML = `<tr>
      <th class="bp-col-check" scope="col"><input type="checkbox" id="bpSelectAll" aria-label="Tümünü seç"></th>
      <th class="bp-col-product" scope="col">Ürün</th>
      <th scope="col">Barkod</th>
      <th scope="col">BenimPOS Stok</th>
      <th scope="col">POS Satış</th>
      ${DISPLAY_CHANNELS.map((ch) => {
        const logo = window.PetFixChannelLogos?.render
          ? window.PetFixChannelLogos.render(ch.id, { size: 'sm' })
          : esc(ch.id);
        return `<th class="bp-col-channel" scope="col"><div class="bp-channel-head">${logo}</div></th>`;
      }).join('')}
      <th class="bp-col-status" scope="col">Durum</th>
    </tr>`;
    els.selectAll = document.getElementById('bpSelectAll');
    els.selectAll?.addEventListener('change', onSelectAllChange);
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
    if (els.channel) {
      els.channel.querySelector('option[value=""]')?.toggleAttribute('disabled', false);
    }
  }

  function setViewMode(nextView) {
    viewMode = nextView === 'matching' || nextView === 'orphans' ? 'matching' : 'masters';
    document.querySelectorAll('.bp-view-tab').forEach((node) => {
      node.classList.toggle('is-active', node.getAttribute('data-view') === viewMode);
    });
    page = 1;
    selected.clear();
    setFilterPanelMode();
    updateTableHead();
    syncFiltersToUrl();
    loadProducts();
  }

  function renderMatchingRows(rows) {
    matchingRowsCache = rows;
    rowsCache = [];
    if (!rows.length) {
      const hint = 'Eşleştirme bekleyen kanal ürünü bulunamadı. Önce katalog sync çalıştırın veya filtreleri gevşetin.';
      els.body.innerHTML = `<tr><td colspan="${tableColspan()}" class="bp-empty">${hint}</td></tr>`;
      return;
    }

    els.body.innerHTML = rows.map((row) => {
      const key = `${row.channelId}:${row.channelProductId}`;
      const barcode = String(row.channelBarcode || '').trim();
      const sku = String(row.channelSku || row.channelStockCode || row.channelProductId || '').trim();
      const brand = String(row.channelBrand || '').trim() || '—';
      const price = Number(row.salePrice);
      const canConfirm = Boolean(row.canConfirm && row.suggestedMasterProductId);
      return `<tr data-match-key="${escAttr(key)}" data-channel="${escAttr(row.channelId)}" data-channel-product="${escAttr(row.channelProductId)}">
        <td class="bp-col-thumb">${renderChannelImage(row)}</td>
        <td class="bp-col-product">
          <div class="bp-match-product bp-match-product--text">
            <div>
              <div class="bp-product-name">${esc(row.channelName || '—')}</div>
              ${row.systemComment ? `<div class="bp-product-meta">${esc(row.systemComment)}</div>` : ''}
            </div>
          </div>
        </td>
        <td>${esc(brand)}</td>
        <td>
          <div class="bp-code-stack">
            <span class="bp-barcode"><span>${esc(barcode || '—')}</span>${barcode ? `<button type="button" class="bp-copy-btn" data-copy-barcode="${escAttr(barcode)}" title="Kopyala">⧉</button>` : ''}</span>
            <span class="bp-sku">${esc(sku || '—')}</span>
          </div>
        </td>
        <td>${renderChannelBadge(row.channelId, row.channelLabel)}</td>
        <td class="bp-num">${formatMoney(Number.isFinite(price) && price > 0 ? price : null)}</td>
        <td>${renderMatchingStatusBadge(row.mappingStatus)}</td>
        <td>${renderMasterSuggestion(row)}</td>
        <td>${renderConfidenceBadge(row.confidenceScore)}</td>
        <td class="bp-col-actions">
          <div class="bp-match-actions">
            <button type="button" class="bp-btn bp-btn-primary bp-btn-xs" data-confirm-match="${escAttr(key)}" ${canConfirm ? '' : 'disabled'} title="Öneriyi onayla">Eşleştir</button>
            <button type="button" class="bp-btn bp-btn-ghost bp-btn-xs" data-search-master="${escAttr(key)}" title="BenimPOS ürünü ara">Ara</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function findMatchingRow(key) {
    return matchingRowsCache.find((row) => `${row.channelId}:${row.channelProductId}` === key) || null;
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
      queue: 'action'
    });
    if (state.q) params.set('q', state.q);
    if (state.channelFocus) params.set('channelId', state.channelFocus);
    if (state.matchStatus) params.set('status', state.matchStatus);
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
      sort: 'name',
      sortDir: 'asc'
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
    return params;
  }

  function activeFilterCount() {
    let count = 0;
    if (state.q) count += 1;
    if (state.brand) count += 1;
    if (state.channelFocus) count += 1;
    if (state.channelSaleStatus) count += 1;
    if (state.syncStatus) count += 1;
    if (state.stock) count += 1;
    if (state.matchStatus) count += 1;
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
    } else {
      if (state.matchStatus) params.set('matchStatus', state.matchStatus);
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
    state.matchStatus = params.get('matchStatus') || '';
    state.confirmableOnly = params.get('confirmable') === '1' ? '1' : '';
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
    if (els.matchStatus) els.matchStatus.value = state.matchStatus;
    if (els.confirmable) els.confirmable.value = state.confirmableOnly;
    if (els.stock) els.stock.value = state.stock;
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
    els.filterSummary.textContent = parts.join(' · ');
  }

  function resetFilters() {
    state.q = '';
    state.brand = '';
    state.channelFocus = '';
    state.channelSaleStatus = '';
    state.syncStatus = '';
    state.stock = '';
    state.matchStatus = '';
    state.confirmableOnly = '';
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
    state.matchStatus = String(els.matchStatus?.value || '').trim();
    state.confirmableOnly = String(els.confirmable?.value || '').trim();
    state.stock = String(els.stock?.value || '').trim();
  }

  function applyFilters() {
    readFiltersFromControls();
    page = 1;
    syncFiltersToUrl();
    loadProducts();
  }

  async function loadProducts(options = {}) {
    if (loading) return;
    loading = true;
    if (!options.silent) setStatus('Liste yükleniyor…');
    try {
      if (isMatchingView()) {
        await loadMatchingCenter();
        setStatus('');
        syncFiltersToUrl();
        return;
      }

      const response = await authFetch(`/api/product-matching/master-products?${buildQueryParams()}`);
      const data = await response.json();
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
    } catch (error) {
      els.body.innerHTML = `<tr><td colspan="${tableColspan()}" class="bp-empty">${esc(error.message)}</td></tr>`;
      setStatus(error.message, true);
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
    setStatus('BenimPOS senkronize ediliyor…');
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
      setStatus(`BenimPOS sync tamam — ${data.imported ?? data.total ?? ''} ürün`);
      page = 1;
      selected.clear();
      await loadProducts();
    } catch (error) {
      setStatus(error.message, true);
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
        const msg = data.progress?.message || 'BenimPOS sync devam ediyor…';
        setStatus(`${msg} (BenimPOS API yavaş — 15–25 dk sürebilir)`);
        continue;
      }
      if (data.error) throw new Error(data.error);
      const result = data.result || {};
      setStatus(`BenimPOS sync tamam — ${result.imported ?? result.total ?? ''} ürün`);
      page = 1;
      selected.clear();
      await loadProducts();
      return;
    }
    throw new Error('BenimPOS sync zaman aşımı — birkaç dakika sonra listeyi yenileyin.');
  }

  async function syncCatalog(kind) {
    const labels = { ys: 'Yemeksepeti', tgo: 'TGO', getir: 'Getir' };
    const label = labels[kind] || kind;
    setStatus(`${label} katalog çekiliyor…`);
    try {
      const paths = {
        ys: '/api/product-matching/sync-yemeksepeti-catalog',
        tgo: '/api/product-matching/sync-uber-catalog',
        getir: '/api/product-matching/sync-getir-catalog'
      };
      const path = paths[kind];
      if (!path) throw new Error('Bilinmeyen katalog sync');
      const payload = kind === 'ys' ? { maxPages: 120 } : {};
      const data = await apiPost(path, payload);
      const linked = data.barcodeLink?.linked;
      setStatus(`${label} katalog güncellendi${linked != null ? ` · ${linked} barkod bağlandı` : ''}`);
      await loadProducts();
    } catch (error) {
      setStatus(error.message, true);
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
    const label = options.displayLabel || (channel === 'yemeksepeti' ? 'Yemeksepeti' : channel === 'getir' ? 'Getir' : 'Trendyol GO');
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
  }

  function bindEvents() {
    els.body = document.getElementById('bpBody');
    els.tableHead = document.querySelector('.bp-table thead');
    els.status = document.getElementById('bpStatus');
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
    els.filterSummary = document.getElementById('bpFilterSummary');
    els.matchingToolbar = document.getElementById('bpMatchingToolbar');
    els.exportBtn = document.getElementById('bpExportBtn');
    els.modalOverlay = document.getElementById('bpModalOverlay');
    els.modalTitle = document.getElementById('bpModalTitle');
    els.modalLead = document.getElementById('bpModalLead');
    els.modalBody = document.getElementById('bpModalBody');
    els.modalConfirm = document.getElementById('bpModalConfirm');
    els.modalCancel = document.getElementById('bpModalCancel');

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

    els.channel?.addEventListener('change', (event) => {
      const channelFocus = String(event.target.value || '').trim();
      if (els.channelSale) {
        els.channelSale.disabled = !channelFocus;
        if (!channelFocus) els.channelSale.value = '';
      }
    });

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
      const check = event.target.closest('.bp-row-check');
      if (!check) return;
      const barcode = check.getAttribute('data-barcode');
      if (!barcode) return;
      if (check.checked) selected.add(barcode);
      else selected.delete(barcode);
      check.closest('tr')?.classList.toggle('is-selected', check.checked);
      syncSelectAllState();
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
    loadProducts();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
