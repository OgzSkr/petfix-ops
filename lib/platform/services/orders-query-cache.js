export function buildOrdersQueryCacheKey(searchParams) {
  const days = String(searchParams.get('days') || '').trim();
  const startDate = String(searchParams.get('startDate') || '').trim();
  const endDate = String(searchParams.get('endDate') || '').trim();

  if (startDate) {
    return `custom:${startDate}:${endDate || ''}`;
  }

  return `days:${days || '1'}`;
}

export function getOrdersQueryCacheEntry(runtime, bucket, key) {
  if (!runtime[bucket]) {
    runtime[bucket] = {};
  }
  if (!runtime[bucket][key]) {
    runtime[bucket][key] = { lastFetchAt: 0, payload: null };
  }
  return runtime[bucket][key];
}
