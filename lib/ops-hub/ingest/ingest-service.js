import { buildOpsOrderIdempotencyKey, normalizeOpsOrderInput } from '../domain/ops-order.js';
import { simulateOrderShadow, buildShadowReportFromEvents } from '../shadow/simulator.js';
import { ORDER_SOURCES } from '../../production/constants.js';
import { logStructured } from '../../production/structured-log.js';
import {
  ensureDefaultBranch,
  insertOpsOrder,
  hasIdempotencyKey,
  recordIdempotencyKey,
  insertShadowEvent,
  findOpsOrderByChannelExternalId,
  getOpsOrderById,
  listOpsOrders,
  listShadowEvents,
  promoteOpsOrderToLiveIfShadow,
  updateOpsOrderStatusByExternalId
} from '../db/repository.js';
import { runPostIngestAutomation } from '../automation/post-ingest.js';
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { notifyBranchNewOrder } from '../notifications/push-service.js';

export async function ingestOpsOrder(pool, input, {
  shadowModeDefault = true,
  branchSlug = 'main',
  idempotencyEventType = 'ingest',
  runAutomation = true,
  platformEnv = null
} = {}) {
  const normalized = normalizeOpsOrderInput(input, { shadowModeDefault });
  if (!normalized.ok) {
    const error = new Error(normalized.errors.join('; '));
    error.statusCode = 400;
    throw error;
  }

  const orderInput = normalized.order;
  const idempotencyKey = buildOpsOrderIdempotencyKey({
    channel: orderInput.channel,
    externalId: orderInput.externalId,
    eventType: idempotencyEventType
  });

  const existingOrder = await findOpsOrderByChannelExternalId(
    pool,
    orderInput.channel,
    orderInput.externalId
  );
  if (existingOrder) {
    if (!shadowModeDefault && existingOrder.shadow_mode) {
      await promoteOpsOrderToLiveIfShadow(pool, { orderId: existingOrder.id });
    }
    logStructured({
      level: 'info',
      component: 'ORDER-INGEST',
      channel: orderInput.channel,
      order_id: orderInput.externalId,
      source: orderInput.ingestSource,
      status: 'duplicate'
    });
    return {
      duplicate: true,
      idempotencyKey,
      orderId: existingOrder.id,
      existingStatus: existingOrder.status,
      existingChannelStatus: existingOrder.channel_status
    };
  }

  if (await hasIdempotencyKey(pool, idempotencyKey)) {
    const existing = await findOpsOrderByChannelExternalId(
      pool,
      orderInput.channel,
      orderInput.externalId
    );
    return {
      duplicate: true,
      idempotencyKey,
      orderId: existing?.id || null
    };
  }

  const branch = await ensureDefaultBranch(pool, { slug: branchSlug });
  orderInput.branchId = branch.id;

  let inserted;
  try {
    inserted = await insertOpsOrder(pool, orderInput);
  } catch (error) {
    // TOCTOU: SELECT ile aramadan sonra başka bir süreç aynı siparişi yazmış olabilir.
    // UNIQUE (channel, external_id) ihlali (23505) → 500 yerine duplicate olarak dön.
    if (error?.code === '23505') {
      const existing = await findOpsOrderByChannelExternalId(
        pool,
        orderInput.channel,
        orderInput.externalId
      );
      logStructured({
        level: 'info',
        component: 'ORDER-INGEST',
        channel: orderInput.channel,
        order_id: orderInput.externalId,
        source: orderInput.ingestSource,
        status: 'duplicate_race'
      });
      return {
        duplicate: true,
        idempotencyKey,
        orderId: existing?.id || null,
        existingStatus: existing?.status,
        existingChannelStatus: existing?.channel_status
      };
    }
    throw error;
  }
  const fullOrder = await getOpsOrderById(pool, inserted.id);

  const simulation = simulateOrderShadow(fullOrder.order, { lines: fullOrder.lines });

  await insertShadowEvent(pool, {
    branchId: branch.id,
    orderId: inserted.id,
    eventType: 'shadow_simulation',
    payload: simulation
  });

  for (const issue of simulation.issues) {
    await insertShadowEvent(pool, {
      branchId: branch.id,
      orderId: inserted.id,
      eventType: 'shadow_issue',
      payload: issue
    });
  }

  await recordIdempotencyKey(pool, {
    key: idempotencyKey,
    scope: 'ingest',
    resourceType: 'ops_order',
    resourceId: inserted.id
  });

  let automation = null;
  if (runAutomation) {
    const env = platformEnv || (await readEnvFile(paths.platformEnv));
    automation = await runPostIngestAutomation(pool, inserted.id, { platformEnv: env });
    try {
      await notifyBranchNewOrder(pool, fullOrder.order, env);
    } catch {
      // Push hatası sipariş ingest'ini bozmasın.
    }
  }

  return {
    duplicate: false,
    idempotencyKey,
    orderId: inserted.id,
    shadow: simulation,
    automation
  };
}

