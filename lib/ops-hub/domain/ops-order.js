import {
  CHANNEL_INTEGRATION_MODES,
  DELIVERY_MODES,
  OPS_LINE_MATCHING_STATUSES,
  OPS_ORDER_STATUSES,
  isOpsChannel,
  isOpsOrderStatus
} from '../constants.js';
import { ORDER_SOURCES } from '../../production/constants.js';
import { maskCustomerPayload } from './pii.js';

export function buildOpsOrderIdempotencyKey({ channel, externalId, eventType = 'ingest' }) {
  return `${channel}:${externalId}:${eventType}`;
}

export function normalizeOpsOrderInput(input, { shadowModeDefault = true } = {}) {
  const errors = [];
  const channel = String(input?.channel || '').trim();

  if (!isOpsChannel(channel)) {
    errors.push(`Geçersiz channel: ${channel}`);
  }

  const externalId = String(input?.externalId ?? '').trim();
  if (!externalId) {
    errors.push('externalId zorunlu');
  }

  const status = String(input?.status || 'received').trim();
  if (!isOpsOrderStatus(status)) {
    errors.push(`Geçersiz status: ${status}`);
  }

  const integrationMode = String(input?.channelIntegrationMode || 'direct').trim();
  if (!CHANNEL_INTEGRATION_MODES.includes(integrationMode)) {
    errors.push(`Geçersiz channelIntegrationMode: ${integrationMode}`);
  }

  const deliveryMode = String(input?.deliveryMode || 'unknown').trim();
  if (!DELIVERY_MODES.includes(deliveryMode)) {
    errors.push(`Geçersiz deliveryMode: ${deliveryMode}`);
  }

  const lines = Array.isArray(input?.lines) ? input.lines : [];
  if (!lines.length) {
    errors.push('En az bir satır zorunlu');
  }

  const normalizedLines = [];
  for (const [index, line] of lines.entries()) {
    const lineErrors = validateOpsOrderLine(line, index);
    if (lineErrors.length) {
      errors.push(...lineErrors);
      continue;
    }
    normalizedLines.push(normalizeOpsOrderLine(line, index));
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  const orderedAt = input?.orderedAt ? new Date(input.orderedAt) : new Date();
  if (Number.isNaN(orderedAt.getTime())) {
    errors.push('orderedAt geçersiz');
    return { ok: false, errors };
  }

  const rawCustomer =
    input?.customer != null && typeof input.customer === 'object'
      ? structuredClone(input.customer)
      : null;
  const customer = rawCustomer != null ? maskCustomerPayload(rawCustomer) : null;

  let rawPayload = input?.rawPayload ?? null;
  if (rawCustomer) {
    rawPayload = mergeCustomerIntoRawPayload(rawPayload, rawCustomer, channel);
  }

  const ingestSource = String(input?.ingestSource || ORDER_SOURCES.WEBHOOK).trim();
  const allowedSources = Object.values(ORDER_SOURCES);
  if (!allowedSources.includes(ingestSource)) {
    errors.push(`Geçersiz ingestSource: ${ingestSource}`);
    return { ok: false, errors };
  }

  return {
    ok: true,
    order: {
      branchId: String(input.branchId || '').trim() || null,
      channel,
      externalId,
      displayId: String(input?.displayId ?? externalId).trim(),
      status,
      channelStatus: String(input?.channelStatus ?? '').trim() || null,
      channelIntegrationMode: integrationMode,
      deliveryMode,
      shadowMode: input?.shadowMode ?? shadowModeDefault,
      customerMasked: customer,
      rawPayload: input?.rawPayload ?? null,
      ingestSource,
      orderedAt: orderedAt.toISOString(),
      lines: normalizedLines
    }
  };
}

function validateOpsOrderLine(line, index) {
  const errors = [];
  const quantity = Number(line?.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    errors.push(`lines[${index}].quantity pozitif sayı olmalı`);
  }

  const channelProductId = String(line?.channelProductId ?? '').trim();
  if (!channelProductId) {
    errors.push(`lines[${index}].channelProductId zorunlu`);
  }

  const matchingStatus = String(line?.matchingStatus || 'unmapped').trim();
  if (!OPS_LINE_MATCHING_STATUSES.includes(matchingStatus)) {
    errors.push(`lines[${index}].matchingStatus geçersiz`);
  }

  return errors;
}

function normalizeOpsOrderLine(line, index) {
  const quantity = Number(line.quantity);
  const reservedQty = Number(line?.reservedQty ?? 0);

  return {
    lineIndex: Number.isInteger(line?.lineIndex) ? line.lineIndex : index,
    channelProductId: String(line.channelProductId).trim(),
    barcode: String(line?.barcode ?? '').trim() || null,
    title: String(line?.title ?? '').trim() || null,
    quantity,
    unitPrice: line?.unitPrice == null ? null : Number(line.unitPrice),
    matchingStatus: String(line?.matchingStatus || 'unmapped').trim(),
    benimposSalesCode: String(line?.benimposSalesCode ?? '').trim() || null,
    reservedQty: Number.isFinite(reservedQty) && reservedQty >= 0 ? reservedQty : 0
  };
}

export function mergeCustomerIntoRawPayload(rawPayload, customer, channel) {
  const base =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? structuredClone(rawPayload)
      : {};

  if (!base.customer) {
    base.customer = structuredClone(customer);
  }

  if (channel === 'getir') {
    base.client = {
      ...(base.client && typeof base.client === 'object' ? base.client : {}),
      name: customer.name || base.client?.name || null,
      phone: customer.phone || base.client?.phone || null
    };
  }

  return base;
}
