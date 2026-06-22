import { roundMoney } from '../utils.js';

export function sumTgoLineQuantity(line) {
  const items = Array.isArray(line?.items) ? line.items : [];
  const active = items.filter((item) => !item.isCancelled);
  if (active.length) return active.length;
  return Number(line?.quantity) || 1;
}

/**
 * TGO grocery paket satırı fiyat çözümü.
 * price = liste/katalog birim fiyat, amount = ödenen satır toplamı.
 * Panel ve BenimPOS katalog birimini kullanır; komisyon/kâr için paidLineGross ayrı tutulur.
 */
export function resolveTgoLinePricing(line) {
  const quantity = sumTgoLineQuantity(line);
  const amount = line?.amount != null && line?.amount !== ''
    ? Number(line.amount)
    : null;
  const price = line?.price != null && line?.price !== ''
    ? Number(line.price)
    : null;

  if (amount != null && Number.isFinite(amount) && amount > 0) {
    const paidUnit = quantity > 0 ? amount / quantity : amount;
    const paidUnitPrice = roundMoney(paidUnit);
    let listUnitPrice = paidUnitPrice;

    if (price != null && Number.isFinite(price) && price > 0) {
      if (
        price > paidUnit + 0.02
        && price <= paidUnit * 3
        && price * quantity > amount + 0.02
      ) {
        listUnitPrice = roundMoney(price);
      } else if (Math.abs(price - paidUnit) < 0.02) {
        listUnitPrice = roundMoney(price);
      } else if (
        Math.abs(price - amount) < 0.02
        && quantity > 1
        && price > paidUnit * 3
      ) {
        listUnitPrice = paidUnitPrice;
      }
    }

    return {
      quantity,
      unitPrice: listUnitPrice,
      paidUnitPrice,
      listUnitPrice,
      lineGross: roundMoney(listUnitPrice * quantity),
      paidLineGross: roundMoney(amount)
    };
  }

  if (price != null && Number.isFinite(price) && price > 0) {
    const unitPrice = roundMoney(price);
    const lineGross = roundMoney(price * quantity);
    return {
      quantity,
      unitPrice,
      paidUnitPrice: unitPrice,
      listUnitPrice: unitPrice,
      lineGross,
      paidLineGross: lineGross
    };
  }

  return {
    quantity,
    unitPrice: 0,
    paidUnitPrice: 0,
    listUnitPrice: 0,
    lineGross: 0,
    paidLineGross: 0
  };
}
