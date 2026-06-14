const OPS_TO_BUYBOX_CHANNEL = Object.freeze({
  trendyol_go: 'uber-eats',
  yemeksepeti: 'yemeksepeti',
  getir: 'getir'
});

export function mapOpsChannelToBuybox(channel) {
  return OPS_TO_BUYBOX_CHANNEL[String(channel || '').trim()] || null;
}

export function opsOrderToBenimposPackage(order, lines) {
  return {
    orderNumber: order.display_id || order.external_id,
    id: order.external_id,
    orderDate: order.ordered_at || order.orderDate || null,
    lines: (lines || []).map((line) => ({
      barcode: line.barcode,
      productName: line.title,
      name: line.title,
      title: line.title,
      quantity: Number(line.quantity),
      lineUnitPrice: line.unit_price != null ? Number(line.unit_price) : undefined,
      price: line.unit_price != null ? Number(line.unit_price) : undefined,
      vatRate: 20
    }))
  };
}
