(function () {
'use strict';

const bootstrapEl = document.getElementById('bootstrap');
const bootstrap = bootstrapEl ? JSON.parse(bootstrapEl.textContent) : {};
const backdrop = document.getElementById('benimposSaleBackdrop');
const bodyEl = document.getElementById('benimposSaleBody');
const actionsEl = document.getElementById('benimposSaleActions');
const titleEl = document.getElementById('benimposSaleTitle');
const confirmBtn = document.getElementById('benimposSaleConfirm');
const cancelBtn = document.getElementById('benimposSaleCancel');
const closeBtn = document.getElementById('benimposSaleClose');

const CHANNEL_ID = bootstrap.channelId || 'uber-eats';
const CHANNEL_LABEL = bootstrap.channelLabel || 'Kanal';

let currentOrder = null;
let currentPreview = null;
let currentDays = 14;
let currentChannelId = CHANNEL_ID;
let currentChannelLabel = CHANNEL_LABEL;
let masterSearchTimer = null;

const STATUS_LABELS = {
  auto_matched: 'Otomatik — onay gerek',
  manual_confirmed: 'Manuel onaylı',
  pending: 'Bekliyor',
  review_required: 'Kontrol gerek',
  barcode_conflict: 'Barkod çakışması',
  missing_master: 'BenimPOS\'ta yok',
  unmapped: 'Eşleşmedi'
};

if (bootstrap.benimposSaleEnabled && backdrop) {
  closeBtn?.addEventListener('click', closeBenimposSaleModal);
  cancelBtn?.addEventListener('click', closeBenimposSaleModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeBenimposSaleModal();
  });
  confirmBtn?.addEventListener('click', submitBenimposSale);
}

window.BuyBoxBenimposSale = {
  openPreview(orderRow, days = 14) {
    if (!bootstrap.benimposSaleEnabled) return;
    currentOrder = orderRow;
    currentDays = days;
    currentChannelId = orderRow.channel || orderRow.channelId || bootstrap.channelId || 'uber-eats';
    currentChannelLabel = orderRow.channelLabel
      || (currentChannelId === 'uber-eats' ? 'Trendyol Go' : '')
      || bootstrap.channelLabel
      || 'Kanal';
    titleEl.textContent = `BenimPOS Ön İzleme — #${orderRow.orderNumber}`;
    bodyEl.innerHTML = '<p class="matching-loading">Eşleştirme kontrol ediliyor…</p>';
    actionsEl.hidden = true;
    confirmBtn.disabled = true;
    backdrop.classList.add('open');
    loadPreview();
  }
};

async function loadPreview() {
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/benimpos/preview-channel-sale', {
      method: 'POST',
      body: JSON.stringify({
        channelId: currentChannelId,
        orderNumber: currentOrder.orderNumber,
        days: currentDays
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      bodyEl.innerHTML = `<p class="orders-warn-box">${esc(data.error || 'Ön izleme yüklenemedi.')}</p>`;
      return;
    }
    currentPreview = data;
    renderPreview(data);
  } catch (error) {
    bodyEl.innerHTML = `<p class="orders-warn-box">${esc(error.message || 'Bağlantı hatası')}</p>`;
  }
}

function renderPreview(data) {
  const level = data.saleConfirmLevel === 'manual_only' ? 'manuel onaylı' : 'otomatik veya manuel';
  const policyNote =
    `<p class="benimpos-policy-note">Gerçek BenimPOS satışı <strong>eşleştirme onayı</strong> olmadan yapılamaz. ` +
    `Gerekli seviye: <strong>${esc(level)}</strong>. Engelli satırları buradan eşleştirebilir veya Ana Ürün Havuzu'na gidebilirsiniz.</p>`;

  const readiness = data.channelReadiness;
  let readinessHtml = '';
  if (readiness && !readiness.readyForSales) {
    readinessHtml =
      `<div class="benimpos-readiness-box">` +
        `<strong>Kanal henüz satışa hazır değil</strong>` +
        `<ul>${(readiness.blockers || []).slice(0, 4).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` +
        `<div class="benimpos-readiness-links">` +
          (readiness.nextSteps || []).map((s) =>
            `<a href="${esc(s.href)}" class="btn-mini">${esc(s.label)}</a>`
          ).join(' ') +
          `<a href="/hzlmrktops/urunler?tab=${escAttr(currentChannelId)}" class="btn-mini ghost">Ana Ürün Havuzu</a>` +
        `</div></div>`;
  }

  const canSend = data.canSendRealSale ?? data.canSend;
  const summaryClass = canSend ? 'benimpos-summary benimpos-summary--ok' : 'benimpos-summary benimpos-summary--blocked';
  const financialsHtml = renderFinancialSummary(data.financials);
  const summaryHtml =
    `<div class="${summaryClass}">` +
      `<strong>${canSend ? 'Eşleştirme tamam — gönderime hazır' : 'Eşleştirme eksik — gönderim engelli'}</strong>` +
      `<span>${data.sendableLines}/${data.totalLines} satır satışa uygun` +
      (data.blockedLines ? ` · ${data.blockedLines} engelli` : '') +
      '</span>' +
      (data.blockReasons?.length ? `<ul>${data.blockReasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '') +
    '</div>';

  const rows = (data.lines || []).map((line, idx) => renderPreviewRow(line, idx)).join('');

  bodyEl.innerHTML =
    policyNote + readinessHtml + financialsHtml + summaryHtml +
    '<div class="benimpos-preview-table-wrap"><table class="benimpos-preview-table">' +
    `<thead><tr><th>${esc(currentChannelLabel)} ürün</th><th>BenimPOS</th><th>Stok</th><th>Alış</th><th>Eşleşme</th><th>Durum / İşlem</th></tr></thead>` +
    `<tbody>${rows || '<tr><td colspan="6">Satır yok</td></tr>'}</tbody></table></div>`;

  bindPreviewRowActions();

  actionsEl.hidden = false;
  confirmBtn.disabled = !canSend;
  confirmBtn.textContent = canSend ? 'BenimPOS\'a Gönder' : 'Eşleştirme Tamamlanmadan Gönderilemez';
}

function renderFinancialSummary(financials) {
  if (!financials || !financials.grossAmount) return '';
  return `<div class="benimpos-financials" aria-label="Uber finans özeti">
    <strong>BenimPOS satış tutarı (Uber hakediş)</strong>
    <div class="benimpos-financials-grid">
      <span>Brüt fiyat</span><strong>₺${formatMoney(financials.grossAmount)}</strong>
      <span>Satıcı indirimi</span><strong class="is-deduct">−₺${formatMoney(financials.sellerDiscount)}</strong>
      <span>Komisyon</span><strong class="is-deduct">−₺${formatMoney(financials.commissionAmount)}</strong>
      <span>Net hakediş</span><strong class="is-net">₺${formatMoney(financials.netAmount)}</strong>
    </div>
    <p class="muted benimpos-financials-note">Ürün satırları brüt fiyatla gider; indirim + komisyon BenimPOS <code>discountRate</code> (%${formatMoney(financials.discountRate)}) ile düşülür.</p>
  </div>`;
}

function renderPreviewRow(line, idx) {
  const ok = line.realSaleAllowed ?? line.saleAllowed;
  const rowClass = ok ? 'benimpos-line benimpos-line--ok' : 'benimpos-line benimpos-line--blocked';
  const warn = line.realSaleWarning || line.warning
    || (line.warnings || []).join(' · ')
    || '—';
  const actions = renderLineActions(line, idx, ok);
  const inlineMatch = !ok ? renderInlineMatchPanel(line, idx) : '';

  return `<tr class="${rowClass}" data-line-idx="${idx}">
    <td><div class="benimpos-line-name">${esc(line.channelProductName || '—')}</div>
      <div class="benimpos-line-meta">${esc(currentChannelLabel)}: ${esc(line.channelBarcode)} · ${esc(line.quantity)} adet</div></td>
    <td>${line.masterName ? `<div>${esc(line.masterName)}</div><div class="benimpos-line-meta">${esc(line.masterBarcode)}</div>` : '—'}</td>
    <td>${line.stock != null ? esc(line.stock) : '—'}</td>
    <td>${line.buyingPrice ? '₺' + formatMoney(line.buyingPrice) : '—'}</td>
    <td>${badge(line.mappingStatus, ok)}</td>
    <td class="benimpos-line-actions-cell">
      <span class="benimpos-warn">${esc(warn)}</span>
      ${actions}
      ${inlineMatch}
    </td>
  </tr>`;
}

function renderLineActions(line, idx, ok) {
  if (ok) return '';

  const parts = [];

  if (line.needsManualConfirm && line.masterProductId) {
    parts.push(
      `<button type="button" class="btn-mini btn-confirm-line" data-idx="${idx}" ` +
      `data-cp="${escAttr(line.channelProductId || line.channelBarcode)}" ` +
      `data-master="${escAttr(line.masterProductId)}">Eşleştirmeyi Onayla</button>`
    );
  }

  if (line.needsInlineMatch || (!ok && line.mappingStatus !== 'auto_matched')) {
    parts.push(
      `<button type="button" class="btn-mini btn-toggle-inline-match" data-idx="${idx}">Burada eşleştir</button>`
    );
  }

  if (line.poolMatchUrl) {
    parts.push(`<a href="${esc(line.poolMatchUrl)}" class="btn-mini ghost">Havuzda aç</a>`);
  }

  return parts.length
    ? `<div class="benimpos-line-action">${parts.join(' ')}</div>`
    : '';
}

function renderInlineMatchPanel(line, idx) {
  const cpId = line.channelProductId || line.channelBarcode;
  const seedQuery = line.suggestedMasterProductId
    ? (line.masterBarcode || line.channelBarcode || '')
    : (line.channelBarcode || line.channelProductName || '');

  return `<div class="benimpos-inline-match" id="inlineMatch-${idx}" hidden>
    <label class="benimpos-inline-label">Ana ürün ara (barkod veya ad)</label>
    <input type="search" class="benimpos-inline-search" data-idx="${idx}" data-cp="${escAttr(cpId)}"
      data-name="${escAttr(line.channelProductName || '')}" value="${escAttr(seedQuery)}" placeholder="Royal Canin, 318255…">
    <div class="benimpos-inline-results" id="inlineResults-${idx}"></div>
    <p class="muted benimpos-inline-hint">Onay sonrası ön izleme yenilenir; tüm satırlar yeşil olunca gönderebilirsiniz.</p>
  </div>`;
}

function bindPreviewRowActions() {
  bodyEl.querySelectorAll('.btn-confirm-line').forEach((btn) => {
    btn.addEventListener('click', () => confirmLineMapping(btn));
  });

  bodyEl.querySelectorAll('.btn-toggle-inline-match').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(`inlineMatch-${btn.dataset.idx}`);
      if (!panel) return;
      const opening = panel.hidden;
      panel.hidden = !opening;
      if (opening) {
        const input = panel.querySelector('.benimpos-inline-search');
        searchMastersForLine(input);
      }
    });
  });

  bodyEl.querySelectorAll('.benimpos-inline-search').forEach((input) => {
    input.addEventListener('input', () => {
      clearTimeout(masterSearchTimer);
      masterSearchTimer = setTimeout(() => searchMastersForLine(input), 280);
    });
  });
}

async function searchMastersForLine(input) {
  const idx = input.dataset.idx;
  const resultsEl = document.getElementById(`inlineResults-${idx}`);
  if (!resultsEl) return;

  const q = String(input.value || '').trim();
  if (q.length < 2) {
    resultsEl.innerHTML = '<p class="muted benimpos-inline-empty">En az 2 karakter yazın.</p>';
    return;
  }

  resultsEl.innerHTML = '<p class="matching-loading">Aranıyor…</p>';
  const response = await window.BuyBoxCommon.authFetch(
    '/api/product-matching/search-masters?q=' + encodeURIComponent(q)
  );
  if (!response.ok) {
    resultsEl.innerHTML = '<p class="muted benimpos-inline-empty">Arama başarısız.</p>';
    return;
  }

  const data = await response.json();
  const rows = data.rows || [];
  if (!rows.length) {
    resultsEl.innerHTML = '<p class="muted benimpos-inline-empty">Sonuç yok. BenimPOS\'ta ürün kartı açıp havuzu güncelleyin.</p>';
    return;
  }

  resultsEl.innerHTML = rows.slice(0, 8).map((row) =>
    `<button type="button" class="benimpos-inline-pick" data-idx="${escAttr(idx)}" ` +
    `data-cp="${escAttr(input.dataset.cp)}" data-name="${escAttr(input.dataset.name)}" ` +
    `data-master="${escAttr(row.id)}">` +
    `<strong>${esc(row.name)}</strong>` +
    `<span class="muted">${esc(row.benimposBarcode)} · stok ${esc(row.stock)} · alış ₺${formatMoney(row.buyingPrice)}</span>` +
    `</button>`
  ).join('');

  resultsEl.querySelectorAll('.benimpos-inline-pick').forEach((btn) => {
    btn.addEventListener('click', () => confirmInlineMapping(btn));
  });
}

async function confirmInlineMapping(btn) {
  const channelProductId = btn.dataset.cp;
  const masterProductId = btn.dataset.master;
  const channelName = btn.dataset.name;
  btn.disabled = true;

  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm', {
    method: 'POST',
    body: JSON.stringify({
      channelId: currentChannelId,
      channelProductId,
      channelBarcode: channelProductId,
      channelName,
      masterProductId,
      ensureChannelProduct: true,
      source: 'order_preview',
      confirmedBy: 'order_inline_match'
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    alert(err.error || 'Eşleştirme kaydedilemedi.');
    btn.disabled = false;
    return;
  }

  await loadPreview();
}

async function confirmLineMapping(btn) {
  const channelProductId = btn.dataset.cp;
  const masterProductId = btn.dataset.master;
  btn.disabled = true;
  btn.textContent = 'Onaylanıyor…';
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm', {
    method: 'POST',
    body: JSON.stringify({
      channelId: currentChannelId,
      channelProductId,
      masterProductId,
      ensureChannelProduct: true,
      source: 'order_preview'
    })
  });
  if (!response.ok) {
    alert('Eşleştirme onaylanamadı.');
    btn.disabled = false;
    btn.textContent = 'Eşleştirmeyi Onayla';
    return;
  }
  await loadPreview();
}

async function submitBenimposSale() {
  const canSend = currentPreview?.canSendRealSale ?? currentPreview?.canSend;
  if (!canSend || !currentOrder) return;
  if (!confirm('Tüm satırlar manuel onaylı eşleştirmeden geçti. BenimPOS\'ta gerçek satış oluşturulacak. Devam?')) return;

  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Gönderiliyor…';

  try {
    const response = await window.BuyBoxCommon.authFetch('/api/benimpos/create-channel-sale', {
      method: 'POST',
      body: JSON.stringify({
        channelId: currentChannelId,
        orderNumber: currentOrder.orderNumber,
        days: currentDays,
        dryRun: false,
        confirmed: true
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(data.error || 'Satış gönderilemedi. Eşleştirmeleri kontrol edin.');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'BenimPOS\'a Gönder';
      if (data.preview) {
        currentPreview = data.preview;
        renderPreview(data.preview);
      }
      return;
    }

    bodyEl.innerHTML =
      `<div class="benimpos-summary benimpos-summary--ok"><strong>Satış oluşturuldu</strong>` +
      `<span>Kod: ${esc(data.salesCode || '—')}</span></div>` +
      `<p class="muted">${esc(data.message || '')}</p>`;
    actionsEl.hidden = true;
    window.BuyBoxCommon.showToast?.(document.getElementById('ordersToast'), `BenimPOS satış: ${data.salesCode || 'OK'}`);
  } catch (error) {
    alert(error.message || 'Hata');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'BenimPOS\'a Gönder';
  }
}

function closeBenimposSaleModal() {
  backdrop?.classList.remove('open');
  currentOrder = null;
  currentPreview = null;
}

function badge(status, ok) {
  const cls = ok ? 'matching-badge manual_confirmed' : `matching-badge ${status || 'unmapped'}`;
  return `<span class="${cls}">${esc(STATUS_LABELS[status] || status || '—')}</span>`;
}

function formatMoney(v) {
  return Number(v || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}

function escAttr(v) { return esc(v).replace(/"/g, '&quot;'); }

})();
