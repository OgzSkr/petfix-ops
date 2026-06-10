export function buildTgoStockPushSimulation(items = []) {
  return {
    channel: 'trendyol_go',
    blocked: true,
    reason: 'G2_FAIL — TGO grocery inventory endpoint doğrulanmadı',
    wouldSend: items.map((item) => ({
      barcode: item.barcode,
      quantity: item.targetQuantity,
      channelProductId: item.channelProductId
    }))
  };
}

export async function writeTgoStock(_items, _platformEnv) {
  throw Object.assign(
    new Error('TGO stok push kapalı — G2_FAIL. Read-only shadow kullanın.'),
    { statusCode: 503, code: 'G2_FAIL' }
  );
}
