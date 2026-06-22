import {
  resolveTrendyolCityName,
  resolveTrendyolDistrictName
} from './trendyol-address-lookup.js';

export const TGO_MASK_PLACEHOLDER = 'TGO Hızlı Market';

export function isTgoMaskedField(value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  return text === TGO_MASK_PLACEHOLDER || /tgo hızlı market/i.test(text);
}

function joinNameParts(...parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatTgoCustomerName(customer = {}, shipmentAddress = {}, invoiceAddress = {}) {
  const fromCustomer = joinNameParts(customer.fullName, customer.firstName, customer.lastName);
  if (fromCustomer) return fromCustomer;

  const fromShipment = joinNameParts(shipmentAddress.firstName, shipmentAddress.lastName);
  if (fromShipment) return fromShipment;

  return joinNameParts(invoiceAddress.firstName, invoiceAddress.lastName) || null;
}

function pickReadableAddressField(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && !isTgoMaskedField(text)) return text;
  }
  return null;
}

function formatUnmaskedAddress(address = {}) {
  const parts = [
    pickReadableAddressField(address.addressDescription, address.address1, address.addressLine),
    pickReadableAddressField(address.neighborhood),
    pickReadableAddressField(address.district),
    pickReadableAddressField(address.city)
  ].filter(Boolean);

  return parts.length ? parts.join(' / ') : null;
}

export async function formatTgoCustomerAddress(pkg = {}, cfg = null) {
  const shipment = pkg.shipmentAddress || {};
  const invoice = pkg.invoiceAddress || {};
  const address = shipment.id ? shipment : invoice;

  const direct = formatUnmaskedAddress(address) || formatUnmaskedAddress(invoice);
  if (direct) return direct;

  const cityId = Number(address.cityId || invoice.cityId || 0) || null;
  const districtId = Number(address.districtId || invoice.districtId || 0) || null;
  const cityCode = Number(address.cityCode || invoice.cityCode || 0) || null;

  let districtName = pickReadableAddressField(address.district, invoice.district);
  let cityName = pickReadableAddressField(address.city, invoice.city);

  if (cfg && cityId && districtId && (!districtName || isTgoMaskedField(districtName))) {
    districtName = await resolveTrendyolDistrictName(cityId, districtId, cfg) || districtName;
  }
  if (cfg && cityId && (!cityName || isTgoMaskedField(cityName))) {
    cityName = await resolveTrendyolCityName(cityId, cfg) || cityName;
  }
  if (!cityName && cityCode === 34) {
    cityName = 'İstanbul';
  }

  const locationParts = [districtName, cityName]
    .map((part) => String(part || '').trim())
    .filter((part) => part && !isTgoMaskedField(part));

  return locationParts.length ? locationParts.join(' / ') : null;
}

export function formatTgoCustomerPhone(shipmentAddress = {}, invoiceAddress = {}, options = {}) {
  const locationMasked = Boolean(options.locationMasked);
  const phone = String(shipmentAddress.phone || invoiceAddress.phone || '').trim();
  if (!phone) return null;
  if (locationMasked && phone.startsWith('0212')) return null;
  return phone;
}

export function formatTgoCustomerIdentity(shipmentAddress = {}, invoiceAddress = {}) {
  const value = String(
    shipmentAddress.identityNumber || invoiceAddress.identityNumber || ''
  ).trim();
  if (!value || isTgoMaskedField(value)) return null;
  return value;
}

/**
 * Trendyol Go grocery paketinden fatura için minimum müşteri alanları.
 */
export async function extractTgoCustomerFields(pkg = {}, cfg = null) {
  const customer = pkg.customer || {};
  const shipmentAddress = pkg.shipmentAddress || {};
  const invoiceAddress = pkg.invoiceAddress || {};
  const locationMasked = Boolean(pkg.locationMasked);

  return {
    customerName: formatTgoCustomerName(customer, shipmentAddress, invoiceAddress),
    customerPhone: formatTgoCustomerPhone(shipmentAddress, invoiceAddress, { locationMasked }),
    customerAddress: await formatTgoCustomerAddress(pkg, cfg),
    customerIdentityNumber: formatTgoCustomerIdentity(shipmentAddress, invoiceAddress),
    customerNote: String(customer.note || '').trim() || null,
    customerLocationMasked: locationMasked,
    tgoPackageId: pkg.id ? String(pkg.id) : null
  };
}
