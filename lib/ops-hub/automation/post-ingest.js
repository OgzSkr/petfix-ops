import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { getOpsOrderById, insertShadowEvent, updateOpsOrderStatusByExternalId } from '../db/repository.js';
import { applyChannelStatus } from '../channel/channel-status-service.js';
import { resolveBranchChannelConfig } from '../integrations/branch-config-resolver.js';

export function shouldRunAutoAccept({ order, branchConfig }) {
  if (!order) {
    return { run: false, reason: 'order_missing' };
  }
  if (order.status !== 'received') {
    return { run: false, reason: `status_${order.status}` };
  }
  if (!branchConfig?.enabled) {
    return { run: false, reason: 'channel_disabled' };
  }
  if (branchConfig.autoAcceptOrders === false) {
    return { run: false, reason: 'auto_accept_off' };
  }
  return { run: true, reason: null };
}

export async function maybeAutoAcceptOrder(pool, orderId, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const detail = await getOpsOrderById(pool, orderId);

  if (!detail) {
    return { skipped: true, reason: 'order_not_found' };
  }

  const order = detail.order;
  const branchConfig = await resolveBranchChannelConfig(pool, order.channel, {
    branchId: order.branch_id,
    platformEnv
  });

  const decision = shouldRunAutoAccept({ order, branchConfig });
  if (!decision.run) {
    return { skipped: true, reason: decision.reason };
  }

  try {
    const acceptResult = await applyChannelStatus(pool, orderId, 'accept', {
      platformEnv,
      forceLive: options.forceLive === true
    });

    if (acceptResult?.dryRun) {
      await updateOpsOrderStatusByExternalId(pool, {
        channel: order.channel,
        externalId: order.external_id,
        status: 'picking',
        channelStatus: 'Accepted (shadow)'
      });
    }

    await insertShadowEvent(pool, {
      branchId: order.branch_id,
      orderId,
      eventType: acceptResult?.dryRun ? 'auto_accept_simulation' : 'auto_accept_write',
      payload: {
        channel: order.channel,
        externalId: order.external_id,
        dryRun: acceptResult?.dryRun ?? true,
        acceptResult
      }
    });

    return {
      skipped: false,
      accepted: true,
      dryRun: acceptResult?.dryRun ?? true,
      acceptResult
    };
  } catch (error) {
    await insertShadowEvent(pool, {
      branchId: order.branch_id,
      orderId,
      eventType: 'auto_accept_failed',
      payload: {
        channel: order.channel,
        externalId: order.external_id,
        error: error.message
      }
    });

    return {
      skipped: false,
      accepted: false,
      error: error.message
    };
  }
}

export async function runPostIngestAutomation(pool, orderId, options = {}) {
  const autoAccept = await maybeAutoAcceptOrder(pool, orderId, options);
  return { autoAccept };
}
