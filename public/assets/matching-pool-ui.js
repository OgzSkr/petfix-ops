'use strict';

/** Ürün eşleştirme havuzu — aksiyon odaklı UI katmanı */
(function () {
  const DATA_QUALITY_LABELS = {
    missing_name: 'Ürün adı eksik',
    negative_stock: 'Negatif stok',
    missing_cost: 'Maliyet yok',
    missing_meta: 'Gramaj / varyant eksik'
  };

  const PRIMARY_ISSUE_LABELS = {
    match_pending: 'Otomatik eşleşme onay bekliyor',
    match_review: 'Eşleşme kontrol gerek',
    missing_master: 'BenimPOS\'ta kayıt yok',
    multi_candidate: 'Birden fazla aday / çakışma',
    unmapped: 'Kanal eşleşmesi yok',
    data_quality: 'Veri kalitesi sorunu',
    match_other: 'Eşleştirme sorunu'
  };

  const COMPARE_STATE_LABELS = { match: 'Eşleşti', diff: 'Farklı', missing: 'Eksik' };

  let deps = null;
  let comparePage = 1;
  let compareTotalPages = 1;
  let compareRowsCache = [];
  const compareSelection = new Map();

  function esc(value) {
    return deps?.esc?.(value) ?? String(value ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function escAttr(value) {
    return deps?.escAttr?.(value) ?? esc(value).replace(/"/g, '&quot;');
  }

  function formatMoney(value) {
    return deps?.formatMoney?.(value) ?? `₺${Number(value || 0).toFixed(2)}`;
  }

  function showToast(msg) {
    deps?.showToast?.(msg);
  }

  function integrate(h) {
    deps = h;
    bindActionKpis();
    bindComparePanel();
    bindDetailDrawerExtras();
    document.body.classList.add('matching-pool-ui-ready');
  }

  function bindActionKpis() {
    document.querySelectorAll('.matching-action-kpi').forEach((card) => {
      card.addEventListener('click', () => applyActionFilter(card.dataset.actionFilter));
    });
  }

  function applyActionFilter(filter) {
    if (!filter) return;
    if (filter === 'bulk_confirmable') {
      deps.switchTab('compare');
      const qf = document.getElementById('compareQualityFilter');
      if (qf) qf.value = 'confirmable';
      loadComparePage(1);
      return;
    }
    if (filter === 'pending_match') {
      deps.switchTab('workbench');
      const mode = document.getElementById('workbenchQueueMode');
      if (mode) mode.value = 'all';
      deps.openWorkbenchQueue?.('all');
      return;
    }
    if (filter === 'missing_master') {
      deps.switchTab('workbench');
      deps.openWorkbenchQueue?.('missing_master');
      return;
    }
    if (filter === 'multi_candidate') {
      deps.switchTab('compare');
      loadComparePage(1);
      return;
    }
    const input = document.getElementById('masterActionFilter');
    if (input) input.value = filter;
    document.querySelectorAll('.matching-action-kpi').forEach((el) => {
      el.classList.toggle('active', el.dataset.actionFilter === filter);
    });
    deps.switchTab('master');
    deps.setMasterPage?.(1);
    deps.loadMasterProducts();
  }

  function renderMasterRows(rows) {
    const masterBody = document.getElementById('masterProductsBody');
    const colCount = 8;
    if (!masterBody) return;
    if (!rows.length) {
      masterBody.innerHTML = `<tr><td colspan="${colCount}" class="matching-loading">Kayıt yok. KPI kartlarından filtreleyin veya arama yapın.</td></tr>`;
      return;
    }
    masterBody.innerHTML = rows.map((row) => {
      const displayName = deps.masterDisplayName(row);
      const stockCodeLine = row.stockCode ? `<div class="matching-product-meta muted">${esc(row.stockCode)}</div>` : '';
      const summary = row.actionSummary || {};
      return `<tr data-master-id="${escAttr(row.id)}" class="master-row-clickable" tabindex="0">
        <td class="col-master-product">
          <div class="matching-product-name">${esc(displayName)}</div>
          <div class="matching-product-meta muted">${esc(row.brand || row.categoryName || '')}</div>
        </td>
        <td class="matching-barcode col-master-barcode">
          <button type="button" class="linkish master-barcode-btn" data-barcode="${escAttr(row.benimposBarcode)}">${esc(row.benimposBarcode)}</button>
          ${stockCodeLine}
        </td>
        <td class="col-master-num ${Number(row.stock) < 0 ? 'cell-warn' : ''}">${esc(row.stock)}</td>
        <td class="col-master-num ${Number(row.buyingPrice) <= 0 ? 'cell-warn' : ''}">${Number(row.buyingPrice) > 0 ? formatMoney(row.buyingPrice) : '<span class="muted">—</span>'}</td>
        <td class="col-master-match">${renderMatchStatusCell(row)}</td>
        <td class="col-master-action">${renderActionStatusCell(row, summary)}</td>
        <td class="col-master-updated">${deps.formatMasterUpdated(row)}</td>
        <td class="matching-actions-cell col-master-actions">
          <button type="button" class="btn-mini btn-brown btn-master-inspect" data-master-id="${escAttr(row.id)}">İncele</button>
        </td>
      </tr>`;
    }).join('');
    deps.initMasterTableDelegation?.();
  }

  function renderMatchStatusCell(row) {
    const logos = window.PetFixChannelLogos;
    if (!logos) return '—';
    const flags = row.qualityFlags || {};
    const badges = (deps.SALES_CHANNELS || []).map((channel) => {
      if (channel.status === 'planned') {
        return logos.render(channel.id, { state: 'wait', size: 'sm', title: `${channel.label}: yakında` });
      }
      const status = row.channelMappings?.[channel.id] || 'unmapped';
      if (status === 'manual_confirmed') {
        return logos.render(channel.id, { state: 'ok', size: 'sm', title: `${channel.label}: bağlı` });
      }
      if (['auto_matched', 'pending', 'review_required'].includes(status)) {
        return logos.render(channel.id, { state: 'warn', size: 'sm', title: `${channel.label}: karar gerek` });
      }
      if (['missing_master', 'barcode_conflict'].includes(status)) {
        return logos.render(channel.id, { state: 'danger', size: 'sm', title: `${channel.label}: problemli` });
      }
      if (flags.missingCost || flags.negativeStock) {
        return logos.render(channel.id, { state: 'none', size: 'sm', title: `${channel.label}: eksik` });
      }
      return logos.render(channel.id, { state: 'none', size: 'sm', title: `${channel.label}: eşleşmedi` });
    }).join('');
    return `<div class="master-match-strip">${badges}</div>`;
  }

  function renderActionStatusCell(row, summary) {
    const dqIssues = summary.dqIssues || [];
    const dqTitles = dqIssues.map((code) => DATA_QUALITY_LABELS[code] || code).join(' · ');
    const dq = dqIssues.length
      ? `<span class="action-tag action-tag--dq" title="${escAttr(dqTitles)}">${dqIssues.length} veri sorunu</span>`
      : '';
    const match = summary.primaryIssue && summary.primaryIssue !== 'data_quality'
      ? `<span class="action-tag action-tag--match">${esc(PRIMARY_ISSUE_LABELS[summary.primaryIssue] || summary.primaryIssue)}</span>`
      : '';
    const hint = summary.actionHint
      ? `<div class="action-hint muted">${esc(summary.actionHint)}</div>`
      : '';
    if (!dq && !match) {
      return '<span class="action-tag action-tag--ok">Hazır</span>';
    }
    return `<div class="action-status-stack">${match}${dq}${hint}</div>`;
  }

  function enhanceDetailBody(master, payload) {
    const issueEl = document.getElementById('masterDetailIssue');
    const sugEl = document.getElementById('masterDetailSuggestion');
    const nextEl = document.getElementById('masterDetailNextStep');
    const summary = master.actionSummary || summarizeFromPayload(master, payload);
    if (issueEl) {
      const parts = [];
      if (summary.matchLabel) parts.push(summary.matchLabel);
      if (summary.dqLabels?.length) parts.push(summary.dqLabels.join(' · '));
      issueEl.textContent = parts.length ? parts.join(' · ') : 'Belirgin sorun yok';
    }
    if (sugEl) {
      const slot = (payload.channelSlots || []).find((s) =>
        ['auto_matched', 'pending', 'review_required'].includes(s.mappingStatus));
      sugEl.textContent = slot?.mapping?.channelName
        ? `${slot.channelLabel}: ${slot.mapping.channelName}`
        : (summary.suggestion || 'Manuel eşleştirme gerekebilir');
    }
    if (nextEl) nextEl.textContent = summary.actionHint || 'İncele ve karar ver';

    const body = document.getElementById('masterDetailBody');
    if (!body || body.querySelector('.master-detail-compare-block')) return;

    const pendingSlot = (payload.channelSlots || []).find((s) =>
      ['auto_matched', 'pending', 'review_required'].includes(s.mappingStatus));
    if (pendingSlot?.mapping) {
      const compareHtml = renderInlineCompareHint(master, pendingSlot);
      if (compareHtml) {
        body.insertAdjacentHTML('beforeend', compareHtml);
      }
    }
  }

  function summarizeFromPayload(master, payload) {
    const flags = master.qualityFlags || payload.master?.qualityFlags || {};
    const dqLabels = [];
    if (flags.missingName) dqLabels.push(DATA_QUALITY_LABELS.missing_name);
    if (flags.negativeStock) dqLabels.push(DATA_QUALITY_LABELS.negative_stock);
    if (flags.missingCost) dqLabels.push(DATA_QUALITY_LABELS.missing_cost);
    if (flags.missingMeta) dqLabels.push(DATA_QUALITY_LABELS.missing_meta);
    const pending = (payload.channelSlots || []).find((s) =>
      ['auto_matched', 'pending', 'review_required', 'missing_master'].includes(s.mappingStatus));
    let matchLabel = '';
    if (pending) {
      matchLabel = deps.STATUS_LABELS?.[pending.mappingStatus] || pending.mappingStatus;
    }
    return {
      dqLabels,
      matchLabel,
      actionHint: master.actionSummary?.actionHint || 'Kanal eşleştirmelerini gözden geçir',
      suggestion: pending?.mapping ? `${pending.channelLabel} bağlantısı var` : ''
    };
  }

  function renderInlineCompareHint(master, slot) {
    return `<section class="master-detail-section master-detail-compare-block">
      <h4>Fiyat karşılaştırması</h4>
      <dl class="master-detail-dl">
        <dt>BenimPOS satış</dt><dd>${formatMoney(master.salePrice1)}</dd>
        <dt>Kanal fiyat</dt><dd>${slot.mapping?.channelSalePrice ? formatMoney(slot.mapping.channelSalePrice) : '—'}</dd>
      </dl>
    </section>`;
  }

  function bindDetailDrawerExtras() {
    document.getElementById('masterDetailRejectBtn')?.addEventListener('click', async () => {
      const target = deps.getMasterDetailTarget?.();
      if (!target) return;
      const pending = (target.channelMappingDetails || []).find((m) =>
        ['auto_matched', 'pending', 'review_required'].includes(m.status));
      if (!pending) {
        showToast('Reddedilecek bekleyen eşleştirme yok.');
        return;
      }
      if (!confirm('Bu eşleştirme önerisini reddetmek (kaldırmak) istiyor musunuz?')) return;
      try {
        const response = await window.BuyBoxCommon.authFetch('/api/product-matching/remove-mapping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: pending.channelId,
            channelProductId: pending.channelProductId
          })
        });
        if (!response.ok) throw new Error('Reddetme başarısız');
        showToast('Eşleştirme reddedildi.');
        deps.closeMasterDetailDrawer?.();
        deps.loadMasterProducts?.();
        deps.loadOpsSummary?.();
      } catch (err) {
        showToast(err.message || 'Hata');
      }
    });

    document.getElementById('masterDetailPickBtn')?.addEventListener('click', () => {
      const target = deps.getMasterDetailTarget?.();
      if (!target) return;
      deps.closeMasterDetailDrawer?.();
      const pending = (target.channelMappingDetails || []).find((m) => m.channelProductId);
      if (pending) {
        deps.openChannelFromMaster?.({
          channelId: pending.channelId,
          channelProductId: pending.channelProductId,
          barcode: target.benimposBarcode,
          status: pending.status
        });
      } else {
        deps.openMasterEditModal?.(target);
      }
    });
  }

  function bindComparePanel() {
    document.getElementById('compareReloadBtn')?.addEventListener('click', () => loadComparePage(1));
    document.getElementById('compareSearch')?.addEventListener('input', deps.debounce?.(() => loadComparePage(1), 350) || (() => loadComparePage(1)));
    document.getElementById('compareQualityFilter')?.addEventListener('change', () => loadComparePage(1));
    document.getElementById('comparePrevPage')?.addEventListener('click', () => {
      if (comparePage > 1) loadComparePage(comparePage - 1);
    });
    document.getElementById('compareNextPage')?.addEventListener('click', () => {
      if (comparePage < compareTotalPages) loadComparePage(comparePage + 1);
    });
    document.getElementById('compareSelectAll')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      compareRowsCache.forEach((row) => {
        const key = compareRowKey(row);
        if (checked && row.canConfirm) compareSelection.set(key, row);
        else compareSelection.delete(key);
      });
      renderCompareRows(compareRowsCache);
      updateCompareBulkBar();
    });
    document.getElementById('compareBulkClearBtn')?.addEventListener('click', () => {
      compareSelection.clear();
      renderCompareRows(compareRowsCache);
      updateCompareBulkBar();
    });
    document.getElementById('compareBulkConfirmBtn')?.addEventListener('click', () => bulkCompareConfirm());
    document.getElementById('compareBulkRejectBtn')?.addEventListener('click', () => bulkCompareReject());
  }

  function compareRowKey(row) {
    return `${row.channelId}:${row.channelProductId}`;
  }

  async function loadComparePage(page = 1) {
    const body = document.getElementById('compareProductsBody');
    if (!body) return;
    comparePage = page;
    body.innerHTML = '<tr><td colspan="7" class="matching-loading">Yükleniyor…</td></tr>';
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '50');
    params.set('queue', 'action');
    const q = document.getElementById('compareSearch')?.value?.trim();
    if (q) params.set('q', q);
    const quality = document.getElementById('compareQualityFilter')?.value;
    if (quality) params.set('quality', quality);
    const channel = document.getElementById('compareChannelFilter')?.value;
    if (channel) params.set('channelId', channel);

    try {
      const response = await window.BuyBoxCommon.authFetch('/api/product-matching/workbench?' + params);
      if (!response.ok) throw new Error('Liste yüklenemedi');
      const data = await response.json();
      compareRowsCache = data.rows || [];
      compareTotalPages = data.totalPages || 1;
      renderCompareRows(compareRowsCache);
      const meta = document.getElementById('compareFooterMeta');
      if (meta) meta.textContent = `${data.total || 0} kayıt · sayfa ${comparePage}/${compareTotalPages}`;
      const label = document.getElementById('comparePageLabel');
      if (label) label.textContent = `Sayfa ${comparePage}`;
      document.getElementById('comparePrevPage').disabled = comparePage <= 1;
      document.getElementById('compareNextPage').disabled = comparePage >= compareTotalPages;
      const tabCount = document.getElementById('compareTabCount');
      if (tabCount) tabCount.textContent = data.total ? `(${data.total})` : '';
    } catch (err) {
      body.innerHTML = `<tr><td colspan="7" class="matching-loading">${esc(err.message)}</td></tr>`;
    }
  }

  function renderCompareRows(rows) {
    const body = document.getElementById('compareProductsBody');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="matching-loading">Karşılaştırılacak kayıt yok.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((row) => {
      const key = compareRowKey(row);
      const selected = compareSelection.has(key);
      const score = row.confidenceScore != null ? `%${Math.round(row.confidenceScore)}` : '—';
      const scoreClass = Number(row.confidenceScore) >= 88 ? 'compare-score--ok' : (Number(row.confidenceScore) >= 55 ? 'compare-score--warn' : 'compare-score--bad');
      const fields = (row.compareFields || []).map((f) =>
        `<span class="compare-field compare-field--${f.state}" title="${escAttr(f.label)}: ${escAttr(f.channel)} → ${escAttr(f.master)}">${esc(f.label)}: ${esc(COMPARE_STATE_LABELS[f.state] || f.state)}</span>`
      ).join('');
      const issue = row.masterLinkConflict
        ? 'Birden fazla aday'
        : (row.suggestionReason || deps.STATUS_LABELS?.[row.mappingStatus] || row.mappingStatus);
      const next = row.canConfirm ? 'Onayla' : (row.mappingStatus === 'missing_master' ? 'BenimPOS\'ta ara' : 'Manuel seç');
      return `<tr data-compare-key="${escAttr(key)}" class="compare-row${row.suspicious ? ' compare-row--warn' : ''}">
        <td><input type="checkbox" class="compare-row-check" data-key="${escAttr(key)}" ${selected ? 'checked' : ''} ${row.canConfirm ? '' : 'disabled'}></td>
        <td><strong>${esc(row.channelName)}</strong><div class="muted">${esc(row.channelBarcode || row.channelProductId)}</div></td>
        <td>${row.suggestedMasterName ? `<strong>${esc(row.suggestedMasterName)}</strong><div class="muted">${esc(row.linkedMasterBarcode)}</div>` : '<span class="muted">—</span>'}</td>
        <td><span class="compare-score ${scoreClass}">${esc(score)}</span></td>
        <td><div class="compare-fields">${fields || '<span class="muted">—</span>'}</div></td>
        <td><div class="compare-trio"><span class="compare-trio-issue">${esc(issue)}</span><span class="compare-trio-next muted">${esc(next)}</span></div></td>
        <td class="matching-actions-cell">
          ${row.canConfirm ? `<button type="button" class="btn-mini btn-brown btn-compare-confirm" data-key="${escAttr(key)}">Onayla</button>` : ''}
          <button type="button" class="btn-mini ghost btn-compare-map" data-key="${escAttr(key)}">Seç</button>
          <button type="button" class="btn-mini ghost btn-compare-reject" data-key="${escAttr(key)}">Reddet</button>
        </td>
      </tr>`;
    }).join('');

    body.querySelectorAll('.compare-row-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const row = compareRowsCache.find((r) => compareRowKey(r) === cb.dataset.key);
        if (!row) return;
        if (cb.checked) compareSelection.set(cb.dataset.key, row);
        else compareSelection.delete(cb.dataset.key);
        updateCompareBulkBar();
      });
    });
    body.querySelectorAll('.btn-compare-confirm').forEach((btn) => {
      btn.addEventListener('click', () => confirmCompareRow(btn.dataset.key));
    });
    body.querySelectorAll('.btn-compare-map').forEach((btn) => {
      btn.addEventListener('click', () => openCompareMap(btn.dataset.key));
    });
    body.querySelectorAll('.btn-compare-reject').forEach((btn) => {
      btn.addEventListener('click', () => rejectCompareRow(btn.dataset.key));
    });
  }

  function updateCompareBulkBar() {
    const bar = document.getElementById('compareBulkBar');
    const count = compareSelection.size;
    if (bar) bar.hidden = count <= 0;
    const meta = document.getElementById('compareBulkMeta');
    if (meta) meta.textContent = `${count} seçili`;
    document.getElementById('compareBulkConfirmBtn').disabled = count <= 0;
    document.getElementById('compareBulkRejectBtn').disabled = count <= 0;
  }

  async function confirmCompareRow(key) {
    const row = compareRowsCache.find((r) => compareRowKey(r) === key);
    if (!row?.canConfirm) return;
    try {
      const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: row.channelId,
          channelProductId: row.channelProductId,
          masterProductId: row.suggestedMasterProductId
        })
      });
      if (!response.ok) throw new Error('Onay başarısız');
      showToast('Eşleştirme onaylandı.');
      compareSelection.delete(key);
      loadComparePage(comparePage);
      deps.loadOpsSummary?.();
    } catch (err) {
      showToast(err.message || 'Hata');
    }
  }

  async function rejectCompareRow(key) {
    const row = compareRowsCache.find((r) => compareRowKey(r) === key);
    if (!row) return;
    try {
      const response = await window.BuyBoxCommon.authFetch('/api/product-matching/remove-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: row.channelId,
          channelProductId: row.channelProductId
        })
      });
      if (!response.ok) throw new Error('Reddetme başarısız');
      showToast('Eşleştirme reddedildi.');
      compareSelection.delete(key);
      loadComparePage(comparePage);
      deps.loadOpsSummary?.();
    } catch (err) {
      showToast(err.message || 'Hata');
    }
  }

  function openCompareMap(key) {
    const row = compareRowsCache.find((r) => compareRowKey(r) === key);
    if (!row) return;
    deps.openMapModal?.(row);
  }

  async function bulkCompareConfirm() {
    const items = [...compareSelection.values()].filter((r) => r.canConfirm);
    if (!items.length) return;
    if (!confirm(`${items.length} eşleştirmeyi onaylamak istiyor musunuz?`)) return;
    try {
      const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm-mappings-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((r) => ({
            channelId: r.channelId,
            channelProductId: r.channelProductId,
            masterProductId: r.suggestedMasterProductId
          }))
        })
      });
      if (!response.ok) throw new Error('Toplu onay başarısız');
      const result = await response.json();
      showToast(`${result.confirmed || 0} eşleştirme onaylandı.`);
      compareSelection.clear();
      loadComparePage(comparePage);
      deps.loadOpsSummary?.();
    } catch (err) {
      showToast(err.message || 'Hata');
    }
  }

  async function bulkCompareReject() {
    const items = [...compareSelection.values()];
    if (!items.length) return;
    if (!confirm(`${items.length} eşleştirmeyi reddetmek istiyor musunuz?`)) return;
    try {
      const response = await window.BuyBoxCommon.authFetch('/api/product-matching/remove-channel-mappings-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((r) => ({
            channelId: r.channelId,
            channelProductId: r.channelProductId
          }))
        })
      });
      if (!response.ok) throw new Error('Toplu reddetme başarısız');
      const result = await response.json();
      showToast(`${result.removed || 0} eşleştirme kaldırıldı.`);
      compareSelection.clear();
      loadComparePage(comparePage);
      deps.loadOpsSummary?.();
    } catch (err) {
      showToast(err.message || 'Hata');
    }
  }

  function updateActionKpis(data) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val ?? '—';
    };
    set('kpiPendingMatch', data.pendingMatch);
    set('kpiNotInBenimpos', data.notInBenimpos);
    set('kpiMultiCandidate', data.multiCandidate);
    set('kpiDataIssues', data.dataIssueMasters);
    set('kpiBulkConfirmable', data.bulkConfirmable);
    const wbCount = document.getElementById('workbenchTabCount');
    if (wbCount) wbCount.textContent = data.pendingMatch ? `(${data.pendingMatch})` : '';
  }

  window.MatchingPoolUi = {
    integrate,
    renderMasterRows,
    enhanceDetailBody,
    loadComparePage,
    updateActionKpis,
    applyActionFilter
  };
})();
