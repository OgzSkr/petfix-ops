'use strict';

(function () {
  const ORDER_TIMEZONE = 'Europe/Istanbul';

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
    const num = Number(value) || 0;
    return num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatSignedMoney(value) {
    const num = Number(value) || 0;
    const prefix = num > 0 ? '+' : '';
    return prefix + '₺' + formatMoney(num);
  }

  function formatPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return num.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  function normalizeOrderTimestamp(value) {
    if (value === '' || value === null || value === undefined) return 0;
    let n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      if (n < 1e12) n *= 1000;
      return n;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function formatOpsDate(timestamp) {
    const ms = normalizeOrderTimestamp(timestamp);
    if (!ms) return '—';
    const parts = new Intl.DateTimeFormat('tr-TR', {
      timeZone: ORDER_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(ms));
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return get('day') + '.' + get('month') + '.' + get('year') + ' ' + get('hour') + ':' + get('minute');
  }

  function channelLogoId(channel) {
    if (channel === 'trendyol_go') return 'uber-eats';
    return channel;
  }

  function channelLogos() {
    return window.PetFixChannelLogos || window.BuyBoxChannelLogos || null;
  }

  function renderOpsChannelBlock(channelId, logos, fallbackLabel) {
    const logoChannel = channelLogoId(channelId);
    if (!logos?.render) return esc(fallbackLabel || '—');
    const visual = logos.getVisual?.(logoChannel) || {};
    const label = visual.label || fallbackLabel || channelId || '—';
    return '<span class="ops-channel-inline">' +
      logos.render(logoChannel, { size: 'sm' }) +
      '<span class="ops-channel-label">' + esc(label) + '</span>' +
    '</span>';
  }

  function translateStatus(status) {
    const map = {
      Delivered: 'Teslim edildi',
      DELIVERED: 'Teslim edildi',
      COMPLETED: 'Tamamlandı',
      completed: 'Tamamlandı',
      delivered: 'Teslim edildi',
      cancelled: 'İptal',
      CANCELLED: 'İptal',
      picking: 'Toplanıyor',
      preparing: 'Hazırlanıyor',
      pending: 'Beklemede'
    };
    return map[status] || status || '—';
  }

  function renderOpsStatusPill(status) {
    const label = translateStatus(status) || '—';
    const normalized = String(status || '').toLowerCase();
    const done = ['delivered', 'completed', 'picked_up', 'finished'].includes(normalized)
      || ['Delivered', 'COMPLETED', 'PICKED_UP'].includes(String(status || ''));
    const cancelled = ['cancelled', 'canceled'].includes(normalized)
      || ['Cancelled', 'CANCELLED', 'CANCELED'].includes(String(status || ''));
    const cls = cancelled ? ' ops-status-pill--cancelled' : (done ? ' ops-status-pill--done' : '');
    return '<span class="ops-status-pill' + cls + '">' + esc(label) + '</span>';
  }

  function detailItem(label, value) {
    return '<div><span>' + esc(label) + '</span><strong>' + value + '</strong></div>';
  }

  function formatOpsPhone(row) {
    return String(row.customerPhone || '').trim() || '—';
  }

  function isOpsOrderDelivered(row) {
    const status = String(row.status || '').trim().toLowerCase();
    return ['delivered', 'completed', 'picked_up', 'finished'].includes(status);
  }

  function formatOpsDeliveryDate(row) {
    if (row.deliveredAtMs) return formatOpsDate(row.deliveredAtMs);
    if (isOpsOrderDelivered(row)) return '—';
    return 'Henüz teslim edilmedi';
  }

  function opsSettlementChannelLabel(channelId) {
    if (channelId === 'uber-eats') return 'Trendyol GO';
    if (channelId === 'yemeksepeti') return 'Yemeksepeti';
    if (channelId === 'getir') return 'Getir';
    return 'Kanal';
  }

  function resolveOpsLineDisplayPrices(line) {
    const qty = Number(line.quantity) || 1;
    let unit = Number(line.unitSalesPrice ?? line.lineUnitPrice ?? line.unitPrice) || 0;
    let total = Number(line.lineSalesAmount ?? line.lineGrossAmount ?? line.lineTotal) || 0;
    if (unit > 0 && total > 0 && Math.abs(total - unit) < 0.02 && qty > 1) {
      total = unit * qty;
    } else if (unit > 0 && !total) {
      total = unit * qty;
    } else if (total > 0 && !unit) {
      unit = total / qty;
    } else if (unit > 0 && total > 0 && Math.abs(total - unit * qty) > 0.05) {
      total = unit * qty;
    }
    return { unit, total, qty };
  }

  function opsLineThumbHtml(line, channelId) {
    const directUrl = String(line.imageUrl || '').trim();
    const barcode = String(line.masterBarcode || line.costBarcode || line.barcode || '').trim();
    const channel = String(channelLogoId(channelId) || '').trim();
    if (directUrl) {
      return '<img class="orders-line-img ops-product-thumb" src="' + escAttr(directUrl) + '" width="56" height="56" loading="lazy" alt="" ' +
        'onerror="this.onerror=null;this.classList.add(\'is-missing\');this.removeAttribute(\'src\');">';
    }
    if (barcode) {
      const params = new URLSearchParams({ barcode });
      if (channel) params.set('channel', channel);
      return '<img class="orders-line-img ops-product-thumb" src="/api/product-thumb-img?' + params.toString() + '" width="56" height="56" loading="lazy" alt="" ' +
        'onerror="this.onerror=null;this.classList.add(\'is-missing\');this.removeAttribute(\'src\');">';
    }
    return '<span class="orders-line-img orders-line-img--placeholder ops-product-thumb" aria-hidden="true"></span>';
  }

  function renderOpsQtyBadge(quantity) {
    const qty = Number(quantity) || 1;
    const multi = qty > 1 ? ' ops-qty-badge--multi' : '';
    return '<span class="ops-qty-badge' + multi + '">' + esc(qty) + '</span>';
  }

  function renderOpsLineItems(lines, channelId) {
    if (!lines?.length) {
      return '<p class="muted">Ürün satırı yok.</p>';
    }
    const rows = lines.map((line) => {
      const barcode = String(line.barcode || line.masterBarcode || '').trim();
      const pricing = resolveOpsLineDisplayPrices(line);
      const brand = String(line.brandName || '—').trim() || '—';
      const imgCell = opsLineThumbHtml(line, channelId);
      return '<tr>' +
        '<td class="ops-product-name-cell">' +
          '<div class="ops-product-row">' + imgCell +
            '<div class="ops-product-copy">' +
              '<div class="ops-product-title">' + esc(line.productName || line.title || barcode || '—') + '</div>' +
              (barcode ? '<div class="ops-product-barcode">' + esc(barcode) + '</div>' : '') +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td class="ops-brand-cell">' + esc(brand) + '</td>' +
        '<td class="ops-money-cell">' + formatMoney(pricing.unit) + ' ₺</td>' +
        '<td class="ops-qty-cell">' + renderOpsQtyBadge(pricing.qty) + '</td>' +
        '<td class="ops-money-cell">' + formatMoney(pricing.total) + ' ₺</td>' +
      '</tr>';
    }).join('');

    return '<div class="ops-products-wrap">' +
      '<table class="ops-products-table ops-products-table--hzlmrktops">' +
        '<thead><tr>' +
          '<th>Ürün</th><th>Marka</th><th>Birim Fiyat</th><th>Miktar</th><th>Toplam Fiyat</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  function opsOrderTotalsFromPortal(portal) {
    const bagFee = Number(portal.bagFee) || 0;
    const orderAmount = Number(portal.orderAmount) || 0;
    return {
      basket: orderAmount > 0 && bagFee > 0 ? orderAmount : (Number(portal.price) || 0),
      discount: Number(portal.discount) || 0,
      campaignAmount: Number(portal.campaignAmount) || 0,
      bagFee,
      commission: Number(portal.orderCommission) > 0
        ? Number(portal.orderCommission)
        : (Number(portal.commission) || 0),
      orderCommission: Number(portal.orderCommission) || 0,
      commissionRate: portal.commissionRate ?? null,
      courierFee: Number(portal.courierFee ?? portal.deliveryFee) || 0,
      courierFeeRate: portal.courierFeeRate ?? null,
      fixedDistribution: Number(portal.fixedDistribution) || 0,
      totalDeductions: Number(portal.totalDeductions) || 0,
      withholdingRate: portal.withholdingRate ?? null,
      withholdingAmount: Number(portal.withholdingAmount) || 0,
      partialRefund: Number(portal.partialRefund) || 0,
      deliveryFee: Number(portal.deliveryFee) || 0,
      provision: Number(portal.provision) || 0,
      total: Math.max(0, Number(portal.price) - Number(portal.discount)),
      netHakedis: Number(portal.netEarning) || 0,
      settlementLoaded: true,
      ruleBased: portal.source === 'rules'
    };
  }

  function opsOrderTotals(row, lines) {
    const portal = row.portalFinancials;
    if (portal?.loaded) {
      return opsOrderTotalsFromPortal(portal);
    }

    const getir = row.getirFinancials;
    if (getir?.grossAmount > 0) {
      return opsOrderTotalsFromPortal({
        loaded: true,
        price: getir.grossAmount,
        orderAmount: getir.orderAmount,
        discount: getir.sellerDiscount,
        campaignAmount: getir.campaignAmount,
        bagFee: getir.bagFee,
        commission: getir.orderCommission,
        orderCommission: getir.orderCommission,
        commissionRate: getir.commissionRate,
        courierFee: getir.courierFee,
        courierFeeRate: getir.courierFeeRate,
        fixedDistribution: getir.fixedDistribution,
        totalDeductions: getir.totalDeductions,
        withholdingRate: getir.withholdingRate,
        withholdingAmount: getir.withholdingAmount,
        partialRefund: 0,
        deliveryFee: getir.courierFee,
        provision: 0,
        netEarning: getir.netAmount
      });
    }

    const items = Array.isArray(lines) ? lines : [];
    const lineSum = items.reduce((sum, line) => {
      const pricing = resolveOpsLineDisplayPrices(line);
      return sum + (Number(pricing.total) || 0);
    }, 0);
    const basket = lineSum > 0
      ? lineSum
      : Number(row.packageGrossAmount || row.salesAmount) || 0;
    const discount = Number(row.packageTotalDiscount) || 0;
    const lineCommission = items.reduce(
      (sum, line) => sum + (Number(line.portalCommissionAmount ?? line.saleCommissionAmount ?? line.commissionAmount) || 0),
      0
    );
    const commission = Number(row.packagePortalCommissionAmount) || lineCommission || Number(row.commissionAmount) || 0;
    const provisionNet = row.packageProvisionNet != null && row.packageProvisionNet !== ''
      ? Number(row.packageProvisionNet)
      : (Number(row.packageProvisionAmount) || 0);
    const sellerRevenue = Number(row.packageSellerRevenue) || 0;
    const discountSellerRevenue = Number(row.packageDiscountSellerRevenue) || 0;
    const total = discount > 0
      ? Math.max(0, basket - discount)
      : Number(row.salesAmount || basket) || 0;
    let netHakedis = null;
    if (sellerRevenue > 0 && discountSellerRevenue > 0) {
      netHakedis = Math.max(0, sellerRevenue - discountSellerRevenue - provisionNet);
    } else if (commission > 0) {
      netHakedis = Math.max(0, basket - discount - commission - provisionNet);
    }
    return {
      basket,
      discount,
      commission,
      commissionRate: null,
      partialRefund: Number(row.packagePartialRefund) || 0,
      deliveryFee: Number(row.packageDeliveryFee) || 0,
      provision: Number(row.portalProvisionCredit ?? row.packageProvisionAmount) || 0,
      total,
      netHakedis,
      settlementLoaded: false
    };
  }

  function renderOpsPortalFinancialsFooter(totals, channelId = '') {
    const channelLabel = opsSettlementChannelLabel(channelId);
    const commissionRate = totals.commissionRate != null
      ? '<span class="ops-portal-rate">%' + formatMoney(totals.commissionRate) + '</span>'
      : '';
    const courierRate = totals.courierFeeRate != null
      ? '<span class="ops-portal-rate">%' + formatMoney(totals.courierFeeRate) + '</span>'
      : '';
    const rows = [
      ['Fiyat', formatMoney(totals.basket) + ' ₺', ''],
      totals.discount > 0 ? ['Kampanya / İndirim', '-' + formatMoney(totals.discount) + ' ₺', 'is-deduct'] : null,
      totals.bagFee > 0 ? ['Poşet', formatMoney(totals.bagFee) + ' ₺', ''] : null,
      totals.commission > 0 ? ['Komisyon', '-' + formatMoney(totals.commission) + ' ₺', 'is-deduct', commissionRate] : null,
      totals.courierFee > 0 ? ['Kurye', '-' + formatMoney(totals.courierFee) + ' ₺', 'is-deduct', courierRate] : null,
      totals.fixedDistribution > 0 ? ['Sabit dağıtım', '-' + formatMoney(totals.fixedDistribution) + ' ₺', 'is-deduct'] : null,
      totals.partialRefund > 0 ? ['Kısmi İade', '-' + formatMoney(totals.partialRefund) + ' ₺', 'is-deduct'] : null,
      totals.deliveryFee > 0 && !totals.courierFee ? ['Teslimat Ücreti', '-' + formatMoney(totals.deliveryFee) + ' ₺', 'is-deduct'] : null,
      totals.provision !== 0 ? ['Provizyon', (totals.provision > 0 ? '+' : '-') + formatMoney(Math.abs(totals.provision)) + ' ₺', totals.provision > 0 ? 'is-credit' : 'is-deduct'] : null,
      totals.withholdingAmount > 0 ? ['Stopaj', '-' + formatMoney(totals.withholdingAmount) + ' ₺', 'is-deduct'] : null,
      totals.netHakedis != null ? ['İşletme alacağı', formatMoney(totals.netHakedis) + ' ₺', 'is-net'] : null
    ].filter(Boolean);

    const sourceNote = channelId === 'getir'
      ? 'Kaynak: PetFix Getir kural hesabı.'
      : 'Kaynak: ' + esc(channelLabel) + ' cari ekstre.';

    return '<div class="ops-portal-financials">' +
      '<div class="ops-portal-financials-head">' + esc(channelLabel) + ' gider özeti</div>' +
      '<table class="ops-portal-financials-table"><tbody>' +
      rows.map((row) =>
        '<tr><th>' + esc(row[0]) + '</th><td class="' + escAttr(row[2] || '') + '">' +
          '<strong>' + row[1] + '</strong>' + (row[3] || '') +
        '</td></tr>'
      ).join('') +
      '</tbody></table>' +
      '<p class="muted ops-detail-settlement-note">' + sourceNote + '</p>' +
    '</div>';
  }

  function renderOpsOrderTotalsFooter(totals, channelId = '') {
    if (totals.settlementLoaded) {
      return renderOpsPortalFinancialsFooter(totals, channelId);
    }

    const channelLabel = opsSettlementChannelLabel(channelId);
    const settlementNote = channelId === 'getir'
      ? ''
      : (channelId === 'uber-eats' || channelId === 'yemeksepeti')
        ? '<p class="muted ops-detail-settlement-note">' + esc(channelLabel) +
          ' gider özeti henüz yüklenmedi; komisyon ve net hakediş tahmini olabilir.</p>'
        : '';

    const discountRow = totals.discount > 0
      ? '<div class="ops-detail-total-row ops-detail-total-row--discount">' +
          '<span>İndirim</span><strong>-' + formatMoney(totals.discount) + ' ₺</strong>' +
        '</div>'
      : '';
    const commissionRow = totals.commission > 0
      ? '<div class="ops-detail-total-row ops-detail-total-row--commission">' +
          '<span>Komisyon</span><strong>-' + formatMoney(totals.commission) + ' ₺</strong>' +
        '</div>'
      : '';
    const netRow = totals.netHakedis != null
      ? '<div class="ops-detail-total-row ops-detail-total-row--net">' +
          '<span>Net Hakediş</span><strong>' + formatMoney(totals.netHakedis) + ' ₺</strong>' +
        '</div>'
      : '';
    const grandLabel = totals.netHakedis != null ? 'Ara Toplam' : 'TOPLAM';
    const grandValue = totals.netHakedis != null ? totals.total : totals.total;
    return '<div class="ops-detail-totals">' +
      '<div class="ops-detail-total-row"><span>Sepet</span><strong>' + formatMoney(totals.basket) + ' ₺</strong></div>' +
      discountRow +
      commissionRow +
      (totals.netHakedis != null
        ? '<div class="ops-detail-total-row ops-detail-total-row--subtotal">' +
            '<span>' + grandLabel + '</span><strong>' + formatMoney(grandValue) + ' ₺</strong>' +
          '</div>' + netRow
        : '<div class="ops-detail-total-row ops-detail-total-row--grand">' +
            '<span>TOPLAM</span><strong>' + formatMoney(totals.total) + ' ₺</strong>' +
          '</div>') +
      settlementNote +
    '</div>';
  }

  function renderProfitSummary(row) {
    const warnings = [...new Set([...(row.dataWarnings || []), ...(row.matchingWarnings || [])])];
    const profitClass = Number(row.netProfit) < 0 ? 'is-loss' : 'is-profit';
    let html = '';
    if (warnings.length) {
      html += '<p class="orders-warn-box">' + esc(warnings.join(' · ')) + '</p>';
    }
    html += '<div class="ops-profit-detail-strip detail-grid">' +
      detailItem('Kâr güveni', esc(row.profitConfidenceLabel || row.profitConfidence || '—')) +
      detailItem('Ürün maliyeti', '₺' + formatMoney(row.productCost)) +
      detailItem('Komisyon', '₺' + formatMoney(row.commissionAmount)) +
      detailItem('Kurye ücreti', '₺' + formatMoney(row.shippingCost)) +
      detailItem('Hizmet bedeli', '₺' + formatMoney(row.serviceFee)) +
      detailItem('Stopaj', '₺' + formatMoney(row.stopajAmount)) +
      detailItem('Net kâr', '<span class="' + profitClass + '">' + formatSignedMoney(row.netProfit) + '</span>') +
      detailItem('Kâr marjı', formatPercent(row.profitMargin)) +
    '</div>';
    return html;
  }

  function renderBody(row, opts = {}) {
    const channelId = channelLogoId(row.channel || row.channelId || '');
    const logos = channelLogos();
    const totals = opsOrderTotals(row, row.lines || []);
    const channelBlock = renderOpsChannelBlock(channelId, logos, row.channelLabel);
    const profitHtml = opts.showProfitSummary ? renderProfitSummary(row) : '';

    return profitHtml +
      '<div class="ops-detail-layout ops-detail-layout--hzlmrktops">' +
        '<section class="ops-detail-section ops-detail-section--products">' +
          '<h4>Ürün Bilgileri</h4>' +
          renderOpsLineItems(row.lines, channelId) +
          renderOpsOrderTotalsFooter(totals, channelId) +
        '</section>' +
        '<div class="ops-detail-side">' +
          '<section class="ops-detail-section">' +
            '<h4>Müşteri Bilgileri</h4>' +
            '<dl class="ops-detail-dl">' +
              detailItem('Adı Soyadı', esc(row.customerName || '—')) +
              detailItem('TC Kimlik No', esc(row.customerIdentityNumber || '—')) +
              detailItem('Telefon', esc(formatOpsPhone(row))) +
              detailItem('Adres', esc(row.customerAddress || '—')) +
              detailItem('Müşteri notu', esc(row.customerNote || '—')) +
            '</dl>' +
          '</section>' +
          '<section class="ops-detail-section">' +
            '<h4>Kurye Bilgileri</h4>' +
            '<dl class="ops-detail-dl">' +
              detailItem('Kurye', esc(row.deliveryMethod || '—')) +
              detailItem('Telefon', esc(row.courierPhone || '—')) +
            '</dl>' +
          '</section>' +
          '<section class="ops-detail-section">' +
            '<h4>Sipariş Bilgileri</h4>' +
            '<dl class="ops-detail-dl">' +
              detailItem('Sipariş Kodu', esc(row.orderNumber || '—')) +
              '<div><span>Sipariş Durumu</span><strong>' + renderOpsStatusPill(row.status) + '</strong></div>' +
              '<div><span>Satış Kanalı</span><strong class="ops-channel-value">' + channelBlock + '</strong></div>' +
              detailItem('Ödeme Yöntemi', esc(row.paymentMethod || 'Online')) +
              detailItem('Not', esc(row.orderNote || '—')) +
              detailItem('Sipariş Tarihi', esc(formatOpsDate(row.orderDateMs || row.orderDate))) +
              detailItem('Teslim Tarihi', esc(formatOpsDeliveryDate(row))) +
            '</dl>' +
          '</section>' +
        '</div>' +
      '</div>';
  }

  window.OpsOrderDetail = {
    renderBody,
    channelLogoId,
    renderChannelLogo(channelId) {
      const logos = channelLogos();
      const id = channelLogoId(channelId);
      if (id && logos?.render) return logos.render(id, { size: 'sm' });
      return '<span class="pf-channel-logo pf-channel-logo--sm">?</span>';
    },
    translateStatus
  };
})();
