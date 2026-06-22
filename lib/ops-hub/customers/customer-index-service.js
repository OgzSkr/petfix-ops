import {
  buildCustomerContact,
  buildCustomerIdentityKey,
  buildCustomerPhoneDialUri
} from '../customer/order-customer-view.js';
import { stableCustomerDisplayId } from '../customer/customer-id.js';

const CHANNEL_LABELS = {
  getir: 'Getir',
  yemeksepeti: 'Yemeksepeti',
  trendyol_go: 'Uber / TGO'
};

function normalizeSearch(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

async function queryCustomerIndexMeta(pool, { branchId, liveOnly = true }) {
  const params = [branchId];
  const clauses = [
    'branch_id = $1',
    `status NOT IN ('cancelled', 'failed')`
  ];
  if (liveOnly) clauses.push('shadow_mode = FALSE');

  const result = await pool.query(
    `SELECT
       MIN(ordered_at) AS oldest_order_at,
       MAX(ordered_at) AS newest_order_at,
       COUNT(*)::int AS source_order_count
     FROM ops_orders
     WHERE ${clauses.join(' AND ')}`,
    params
  );
  const row = result.rows[0] || {};
  return {
    oldestOrderAt: row.oldest_order_at || null,
    newestOrderAt: row.newest_order_at || null,
    sourceOrderCount: Number(row.source_order_count || 0)
  };
}

export async function listOpsCustomers(pool, {
  branchId,
  search = '',
  page = 1,
  limit = 50,
  liveOnly = true,
  all = false
} = {}) {
  if (!pool || !branchId) {
    throw Object.assign(new Error('branchId zorunlu'), { statusCode: 400 });
  }

  const params = [branchId];
  const clauses = [
    'branch_id = $1',
    `status NOT IN ('cancelled', 'failed')`
  ];
  if (liveOnly) clauses.push('shadow_mode = FALSE');

  const [result, meta] = await Promise.all([
    pool.query(
      `SELECT id, channel, ordered_at, raw_payload, customer_masked, display_id, external_id
       FROM ops_orders
       WHERE ${clauses.join(' AND ')}
       ORDER BY ordered_at DESC`,
      params
    ),
    queryCustomerIndexMeta(pool, { branchId, liveOnly })
  ]);

  const map = new Map();
  for (const row of result.rows) {
    const meta = { displayId: row.display_id, externalId: row.external_id };
    const contact = buildCustomerContact(row, meta);
    const identityKey = buildCustomerIdentityKey(row.channel, {
      phone: contact.phoneRaw,
      name: contact.name,
      platformCustomerId: contact.platformCustomerId
    });
    const existing = map.get(identityKey);
    const orderedAt = row.ordered_at;

    if (!existing) {
      map.set(identityKey, {
        identityKey,
        id: stableCustomerDisplayId(identityKey),
        channel: row.channel,
        channelLabel: CHANNEL_LABELS[row.channel] || row.channel,
        name: contact.name || '—',
        phone: contact.phone || null,
        phoneRaw: contact.phoneRaw || null,
        phonePin: contact.phonePin || null,
        phoneDial: buildCustomerPhoneDialUri(row.channel, contact),
        isRelayPhone: contact.isRelayPhone,
        email: contact.email || null,
        orderCount: 1,
        lastOrderAt: orderedAt,
        lastOrderId: row.id
      });
      continue;
    }

    existing.orderCount += 1;
    if (!existing.phone && contact.phone) existing.phone = contact.phone;
    if (!existing.phoneRaw && contact.phoneRaw) existing.phoneRaw = contact.phoneRaw;
    if (!existing.phonePin && contact.phonePin) existing.phonePin = contact.phonePin;
    if (!existing.phoneDial && contact.phoneRaw) {
      existing.phoneDial = buildCustomerPhoneDialUri(row.channel, contact);
    }
    if (!existing.email && contact.email) existing.email = contact.email;
    if (!existing.name && contact.name) existing.name = contact.name;
    if (new Date(orderedAt).getTime() > new Date(existing.lastOrderAt).getTime()) {
      existing.lastOrderAt = orderedAt;
      existing.lastOrderId = row.id;
      if (contact.phone) existing.phone = contact.phone;
      if (contact.phoneRaw) existing.phoneRaw = contact.phoneRaw;
      if (contact.phonePin) existing.phonePin = contact.phonePin;
      existing.phoneDial = buildCustomerPhoneDialUri(row.channel, contact);
      existing.isRelayPhone = contact.isRelayPhone;
    }
  }

  let customers = Array.from(map.values());
  const needle = normalizeSearch(search);
  if (needle) {
    customers = customers.filter((row) =>
      normalizeSearch(row.name).includes(needle)
      || normalizeSearch(row.phone).includes(needle)
      || normalizeSearch(row.phonePin).includes(needle)
      || normalizeSearch(row.email).includes(needle)
    );
  }

  customers.sort((a, b) => new Date(b.lastOrderAt).getTime() - new Date(a.lastOrderAt).getTime());

  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 5000));
  const safePage = Math.max(1, Number(page) || 1);
  const total = customers.length;
  const returnAll = all || safeLimit >= 5000;

  const metaBlock = {
    ...meta,
    liveOnly,
    uniqueCustomers: total
  };

  if (returnAll) {
    return {
      ok: true,
      total,
      page: 1,
      limit: total,
      pages: 1,
      items: customers,
      meta: metaBlock
    };
  }

  const offset = (safePage - 1) * safeLimit;
  const items = customers.slice(offset, offset + safeLimit);

  return {
    ok: true,
    total,
    page: safePage,
    limit: safeLimit,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
    items,
    meta: metaBlock
  };
}
