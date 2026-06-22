function readNestedCustomer(raw = {}) {
  const order = raw.yemeksepetiOrder || raw.order || {};
  return {
    ...(raw.client && typeof raw.client === 'object' ? raw.client : {}),
    ...(raw.customer && typeof raw.customer === 'object' ? raw.customer : {}),
    ...(order.customer && typeof order.customer === 'object' ? order.customer : {}),
    ...(order.delivery?.customer && typeof order.delivery.customer === 'object' ? order.delivery.customer : {})
  };
}

function isLikelyPhone(value) {
  const text = String(value || '').trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 10) return true;
  if (text.includes('*') && digits.length >= 4 && text.length >= 8) return true;
  return false;
}

function isLikelyEmail(value) {
  const text = String(value || '').trim();
  return text.includes('@') && !/\s/.test(text);
}

function pickReadablePhone(candidates = []) {
  let masked = null;
  for (const value of candidates) {
    if (value == null || value === '') continue;
    const text = String(value).trim();
    if (!isLikelyPhone(text)) continue;
    if (!text.includes('*')) return text;
    masked = masked || text;
  }
  return masked;
}

function pickReadableEmail(candidates = []) {
  for (const value of candidates) {
    if (value == null || value === '') continue;
    const text = String(value).trim();
    if (isLikelyEmail(text)) return text;
  }
  return null;
}

/** Getir: "+90 (800) 606-0102 / 154091" → santral + pin */
export function parseGetirMaskedPhoneNumber(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(.+?)\s*\/\s*(\d{4,8})\s*$/);
  if (!match) return null;
  return {
    phone: match[1].trim(),
    pin: match[2].trim()
  };
}

function getGetirRelayContact(raw = {}) {
  const customer = raw.customer || raw.client || {};
  const masked =
    customer.clientMaskedPhoneNumber ||
    customer.maskedPhoneNumber ||
    raw.clientMaskedPhoneNumber ||
    null;
  return parseGetirMaskedPhoneNumber(masked);
}

function normalizePhoneDigits(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('90')) {
    digits = digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
}

/** Getir / Uber ortak santral hattı — müşteri kimliği için kullanılmaz. */
export function isSharedRelayPhone(phone) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return false;
  if (digits.length === 10 && digits.startsWith('5')) return false;
  if (digits.startsWith('800') || digits.startsWith('850')) return true;
  if (digits.startsWith('212')) return true;
  const raw = String(phone || '').replace(/\D/g, '');
  if (raw.startsWith('0212') || raw.startsWith('0850') || raw.startsWith('0800')) return true;
  return false;
}

export function normalizeCustomerPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

