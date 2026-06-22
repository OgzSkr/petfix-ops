/** Portal sipariş detay sayfası / drawer metninden satır çıkarımı. */

const MONEY_RE = /₺\s*([\d.,]+)/;

export function parsePortalOrderDetailLines(text = '') {
  const source = String(text || '');
  const start = source.indexOf('Sipariş Detayları');
  const end = source.indexOf('Nihai ara toplam');
  if (start < 0) {
    return [];
  }

  const block = source.slice(start, end > start ? end : start + 8000);
  const lines = [];
  const chunks = block.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  for (let i = 0; i < chunks.length; i += 1) {
    const qtyMatch = chunks[i].match(/^(\d+)\s*×$/);
    if (!qtyMatch) {
      continue;
    }

    const quantity = Number(qtyMatch[1]) || 1;
    let name = '';
    let unitPrice = 0;

    for (let j = i + 1; j < Math.min(i + 6, chunks.length); j += 1) {
      const part = chunks[j];
      if (/^(\d+)\s*×$/.test(part)) {
        break;
      }
      const money = part.match(MONEY_RE);
      if (money) {
        unitPrice = parsePortalMoney(money[1]);
        break;
      }
      if (!name && part.length > 2 && !/sipariş detayları/i.test(part)) {
        name = part;
      }
    }

    if (name) {
      lines.push({
        name,
        quantity,
        unitPrice,
        lineTotal: unitPrice * quantity
      });
    }
  }

  return lines;
}

function parsePortalMoney(value) {
  const normalized = String(value || '').replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function parsePortalOrderCodes(text = '') {
  const matches = String(text || '').match(/jk2w-\d+-[a-z0-9]+/gi) || [];
  return [...new Set(matches.map((code) => code.toLowerCase()))];
}