export async function ingestMockOrder(pool, {
  fixtureKey,
  order,
  shadowModeDefault = true,
  forceUnique = false
} = {}) {
  let payload = order;
  if (!payload && fixtureKey) {
    const { mockOrderByKey } = await import('../fixtures/mock-orders.js');
    payload = mockOrderByKey(fixtureKey);
    if (!payload) {
      const error = new Error(`Bilinmeyen mock fixture: ${fixtureKey}`);
      error.statusCode = 400;
      throw error;
    }
    if (forceUnique) {
      const stamp = Date.now();
      payload.externalId = `${payload.externalId}-${stamp}`;
      payload.displayId = `${payload.displayId}-${stamp}`;
    }
  }

  if (!payload) {
    const error = new Error('order veya fixtureKey zorunlu');
    error.statusCode = 400;
    throw error;
  }

  payload.ingestSource = ORDER_SOURCES.FIXTURE;
  if (payload.rawPayload && typeof payload.rawPayload === 'object') {
    payload.rawPayload.source = ORDER_SOURCES.FIXTURE;
  }

  return ingestOpsOrder(pool, payload, { shadowModeDefault, runAutomation: false });
}

export async function updateOpsOrderChannelState(pool, orderInput, { branchSlug = 'main' } = {}) {
  const existing = await findOpsOrderByChannelExternalId(
    pool,
    orderInput.channel,
    orderInput.externalId
  );

  if (!existing) {
    return { updated: false, orderId: null };
  }

  const updated = await updateOpsOrderStatusByExternalId(pool, {
    channel: orderInput.channel,
    externalId: orderInput.externalId,
    status: orderInput.status,
    channelStatus: orderInput.channelStatus
  });

  if (updated && orderInput.status === 'cancelled') {
    const branch = await ensureDefaultBranch(pool, { slug: branchSlug });
    await insertShadowEvent(pool, {
      branchId: branch.id,
      orderId: updated.id,
      eventType: 'order_cancelled',
      payload: {
        channel: orderInput.channel,
        externalId: orderInput.externalId,
        channelStatus: orderInput.channelStatus
      }
    });
  }

  return {
    updated: Boolean(updated),
    orderId: updated?.id || existing.id,
    status: updated?.status || existing.status
  };
}

export async function buildShadowReport(pool, { branchSlug = 'main', limit = 100 } = {}) {
  const branch = await ensureDefaultBranch(pool, { slug: branchSlug });
  const orders = await listOpsOrders(pool, { branchId: branch.id, limit });
  const events = await listShadowEvents(pool, { branchId: branch.id, limit: limit * 3 });
  return buildShadowReportFromEvents(orders, events);
}

export async function getOrderMatchingView(pool, orderId) {
  const detail = await getOpsOrderById(pool, orderId);
  if (!detail) {
    return null;
  }

  const simulation = simulateOrderShadow(detail.order, { lines: detail.lines });
  return {
    orderId,
    channel: detail.order.channel,
    externalId: detail.order.external_id,
    lines: detail.lines.map((line) => ({
      lineIndex: line.line_index,
      channelProductId: line.channel_product_id,
      barcode: line.barcode,
      matchingStatus: line.matching_status,
      quantity: Number(line.quantity)
    })),
    matching: simulation.summary,
    issues: simulation.issues
  };
}
