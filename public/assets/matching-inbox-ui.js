'use strict';

/** Gelen Kutusu — üç sütunlu karar kartı */
(function () {
  const COMPARE_LABELS = { match: 'Eşleşti', diff: 'Farklı', missing: 'Eksik' };
  const CONFIDENCE_LABELS = { high: 'Yüksek', medium: 'Orta', low: 'Düşük', unknown: '—' };
  const MATCH_ISSUE_LABELS = {
    auto_matched: 'Güvenli öneri',
    review_required: 'Manuel kontrol',
    missing_master: 'BenimPOS\'ta yok',
    barcode_conflict: 'Birden fazla aday',
    pending: 'Onay bekliyor'
  };
  const DQ_LABELS = {
    missing_name: 'Ad eksik',
    negative_stock: 'Negatif stok',
    missing_cost: 'Maliyet yok',
    missing_meta: 'Gramaj/varyant eksik'
  };

  let deps = null;
  let loadTimeout = null;

  function esc(v) {
    return deps?.esc?.(v) ?? String(v ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function escAttr(v) {
    return deps?.escAttr?.(v) ?? esc(v).replace(/"/g, '&quot;');
  }

  function formatMoney(v) {
    return deps?.formatMoney?.(v) ?? `₺${Number(v || 0).toFixed(2)}`;
  }

  function formatNum(n) {
    return Number(n).toLocaleString('tr-TR');
  }

  function integrate(h) {
    deps = h;
  }

  function showSkeleton() {
    const sk = document.getElementById('workbenchInboxSkeleton');
    const grid = document.getElementById('workbenchInboxGrid');
    if (sk) {
      sk.hidden = false;
      sk.innerHTML =
        '<div class="inbox-skeleton-col"></div>' +
        '<div class="inbox-skeleton-col"></div>' +
        '<div class="inbox-skeleton-col"></div>';
    }
    // Önceki kartı silme — yeni kayıt gelene kadar boş gri kutu göstermeyi önler.
    if (grid && !grid.querySelector('.inbox-decision-col')) {
      grid.innerHTML = '';
    }
    document.getElementById('workbenchInboxCommercial')?.setAttribute('hidden', '');
    document.getElementById('workbenchInboxCompareTable')?.setAttribute('hidden', '');
    clearTimeout(loadTimeout);
    loadTimeout = setTimeout(() => {
      const prog = document.getElementById('workbenchInboxProgress');
      if (prog && !prog.dataset.loaded) {
        prog.innerHTML =
          '<span class="inbox-load-slow">Yükleme uzun sürüyor…</span> ' +
          '<button type="button" class="linkish" id="workbenchInboxRetry">Tekrar dene</button>';
        document.getElementById('workbenchInboxRetry')?.addEventListener('click', () => deps?.loadWorkbench?.());
      }
    }, 12000);
  }

  function hideSkeleton() {
    const sk = document.getElementById('workbenchInboxSkeleton');
    if (sk) sk.hidden = true;
    clearTimeout(loadTimeout);
    const prog = document.getElementById('workbenchInboxProgress');
    if (prog) prog.dataset.loaded = '1';
  }

  function updateSummary(total, safeCount, channelMeta = null) {
    const pending = document.getElementById('workbenchSummaryPending');
    const safe = document.getElementById('workbenchSummarySafe');
    const progressEl = document.getElementById('workbenchSummaryProgress');
    const fillEl = document.getElementById('workbenchSummaryProgressFill');
    const readinessEl = document.getElementById('workbenchSummaryReadiness');
    const channelId = document.getElementById('workbenchInboxChannel')?.value?.trim() || '';
    const meta = channelId && channelMeta?.[channelId] ? channelMeta[channelId] : null;

    if (meta && Number(meta.productCount) > 0) {
      const pct = Math.min(100, Math.round((Number(meta.manualConfirmed || 0) / meta.productCount) * 100));
      if (progressEl) {
        progressEl.hidden = false;
        progressEl.classList.toggle('inbox-readiness-bar--ready', Boolean(meta.readyForSales));
      }
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (readinessEl) {
        readinessEl.hidden = false;
        readinessEl.textContent = meta.readyForSales
          ? `${formatNum(meta.manualConfirmed)}/${formatNum(meta.productCount)} onaylı — satışa hazır`
          : `${pct}% hazır · ${formatNum(meta.manualConfirmed)}/${formatNum(meta.productCount)} onaylı`;
      }
    } else {
      if (progressEl) progressEl.hidden = true;
      if (readinessEl) readinessEl.hidden = true;
    }

    if (pending) pending.textContent = total > 0 ? `${formatNum(total)} ürün karar bekliyor` : 'Bekleyen eşleştirme yok';
    if (safe) {
      safe.textContent = safeCount > 0 ? `${formatNum(safeCount)} ürün güvenli toplu onaya uygun` : '';
      safe.hidden = safeCount <= 0;
    }
  }

  function renderChannelReadinessBadge(meta) {
    if (!meta || !meta.channelId) return '';
    if (meta.readyForSales) {
      return '<span class="inbox-channel-badge inbox-channel-badge--ready" title="Satışa hazır">✓</span>';
    }
    const hint = meta.blockers?.[0] || meta.nextStep?.label || 'Eksik adım var';
    return `<span class="inbox-channel-badge inbox-channel-badge--blocked" title="${escAttr(hint)}">!</span>`;
  }

  function updateChannelStrip(counts, total, activeChannel, channelMeta = {}) {
    const strip = document.getElementById('workbenchChannelStrip');
    const logos = window.PetFixChannelLogos;
    const input = document.getElementById('workbenchInboxChannel');
    if (!strip || !logos || !input) return;

    const channels = deps?.SALES_CHANNELS?.filter((c) => c.status !== 'planned') || [];
    const allCount = total || 0;
    const items = [{ id: '', label: 'Tümü', count: allCount }].concat(
      channels.map((c) => ({
        id: c.id,
        label: logos.getVisual?.(c.id)?.shortLabel || c.label,
        count: counts?.[c.id] || 0,
        meta: channelMeta[c.id] || null
      }))
    );

    strip.innerHTML = items.map((item) => {
      const active = (input.value || '') === item.id;
      const badge = item.id ? renderChannelReadinessBadge(item.meta) : '';
      return `<button type="button" class="matching-channel-strip-item matching-channel-strip-item--count${active ? ' active' : ''}" data-channel="${escAttr(item.id)}" title="${escAttr(item.label)}">
        ${item.id ? logos.render(item.id, { size: 'md' }) : logos.render('benimpos', { size: 'md' })}
        <span class="matching-channel-strip-label">${esc(item.label)}</span>
        ${badge}
        <span class="matching-channel-strip-count">${formatNum(item.count)}</span>
      </button>`;
    }).join('') + renderChannelStripNotice(channels, counts, allCount, channelMeta);

    if (strip.dataset.bound !== '1') {
      strip.dataset.bound = '1';
      strip.querySelectorAll('.matching-channel-strip-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          input.value = btn.dataset.channel || '';
          strip.querySelectorAll('.matching-channel-strip-item').forEach((el) => {
            el.classList.toggle('active', el.dataset.channel === input.value);
          });
          deps?.reloadWorkbench?.();
        });
      });
    }
  }

  function renderChannelStripNotice(channels, counts, total, channelMeta = {}) {
    if (!total) {
      const readyChannel = channels.find((c) => channelMeta[c.id]?.readyForSales);
      if (readyChannel) {
        const short = window.PetFixChannelLogos?.getVisual?.(readyChannel.id)?.shortLabel || readyChannel.label;
        return `<p class="inbox-channel-notice inbox-channel-notice--ok muted">${esc(short)} satışa hazır — bekleyen eşleştirme yok.</p>`;
      }
      return '';
    }
    const activeChannels = channels.filter((c) => (counts?.[c.id] || 0) > 0);
    if (activeChannels.length !== 1) return '';
    const ch = activeChannels[0];
    const short = window.PetFixChannelLogos?.getVisual?.(ch.id)?.shortLabel || ch.label;
    const meta = channelMeta[ch.id];
    const blocker = meta?.blockers?.[0];
    const extra = blocker ? ` · ${esc(blocker)}` : '';
    return `<p class="inbox-channel-notice muted">Bu kuyruktaki tüm kayıtlar ${esc(short)} kanalından geliyor.${extra}</p>`;
  }

  function resolveQueueStats(channelMeta, activeChannelId) {
    if (activeChannelId && channelMeta[activeChannelId]) {
      return channelMeta[activeChannelId];
    }
    const rows = Object.values(channelMeta || {});
    return {
      queueTotal: rows.reduce((sum, row) => sum + (row.queueTotal || 0), 0),
      needsReview: rows.reduce((sum, row) => sum + (row.needsReview || 0), 0),
      missingMaster: rows.reduce((sum, row) => sum + (row.missingMaster || 0), 0),
      autoPendingConfirm: rows.reduce((sum, row) => sum + (row.autoPendingConfirm || 0), 0)
    };
  }

  function updateInboxQuickFilters(channelMeta = {}, activeChannelId = '', activeQueueMode = 'all') {
    const root = document.getElementById('workbenchInboxQuickFilters');
    if (!root) return;

    const stats = resolveQueueStats(channelMeta, activeChannelId);
    const chips = [
      { mode: 'all', label: 'Tüm bekleyen', count: stats.queueTotal || 0 },
      { mode: 'manual_review', label: 'Manuel kontrol', count: stats.needsReview || 0 },
      { mode: 'missing_master', label: "BenimPOS'ta yok", count: stats.missingMaster || 0 },
      { mode: 'high_confidence', label: 'Hızlı onay', count: stats.autoPendingConfirm || 0 }
    ].filter((chip) => chip.mode === 'all' || chip.count > 0);

    if (chips.length <= 1) {
      root.hidden = true;
      root.innerHTML = '';
      return;
    }

    root.hidden = false;
    root.innerHTML = chips.map((chip) => {
      const active = (activeQueueMode || 'all') === chip.mode;
      let tone = '';
      if (chip.mode === 'manual_review') tone = ' inbox-quick-chip--warn';
      if (chip.mode === 'missing_master') tone = ' inbox-quick-chip--danger';
      if (chip.mode === 'high_confidence') tone = ' inbox-quick-chip--ok';
      return `<button type="button" class="inbox-quick-chip${active ? ' active' : ''}${tone}" data-queue-mode="${escAttr(chip.mode)}">${esc(chip.label)} <span class="inbox-quick-chip-count">${formatNum(chip.count)}</span></button>`;
    }).join('');

    root.querySelectorAll('.inbox-quick-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        deps?.applyInboxQueueMode?.(btn.dataset.queueMode || 'all');
      });
    });
  }

  function photoIconPlaceholder() {
    const icon = '<svg class="inbox-photo-icon" viewBox="0 0 24 24" width="36" height="36" aria-hidden="true"><path fill="currentColor" d="M21 16.5V8.5l-9-5.25L3 8.5v8l9 5.25 9-5.25zm-9 3.08L5.5 15.4V9.6L12 5.42l6.5 4.18v5.8L12 19.58zM12 11.5l6.5-4.18L12 3.14 5.5 7.32 12 11.5z"/></svg>';
    return `<div class="inbox-product-photo inbox-product-photo--placeholder" aria-hidden="true">${icon}</div>`;
  }

  function onPhotoLoad(el) {
    el.closest('.inbox-photo-box')?.classList.add('is-loaded');
  }

  function onPhotoError(el) {
    const box = el.closest('.inbox-photo-box');
    if (!box) return;
    box.classList.add('is-broken');
    el.remove();
  }

  function renderProductPhoto(row, side) {
    const barcode = side === 'channel' ? row.channelBarcode : row.linkedMasterBarcode;
    const imageUrl = side === 'channel' ? row.channelImageUrl : null;
    const alt = side === 'channel' ? row.channelName : row.suggestedMasterName;
    const src = imageUrl || (barcode ? `/api/product-thumb-img?barcode=${encodeURIComponent(barcode)}` : '');
    if (!src) return photoIconPlaceholder();
    return `<div class="inbox-photo-box inbox-photo-box--pending">
      ${photoIconPlaceholder()}
      <img class="inbox-product-photo inbox-product-photo--img" src="${escAttr(src)}" alt="${escAttr(alt || 'Ürün görseli')}" loading="lazy" onload="MatchingInboxUi.onPhotoLoad(this)" onerror="MatchingInboxUi.onPhotoError(this)">
    </div>`;
  }

  function computeConfidenceLayers(row) {
    const compare = row.compareFields || [];
    const barcode = compare.find((f) => f.key === 'barcode');
    const barcodeMatch = barcode?.state === 'match';

    let identityPct = null;
    let identityNote = 'barkod bilgisi yok';
    if (barcodeMatch) {
      identityPct = 100;
      identityNote = 'barkod birebir';
    } else if (barcode?.state === 'diff') {
      identityPct = 0;
      identityNote = 'barkod farklı';
    } else if (barcode?.state === 'missing') {
      identityNote = 'barkod eksik';
    }

    const dataGaps = [];
    for (const { key, label } of [
      { key: 'name', label: 'isim' },
      { key: 'brand', label: 'marka' },
      { key: 'weight', label: 'gramaj' },
      { key: 'variant', label: 'varyant' }
    ]) {
      const f = compare.find((x) => x.key === key);
      if (!f) continue;
      if (key === 'name') {
        if (row.nameSimilarityPct != null && row.nameSimilarityPct < 90) dataGaps.push(label);
      } else if (f.state === 'diff') {
        dataGaps.push(label);
      } else if (f.state === 'missing' && (f.channel || f.master)) {
        dataGaps.push(label);
      }
    }

    let dataPct = null;
    let dataNote = '';
    if (barcodeMatch && row.nameSimilarityPct != null) {
      dataPct = row.nameSimilarityPct;
      for (const key of ['brand', 'weight', 'variant']) {
        const f = compare.find((x) => x.key === key);
        if (f?.state === 'diff') dataPct = Math.max(0, dataPct - 12);
      }
      dataNote = dataGaps.length
        ? `${dataGaps.join(', ')} eksikleri var`
        : 'temel alanlar uyumlu';
    } else if (!barcodeMatch) {
      const scored = compare.filter((f) => ['name', 'brand', 'weight', 'variant'].includes(f.key));
      if (scored.length) {
        let earned = 0;
        for (const f of scored) {
          if (f.key === 'name' && row.nameSimilarityPct != null) earned += row.nameSimilarityPct / scored.length;
          else if (f.state === 'match') earned += 100 / scored.length;
        }
        dataPct = Math.round(earned);
        dataNote = dataGaps.length ? `${dataGaps.join(', ')} farklı veya eksik` : 'alanlar kısmen uyumlu';
      }
    }

    const decisionLevel = CONFIDENCE_LABELS[row.confidenceLevel] || CONFIDENCE_LABELS.unknown;
    return { identityPct, identityNote, dataPct, dataNote, dataGaps, decisionLevel };
  }

  function compareFieldExplanation(f, row) {
    const barcodeMatch = (row.compareFields || []).find((x) => x.key === 'barcode')?.state === 'match';
    if (f.state === 'match') return 'Alan değerleri uyumlu.';

    if (f.key === 'name') {
      if (row.nameSimilarityPct != null) {
        const detail = row.nameSimilarityPct >= 85
          ? 'İsimler büyük ölçüde aynı'
          : 'Kanal adı daha ayrıntılı, BenimPOS ana adı kısa';
        return `${detail}; barkod ${barcodeMatch ? 'aynıdır' : 'farklı veya eksiktir'}.`;
      }
      return 'Ürün adları farklı görünüyor; barkod ve diğer alanları kontrol edin.';
    }

    if (f.key === 'stockCode') {
      if (f.state === 'diff') {
        return barcodeMatch
          ? 'Stok kodları farklı; barkod eşleştiği için eşleşmeyi engellemez.'
          : 'Stok kodları farklı; barkod veya ürün adı ile birlikte değerlendirin.';
      }
      if (f.state === 'missing') return 'Stok kodu yalnızca bir tarafta kayıtlı.';
    }

    if (f.key === 'barcode') {
      if (f.state === 'match') return 'Barkodlar birebir eşleşiyor; kimlik güveni yüksek.';
      if (f.state === 'diff') return 'Barkodlar uyuşmuyor; manuel doğrulama gerekir.';
    }

    if (f.state === 'missing') {
      if (f.channel && !f.master) return `${f.label} BenimPOS tarafında eksik.`;
      if (!f.channel && f.master) return `${f.label} kanal tarafında eksik.`;
      return `${f.label} her iki tarafta da boş.`;
    }

    if (f.state === 'diff') {
      return `${f.label} değerleri farklı; aynı ürün olduğundan emin olun.`;
    }
    return '';
  }

  function rowHasMasterField(row, kind) {
    if (kind === 'weight') return Boolean(row.masterWeightG);
    if (kind === 'brand') return Boolean(row.masterBrand);
    if (kind === 'variant') return Boolean(row.masterVariant);
    return false;
  }

  function parseNameSuggestions(row) {
    if (row.parsedNameHints?.length) {
      return row.parsedNameHints.filter((hint) => {
        if (hint.field === 'gramaj' && rowHasMasterField(row, 'weight')) return false;
        if (hint.field === 'marka' && rowHasMasterField(row, 'brand')) return false;
        if (hint.field === 'varyant' && rowHasMasterField(row, 'variant')) return false;
        return true;
      });
    }
    const source = String(row.channelName || '').trim();
    if (!source) return [];
    const hints = [];
    const weightMatch = source.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gram)\b/i);
    if (weightMatch) {
      const amount = parseFloat(String(weightMatch[1]).replace(',', '.'));
      const unit = weightMatch[2].toLowerCase();
      const grams = unit.startsWith('k') ? Math.round(amount * 1000) : Math.round(amount);
      hints.push({ field: 'gramaj', label: 'Gramaj', value: `${grams} g` });
    }
    const in1 = source.match(/\b(\d+)\s*in\s*1\b|\b(\d+)in1\b/i);
    if (in1) hints.push({ field: 'varyant', label: 'Varyant', value: `${in1[1] || in1[2]}in1` });
    const packLi = source.match(/\b(\d+)\s*['']?[lL][iıİI]\b/);
    if (packLi) hints.push({ field: 'paket', label: 'Paket adedi', value: packLi[1] });
    const brandLead = source.match(/^([A-Za-z0-9][A-Za-z0-9+\-]{1,24})\b/);
    if (brandLead) {
      hints.push({ field: 'marka', label: 'Marka', value: brandLead[1] });
    }
    return hints.filter((hint) => {
      if (hint.field === 'gramaj' && rowHasMasterField(row, 'weight')) return false;
      if (hint.field === 'marka' && rowHasMasterField(row, 'brand')) return false;
      if (hint.field === 'varyant' && rowHasMasterField(row, 'variant')) return false;
      return true;
    });
  }

  function renderNameSuggestions(row) {
    const suggestions = parseNameSuggestions(row);
    if (!suggestions.length) return '';
    const items = suggestions.map((hint) =>
      `<li><span class="inbox-hint-label">${esc(hint.label)}</span> <strong>${esc(hint.value)}</strong></li>`
    ).join('');
    return `<div class="inbox-name-suggestions">
      <p class="inbox-name-suggestions-title">Önerilen veri <span class="action-tag action-tag--hint">onay gerekir</span></p>
      <ul class="inbox-name-suggestions-list">${items}</ul>
      <p class="muted inbox-name-suggestions-note">Kanal ürün adından çıkarıldı; otomatik kaydedilmez.</p>
    </div>`;
  }

  function fieldRow(label, value) {
    if (!value && value !== 0) return '';
    return `<div class="inbox-field-row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  }

  function renderChannelColumn(row) {
    const logos = window.PetFixChannelLogos;
    const logo = logos ? logos.render(row.channelId, { size: 'lg' }) : '';
    const weight = row.channelWeightG ? `${row.channelWeightG}g` : '—';
    return `<section class="inbox-decision-col inbox-decision-col--channel">
      <header class="inbox-col-head">${logo}<span>Kanal ürünü</span></header>
      ${renderProductPhoto(row, 'channel')}
      <h3 class="inbox-product-title">${esc(row.channelName || '—')}</h3>
      <dl class="inbox-field-list">
        ${fieldRow('Barkod', row.channelBarcode)}
        ${fieldRow('Kanal SKU', row.channelProductId)}
        ${fieldRow('Marka', row.channelBrand)}
        ${fieldRow('Gramaj', weight)}
        ${fieldRow('Varyant', row.channelVariant)}
        ${fieldRow('Stok kodu', row.channelStockCode)}
        ${fieldRow('Kanal fiyatı', row.salePrice > 0 ? formatMoney(row.salePrice) : null)}
      </dl>
      ${renderMatchBadges(row)}
    </section>`;
  }

  function renderReasonColumn(row) {
    const layers = computeConfidenceLayers(row);
    const levelClass = row.confidenceLevel || 'unknown';
    const breakdown = (row.confidenceBreakdown || []).map((item) =>
      `<li><span>${esc(item.label)}</span><strong>+${item.points}</strong></li>`
    ).join('') || '<li class="muted">Kriter listesi yok — manuel kontrol</li>';

    const criteria = (row.compareFields || [])
      .filter((f) => ['barcode', 'name', 'brand', 'weight', 'variant'].includes(f.key))
      .map((f) => {
        let val = COMPARE_LABELS[f.state] || f.state;
        if (f.key === 'name' && row.nameSimilarityPct != null) {
          val = `%${row.nameSimilarityPct} benzerlik`;
        }
        return `<div class="inbox-criterion inbox-criterion--${f.state}"><span>${esc(f.label)}</span><strong>${esc(val)}</strong></div>`;
      }).join('');

    const identityLine = layers.identityPct != null
      ? `<strong class="inbox-layer-pct">%${layers.identityPct}</strong> <span class="muted">— ${esc(layers.identityNote)}</span>`
      : `<span class="muted">${esc(layers.identityNote)}</span>`;
    const dataLine = layers.dataPct != null
      ? `<strong class="inbox-layer-pct">%${layers.dataPct}</strong> <span class="muted">— ${esc(layers.dataNote)}</span>`
      : `<span class="muted">${layers.dataNote || 'karşılaştırma yok'}</span>`;

    return `<section class="inbox-decision-col inbox-decision-col--reason">
      <header class="inbox-col-head"><span>Eşleşme nedeni</span></header>
      <div class="inbox-confidence-layers">
        <div class="inbox-confidence-layer">
          <span class="inbox-confidence-layer-label">Kimlik güveni</span>
          <div class="inbox-confidence-layer-value">${identityLine}</div>
        </div>
        <div class="inbox-confidence-layer">
          <span class="inbox-confidence-layer-label">Veri uyumu</span>
          <div class="inbox-confidence-layer-value">${dataLine}</div>
        </div>
        <div class="inbox-confidence-layer inbox-confidence-layer--decision inbox-confidence-layer--${levelClass}">
          <span class="inbox-confidence-layer-label">Genel karar</span>
          <div class="inbox-confidence-layer-value"><strong>${esc(layers.decisionLevel)} güven</strong></div>
        </div>
      </div>
      <details class="inbox-confidence-why">
        <summary>Skor detayı</summary>
        <ul class="inbox-confidence-breakdown">${breakdown}</ul>
      </details>
      <div class="inbox-criteria-grid">${criteria}</div>
      <p class="inbox-system-comment">${esc(row.systemComment || row.suggestionReason || '—')}</p>
    </section>`;
  }

  function renderMasterColumn(row) {
    if (!row.suggestedMasterName && row.mappingStatus === 'missing_master') {
      return `<section class="inbox-decision-col inbox-decision-col--master inbox-decision-col--empty">
        <header class="inbox-col-head"><span>Önerilen BenimPOS</span></header>
        <p class="inbox-empty-master">BenimPOS'ta eşleşen ürün bulunamadı.</p>
        <p class="muted">Başka Ürün Seç veya ana ürün oluştur.</p>
      </section>`;
    }
    const weight = row.masterWeightG ? `${row.masterWeightG}g` : '—';
    const dq = (row.masterDataIssues || []).map((c) =>
      `<span class="action-tag action-tag--dq">${esc(DQ_LABELS[c] || c)}</span>`
    ).join('');
    return `<section class="inbox-decision-col inbox-decision-col--master">
      <header class="inbox-col-head"><span>Önerilen BenimPOS</span></header>
      ${renderProductPhoto(row, 'master')}
      <h3 class="inbox-product-title">${esc(row.suggestedMasterName || '—')}</h3>
      <dl class="inbox-field-list">
        ${fieldRow('Barkod', row.linkedMasterBarcode)}
        ${fieldRow('Stok kodu', row.masterStockCode)}
        ${fieldRow('Marka', row.masterBrand)}
        ${fieldRow('Gramaj', weight)}
        ${fieldRow('Varyant', row.masterVariant)}
        ${fieldRow('Stok', row.masterStock)}
        ${fieldRow('Maliyet', row.masterBuyingPrice > 0 ? formatMoney(row.masterBuyingPrice) : null)}
        ${fieldRow('Satış fiyatı', row.masterSalePrice > 0 ? formatMoney(row.masterSalePrice) : null)}
      </dl>
      ${dq ? `<div class="inbox-dq-tags">${dq}</div>` : ''}
      ${renderNameSuggestions(row)}
    </section>`;
  }

  function renderMatchBadges(row) {
    const match = MATCH_ISSUE_LABELS[row.mappingStatus]
      ? `<span class="action-tag action-tag--match">${esc(MATCH_ISSUE_LABELS[row.mappingStatus])}</span>`
      : '';
    const flags = (row.qualityFlags || []).map((f) =>
      `<span class="action-tag action-tag--match-warn">${esc(deps?.QUALITY_FLAG_LABELS?.[f] || f)}</span>`
    ).join('');
    return `<div class="inbox-match-badges">${match}${flags}</div>`;
  }

  function renderCommercial(row) {
    const el = document.getElementById('workbenchInboxCommercial');
    if (!el) return;
    if (!row) {
      el.hidden = true;
      return;
    }
    el.hidden = false;

    const channelPrice = row.salePrice > 0 ? Number(row.salePrice) : null;
    const masterPrice = row.masterComparePrice > 0
      ? Number(row.masterComparePrice)
      : (row.masterSalePrice > 0 ? Number(row.masterSalePrice) : null);
    const cost = row.masterBuyingPrice > 0 ? Number(row.masterBuyingPrice) : null;

    let diffAbs = row.priceDiffAbs != null ? Number(row.priceDiffAbs) : null;
    let diffPct = row.priceDiffPct != null ? Number(row.priceDiffPct) : null;
    if (channelPrice != null && masterPrice != null) {
      if (diffAbs == null) diffAbs = Math.round((channelPrice - masterPrice) * 100) / 100;
      if (diffPct == null && masterPrice > 0) {
        diffPct = Math.round(((channelPrice - masterPrice) / masterPrice) * 1000) / 10;
      }
    }

    let diffLine = '—';
    if (diffAbs != null && diffPct != null && Number.isFinite(diffAbs) && Number.isFinite(diffPct)) {
      const sign = diffAbs > 0 ? '+' : (diffAbs < 0 ? '−' : '');
      const absText = `${sign}${formatMoney(Math.abs(diffAbs))}`;
      const pctText = `${diffPct > 0 ? '+' : ''}${diffPct.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}%`;
      diffLine = `${absText} (${pctText})`;
    }

    let grossMarginLine = '—';
    if (channelPrice != null && cost != null && cost > 0) {
      const marginPct = row.estimatedProfitPct != null
        ? Number(row.estimatedProfitPct)
        : Math.round(((channelPrice - cost) / cost) * 1000) / 10;
      grossMarginLine = `${marginPct > 0 ? '+' : ''}${marginPct.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}%`;
    }

    const warn = (row.qualityFlags || []).includes('fiyat_uyusmazligi')
      ? '<span class="inbox-commercial-warn">Fiyat uyuşmazlığı</span>' : '';
    el.innerHTML =
      '<h4 class="inbox-commercial-title">Fiyat ve ticari bilgiler</h4>' +
      '<p class="inbox-commercial-note muted">Komisyon, KDV, hizmet bedeli ve kurye maliyeti dahil değildir; Buybox net kâr hesabı değildir.</p>' +
      '<dl class="inbox-commercial-dl">' +
        `<div><dt>Kanal satış</dt><dd>${channelPrice != null ? formatMoney(channelPrice) : '—'}</dd></div>` +
        `<div><dt>BenimPOS satış</dt><dd>${masterPrice != null ? formatMoney(masterPrice) : '—'}</dd></div>` +
        `<div><dt>Maliyet</dt><dd>${cost != null ? formatMoney(cost) : '—'}</dd></div>` +
        `<div><dt>Fiyat farkı</dt><dd>${esc(diffLine)}</dd></div>` +
        `<div><dt>Maliyet üzeri brüt oran</dt><dd>${esc(grossMarginLine)}</dd></div>` +
      '</dl>' + warn;
  }

  function renderCompareTable(row) {
    const el = document.getElementById('workbenchInboxCompareTable');
    if (!el) return;
    const fields = (row?.compareFields || []).filter((f) =>
      !['price'].includes(f.key));
    if (!row || !fields.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<h4 class="inbox-compare-title">Alan karşılaştırması</h4>' +
      '<table class="inbox-compare-table"><thead><tr><th>Alan</th><th>Kanal</th><th>BenimPOS</th><th>Durum</th><th>Açıklama</th></tr></thead><tbody>' +
      fields.map((f) => {
        const hint = compareFieldExplanation(f, row);
        return `<tr class="inbox-compare-row--${f.state}"><td>${esc(f.label)}</td><td>${esc(f.channel || '—')}</td><td>${esc(f.master || '—')}</td><td><span class="compare-pill compare-pill--${f.state}">${esc(COMPARE_LABELS[f.state] || f.state)}</span></td><td class="inbox-compare-hint">${esc(hint)}</td></tr>`;
      }).join('') +
      '</tbody></table>';
  }

  function renderProgress(index, total, safeCount, loading) {
    const prog = document.getElementById('workbenchInboxProgress');
    if (!prog) return;
    if (!total) {
      prog.innerHTML = '<span class="muted">Kuyruk boş</span>';
      return;
    }
    prog.innerHTML =
      `<span class="inbox-progress-main">Kayıt <strong>${formatNum(index + 1)}</strong> / ${formatNum(total)}</span>` +
      (loading ? '<span class="inbox-progress-loading muted">Yükleniyor…</span>' : '') +
      (safeCount > 0 ? `<span class="inbox-progress-safe">Bu kuyrukta ${formatNum(safeCount)} güvenli onay</span>` : '');
  }

  function renderEmpty(message) {
    hideSkeleton();
    const grid = document.getElementById('workbenchInboxGrid');
    if (grid) {
      grid.innerHTML = `<div class="inbox-decision-empty"><p>${esc(message)}</p><p class="muted">Filtreleri değiştirin veya Ana Ürün Havuzuna dönün.</p></div>`;
    }
    renderCommercial(null);
    renderCompareTable(null);
  }

  function renderWorkbenchInbox(ctx) {
    const {
      row,
      index,
      queueLength,
      total,
      safeCount,
      workbenchView,
      canConfirm,
      canUnmap,
      loading
    } = ctx;

    const bulkBtn = document.getElementById('workbenchInboxBulkSafe');
    if (bulkBtn) {
      bulkBtn.hidden = workbenchView === 'suspicious' || safeCount <= 0;
      if (!bulkBtn.hidden) {
        bulkBtn.textContent = `Güvenli Toplu Onay (${formatNum(safeCount)})`;
      }
    }
    deps?.refreshInboxBulkButtons?.();

    renderProgress(index, total || queueLength, safeCount, loading);

    if (loading) {
      syncActionButtons({ canConfirm: false, canUnmap: false, row: null, workbenchView, loading: true });
      return;
    }

    hideSkeleton();

    if (!row) {
      renderEmpty(workbenchView === 'suspicious' ? 'Şüpheli onaylı kayıt yok.' : 'Bekleyen eşleştirme yok.');
      syncActionButtons({ canConfirm: false, canUnmap: false, row: null, workbenchView, loading });
      return;
    }

    const grid = document.getElementById('workbenchInboxGrid');
    if (grid) {
      try {
        grid.innerHTML =
          renderChannelColumn(row) +
          renderReasonColumn(row) +
          renderMasterColumn(row);
      } catch (err) {
        console.error('[matching-inbox-ui] render failed:', err);
        grid.innerHTML =
          '<div class="inbox-decision-empty"><p>Kart render edilemedi.</p><p class="muted">↻ Yenile ile tekrar deneyin.</p></div>';
      }
    }
    renderCommercial(row);
    renderCompareTable(row);
    syncActionButtons({ canConfirm, canUnmap, row, workbenchView, loading });
  }

  function syncActionButtons({ canConfirm, canUnmap, row, workbenchView, loading }) {
    const confirmBtn = document.getElementById('workbenchInboxConfirm');
    const mapBtn = document.getElementById('workbenchInboxMap');
    const rejectBtn = document.getElementById('workbenchInboxReject');
    const prevBtn = document.getElementById('workbenchInboxPrev');
    const unmapBtn = document.getElementById('workbenchInboxUnmap');
    if (confirmBtn) {
      confirmBtn.hidden = workbenchView === 'suspicious';
      confirmBtn.disabled = loading || !canConfirm;
    }
    if (mapBtn) mapBtn.disabled = loading || !row;
    if (rejectBtn) rejectBtn.disabled = loading || !row || workbenchView === 'suspicious';
    if (prevBtn) prevBtn.disabled = loading || (deps?.getInboxIndex?.() || 0) <= 0;
    if (unmapBtn) {
      unmapBtn.hidden = !canUnmap;
      unmapBtn.disabled = !canUnmap;
    }
  }

  function buildBulkPreviewHtml(stats, items) {
    const channelLines = Object.entries(stats.byChannel).map(([id, count]) => {
      const label = deps?.CHANNEL_SHORT_LABELS?.[id] || id;
      return `<li>${esc(label)}: <strong>${formatNum(count)}</strong></li>`;
    }).join('');
    return (
      `<p><strong>${formatNum(stats.total)}</strong> eşleştirme onaylanacak.</p>` +
      '<h4>Kanal dağılımı</h4><ul>' + (channelLines || '<li>—</li>') + '</ul>' +
      `<p>Barkod birebir: <strong>${formatNum(stats.barcodeExact)}</strong></p>` +
      `<p>Marka + gramaj uyumlu (barkod dışı): <strong>${formatNum(stats.brandWeight)}</strong></p>` +
      `<p>Şüpheli / dışarıda: <strong>${formatNum(stats.excluded)}</strong></p>` +
      `<p class="muted">Onay sonrası kuyrukta yaklaşık <strong>${formatNum(stats.remaining)}</strong> kayıt kalır.</p>`
    );
  }

  function computeBulkStats(allRows, safeItems) {
    const byChannel = {};
    let barcodeExact = 0;
    let brandWeight = 0;
    for (const row of safeItems) {
      byChannel[row.channelId] = (byChannel[row.channelId] || 0) + 1;
      const bc = (row.compareFields || []).find((f) => f.key === 'barcode');
      if (bc?.state === 'match') barcodeExact += 1;
      else brandWeight += 1;
    }
    return {
      total: safeItems.length,
      byChannel,
      barcodeExact,
      brandWeight,
      excluded: Math.max(0, allRows.length - safeItems.length),
      remaining: Math.max(0, (deps?.getInboxTotal?.() || 0) - safeItems.length)
    };
  }

  function openBulkPreview(allRows, safeItems, onConfirm) {
    const backdrop = document.getElementById('inboxBulkPreviewBackdrop');
    const body = document.getElementById('inboxBulkPreviewBody');
    if (!backdrop || !body) {
      onConfirm?.();
      return;
    }
    const stats = computeBulkStats(allRows, safeItems);
    body.innerHTML = buildBulkPreviewHtml(stats, safeItems);
    backdrop.removeAttribute('hidden');
    const close = () => backdrop.setAttribute('hidden', '');
    document.getElementById('inboxBulkPreviewClose')?.addEventListener('click', close, { once: true });
    document.getElementById('inboxBulkPreviewCancel')?.addEventListener('click', close, { once: true });
    document.getElementById('inboxBulkPreviewConfirm')?.addEventListener('click', () => {
      close();
      onConfirm?.();
    }, { once: true });
  }

  function resetInboxScrollPosition() {
    window.scrollTo(0, 0);
    const panel = document.getElementById('tabWorkbench');
    if (panel) panel.scrollTop = 0;
    const grid = document.getElementById('workbenchInboxGrid');
    if (grid) {
      grid.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }

  window.MatchingInboxUi = {
    integrate,
    showSkeleton,
    hideSkeleton,
    updateSummary,
    updateChannelStrip,
    updateInboxQuickFilters,
    renderWorkbenchInbox,
    openBulkPreview,
    computeBulkStats,
    resetInboxScrollPosition,
    onPhotoLoad,
    onPhotoError
  };
})();