function normalizeNameSlug(name) {
  return String(name || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

export function extractPlatformCustomerId(row) {
  const raw = row.raw_payload || {};
  const nested = readNestedCustomer(raw);
  const candidates = [
    nested.id,
    nested._id,
    nested.customerId,
    nested.clientId,
    raw.client?.id,
    raw.client?._id,
    raw.customer?.id,
    raw.customer?._id
  ];
  for (const value of candidates) {
    const text = String(value || '').trim();
    if (text && text.length >= 6) return text;
  }
  return null;
}

function resolveTrendyolGoRelayPin(raw, { displayId = null, externalId = null } = {}) {
  const display = String(displayId || '').trim();
  if (/^\d{10,12}$/.test(display)) return display;

  const orderNumber = String(raw.orderNumber || raw.customer?.orderNumber || '').trim();
  if (/^\d{10,12}$/.test(orderNumber)) return orderNumber;

  const orderId = String(raw.orderId || '').trim();
  if (orderId.startsWith('10') && orderId.length > 10) {
    return orderId.slice(2);
  }
  if (/^\d{10,12}$/.test(orderId)) return orderId;

  const external = String(externalId || '').trim();
  if (/^\d{10,12}$/.test(external)) return external;

  return String(raw.packageId || '').trim() || null;
}

export function extractRelayPin(row, { displayId = null, externalId = null } = {}) {
  const raw = row.raw_payload || {};
  const channel = row.channel;
  if (channel === 'trendyol_go') {
    return resolveTrendyolGoRelayPin(raw, { displayId, externalId });
  }
  if (channel === 'getir') {
    const relay = getGetirRelayContact(raw);
    if (relay?.pin) return relay.pin;
    return String(
      raw.confirmationId ||
      raw.orderNumber ||
      displayId ||
      externalId ||
      ''
    ).trim() || null;
  }
  if (channel === 'yemeksepeti') {
    return String(
      raw.order_code ||
      raw.orderCode ||
      raw.yemeksepetiOrder?.order_code ||
      displayId ||
      externalId ||
      ''
    ).trim() || null;
  }
  return String(displayId || externalId || '').trim() || null;
}

function formatPhoneDisplay(phone) {
  const trimmed = String(phone || '').trim();
  const digits = normalizePhoneDigits(trimmed);
  if (digits.length === 10 && digits.startsWith('800')) {
    return `+90 (${digits.slice(0, 3)}) ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
  }
  if (!digits) return trimmed;
  if (digits.length === 10 && digits.startsWith('5')) {
    return `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
  }
  if (trimmed.startsWith('+') || trimmed.includes('(')) {
    return trimmed.replace(/\s+/g, ' ').replace(/(\d{3})-(\d{4})$/, '$1 $2');
  }
  const rawDigits = String(phone || '').replace(/\D/g, '');
  if (rawDigits.length === 11 && rawDigits.startsWith('0')) {
    return `0 (${rawDigits.slice(1, 4)}) ${rawDigits.slice(4, 7)} ${rawDigits.slice(7, 9)} ${rawDigits.slice(9, 11)}`;
  }
  return trimmed;
}

function formatRelayPhoneDialString(phone, pin) {
  const formatted = formatPhoneDisplay(phone) || String(phone || '').trim();
  if (!pin) return formatted;
  return `${formatted},${pin}`;
}

function phoneDigitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Web / mobil `tel:` URI — Uber'de pin otomatik tuşlanır (,,,); Getir'de santral + manuel pin. */
export function buildCustomerPhoneDialUri(channel, { phoneRaw, phonePin, isRelayPhone } = {}) {
  const digits = phoneDigitsOnly(phoneRaw);
  if (!digits) return null;

  const pinDigits = phoneDigitsOnly(phonePin);
  const ch = String(channel || '').trim();

  if (isRelayPhone && ch === 'trendyol_go' && pinDigits) {
    return `tel:${digits},,,${pinDigits}`;
  }
  if (isRelayPhone) {
    return `tel:${digits}`;
  }
  return `tel:${digits}`;
}

export function buildCustomerPhoneDisplay(row, meta = {}) {
  const rawPhone = extractCustomerPhone(row);
  const pin = extractRelayPin(row, meta);
  if (rawPhone && isSharedRelayPhone(rawPhone)) {
    return formatRelayPhoneDialString(rawPhone, pin);
  }
  if (!rawPhone && pin && (row.channel === 'trendyol_go' || row.channel === 'getir')) {
    return pin;
  }
  return rawPhone ? formatPhoneDisplay(rawPhone) || rawPhone : null;
}

export function buildCustomerIdentityKey(channel, { phone, name, platformCustomerId } = {}) {
  const platformId = String(platformCustomerId || '').trim();
  if (platformId) return `${channel}:cid:${platformId}`;

  const normalizedPhone = normalizeCustomerPhone(phone);
  if (normalizedPhone && !isSharedRelayPhone(phone)) {
    return `${channel}:tel:${normalizedPhone}`;
  }

  const slug = normalizeNameSlug(name);
  if (slug) return `${channel}:name:${slug}`;
  return `${channel}:anon`;
}

export function extractCustomerName(row) {
  const fromRaw = extractNameFromRaw(row.raw_payload || {});
  const masked = String(row.customer_masked?.name || '').trim();
  if (fromRaw) return fromRaw;
  if (masked && !masked.includes('*')) return masked;
  return masked || null;
}

export function extractCustomerPhone(row) {
  const raw = row.raw_payload || {};
  if (row.channel === 'getir') {
    const relay = getGetirRelayContact(raw);
    if (relay?.phone) return relay.phone;
  }
  const cm = row.customer_masked || {};
  const nested = readNestedCustomer(raw);
  const shipment = raw.shipmentAddress || {};
  const invoice = raw.invoiceAddress || {};

  return pickReadablePhone([
    cm.phone,
    cm.mobile,
    nested.phone,
    nested.mobile,
    nested.phoneNumber,
    nested.gsm,
    nested.contactPhone,
    shipment.phone,
    invoice.phone
  ]);
}

export function extractCustomerEmail(row) {
  const raw = row.raw_payload || {};
  const cm = row.customer_masked || {};
  const nested = readNestedCustomer(raw);
  const shipment = raw.shipmentAddress || {};
  const invoice = raw.invoiceAddress || {};

  return pickReadableEmail([
    cm.email,
    cm.mail,
    nested.email,
    nested.mail,
    nested.emailAddress,
    shipment.email,
    invoice.email
  ]);
}

export function buildCustomerContact(row, meta = {}) {
  const phoneRaw = extractCustomerPhone(row);
  const phonePin = extractRelayPin(row, meta);
  const isRelayPhone = Boolean(phoneRaw && isSharedRelayPhone(phoneRaw));
  return {
    name: extractCustomerName(row),
    phoneRaw,
    phonePin,
    phone: buildCustomerPhoneDisplay(row, meta),
    isRelayPhone,
    email: extractCustomerEmail(row),
    platformCustomerId: extractPlatformCustomerId(row)
  };
}

export function extractCustomerAddress(row) {
  const cm = row.customer_masked || {};
  if (cm.address && !String(cm.address).includes('*')) return String(cm.address).trim();
  const raw = row.raw_payload || {};
  const nested = readNestedCustomer(raw);
  if (nested.address) return String(nested.address).trim();
  const shipment = raw.shipmentAddress || {};
  const invoice = raw.invoiceAddress || {};
  const parts = [
    shipment.addressDescription || shipment.address1 || shipment.address,
    shipment.neighborhood,
    shipment.district,
    shipment.city,
    invoice.addressDescription || invoice.address1 || invoice.address,
    invoice.district,
    invoice.city
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  if (parts.length) return parts.join(' / ');
  const order = raw.yemeksepetiOrder || raw.order || raw;
  const delivery = order.delivery || order.delivery_address || {};
  const address = delivery.address || delivery.full_address || delivery.fullAddress || null;
  return address ? String(address).trim() : null;
}

export function extractAddressNote(row) {
  const raw = row.raw_payload || {};
  const order = raw.yemeksepetiOrder || raw.order || raw;
  const delivery = order.delivery || {};
  const note =
    delivery.notes ||
    delivery.note ||
    delivery.addressNote ||
    delivery.address_note ||
    raw.addressNote ||
    null;
  return note ? String(note).trim() : null;
}

export function buildOrderCustomerView(row, meta = {}) {
  const contact = buildCustomerContact(row, meta);
  return {
    customerName: contact.name,
    customerPhone: contact.phone,
    customerPhoneRaw: contact.phoneRaw,
    customerPhonePin: contact.phonePin,
    isRelayPhone: contact.isRelayPhone,
    customerEmail: contact.email,
    deliveryAddress: extractCustomerAddress(row),
    addressNote: extractAddressNote(row)
  };
}

function extractNameFromRaw(raw) {
  const nested = readNestedCustomer(raw);
  const name = nested.name || nested.full_name || nested.fullName || null;
  if (name) return String(name).trim();
  const shipment = raw.shipmentAddress || {};
  const invoice = raw.invoiceAddress || {};
  const fromAddress = [
    [shipment.firstName, shipment.lastName].filter(Boolean).join(' '),
    [invoice.firstName, invoice.lastName].filter(Boolean).join(' ')
  ].find((part) => String(part || '').trim());
  return fromAddress ? String(fromAddress).trim() : null;
}
