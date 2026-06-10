export function buildProductPoolUrl(channelId = 'uber-eats', options = {}) {
  const params = new URLSearchParams();
  const tab = String(options.tab || channelId || 'master').trim();
  if (tab) params.set('tab', tab);

  const query = String(options.q || options.barcode || '').trim();
  if (query) params.set('q', query);

  const status = String(options.status || '').trim();
  if (status) params.set('status', status);

  const queueMode = String(options.queueMode || '').trim();
  if (queueMode) params.set('queueMode', queueMode);

  if (options.openMap) params.set('openMap', '1');

  const qs = params.toString();
  return qs ? `/products?${qs}` : '/products';
}

export function productPoolUrlForMappingStatus(channelId, channelBarcode, mappingStatus) {
  const barcode = String(channelBarcode || '').trim();
  if (mappingStatus === 'missing_master') {
    return buildProductPoolUrl(channelId, { tab: 'workbench', queueMode: 'missing_master', q: barcode });
  }
  if (mappingStatus === 'barcode_conflict') {
    return buildProductPoolUrl(channelId, { tab: 'conflicts' });
  }
  return buildProductPoolUrl(channelId, {
    tab: channelId,
    q: barcode,
    status: mappingStatus && mappingStatus !== 'legacy' ? mappingStatus : '',
    openMap: true
  });
}
