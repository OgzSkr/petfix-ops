import { listMobileDeviceTokens } from './mobile-device-repository.js';
import { getFcmV1AccessToken, loadServiceAccount } from './fcm-v1-auth.js';

function resolveFcmServerKey(platformEnv = {}) {
  return String(
    platformEnv.FCM_SERVER_KEY ||
      process.env.FCM_SERVER_KEY ||
      ''
  ).trim();
}

/** Yerel poll yedek kaydı — gerçek FCM token değil. */
export function isPlaceholderPushToken(token) {
  const value = String(token || '').trim();
  if (!value) return true;
  return /^(android|ios|desktop):/i.test(value);
}

export function filterDeliverablePushTokens(tokens = []) {
  return tokens.filter((token) => !isPlaceholderPushToken(token));
}

export function isPushConfigured(platformEnv = {}) {
  if (resolveFcmServerKey(platformEnv).length > 0) return true;
  try {
    const account = loadServiceAccount(platformEnv);
    return Boolean(account?.project_id && account?.private_key);
  } catch {
    return false;
  }
}

function normalizePushChannel(channel) {
  const key = String(channel || '').trim().toLowerCase();
  if (key === 'uber-eats' || key === 'trendyol-go' || key === 'tgo') {
    return 'trendyol_go';
  }
  return key;
}

function resolveAndroidNotificationChannel(channel) {
  switch (normalizePushChannel(channel)) {
    case 'getir':
      return 'petfix_orders_getir';
    case 'trendyol_go':
      return 'petfix_orders_uber';
    case 'yemeksepeti':
      return 'petfix_orders_ys';
    default:
      return 'petfix_orders_getir';
  }
}

function buildPushContent(order) {
  const title = `Yeni sipariş — ${order.displayId || order.externalId || ''}`.trim();
  const body = order.customerName
    ? `${order.customerName} · ${order.channel || 'sipariş'}`
    : 'Sipariş kabul bekliyor';
  const data = {
    orderId: String(order.id || ''),
    displayId: String(order.displayId || ''),
    channel: String(order.channel || '')
  };
  return { title, body, data };
}

async function sendLegacyPush(serverKey, token, content) {
  const androidChannelId = resolveAndroidNotificationChannel(content.data.channel);
  const response = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      Authorization: `key=${serverKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: token,
      priority: 'high',
      notification: {
        title: content.title,
        body: content.body,
        sound: 'default',
        android_channel_id: androidChannelId
      },
      data: content.data
    })
  });
  return response.ok;
}

async function sendV1Push(serviceAccount, accessToken, token, content) {
  const androidChannelId = resolveAndroidNotificationChannel(content.data.channel);
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: content.title,
            body: content.body
          },
          data: content.data,
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: androidChannelId
            }
          }
        }
      })
    }
  );
  return response.ok;
}

export async function sendOrderPushNotification(pool, {
  branchId,
  order,
  platformEnv = {}
}) {
  const serverKey = resolveFcmServerKey(platformEnv);
  let serviceAccount = null;
  try {
    serviceAccount = loadServiceAccount(platformEnv);
  } catch {
    serviceAccount = null;
  }

  if (!serverKey && !serviceAccount?.project_id) {
    return { sent: 0, skipped: true, reason: 'FCM yapılandırması yok' };
  }

  const tokens = filterDeliverablePushTokens(await listMobileDeviceTokens(pool, branchId));
  if (!tokens.length) return { sent: 0, skipped: true, reason: 'Kayıtlı FCM cihazı yok' };

  const content = buildPushContent(order);
  let accessToken = null;
  if (serviceAccount?.project_id) {
    try {
      accessToken = await getFcmV1AccessToken(serviceAccount);
    } catch (error) {
      if (!serverKey) {
        return { sent: 0, skipped: true, reason: error.message };
      }
    }
  }

  let sent = 0;
  for (const token of tokens) {
    try {
      let ok = false;
      if (accessToken && serviceAccount) {
        ok = await sendV1Push(serviceAccount, accessToken, token, content);
      }
      if (!ok && serverKey) {
        ok = await sendLegacyPush(serverKey, token, content);
      }
      if (ok) sent += 1;
    } catch {
      // Tek cihaz hatası diğerlerini engellemesin.
    }
  }

  return { sent, skipped: false, tokens: tokens.length };
}

export async function notifyBranchNewOrder(pool, orderRow, platformEnv = {}) {
  if (!orderRow?.branch_id) return { sent: 0, skipped: true };
  return sendOrderPushNotification(pool, {
    branchId: orderRow.branch_id,
    order: {
      id: orderRow.id,
      displayId: orderRow.display_id,
      externalId: orderRow.external_id,
      channel: orderRow.channel,
      customerName: orderRow.customer_masked?.name || null
    },
    platformEnv
  });
}

export async function sendTestPushNotification(pool, { branchId, platformEnv = {} }) {
  return sendOrderPushNotification(pool, {
    branchId,
    order: {
      id: 'test-push',
      displayId: 'TEST',
      externalId: 'push-test',
      channel: 'getir',
      customerName: 'Push testi'
    },
    platformEnv
  });
}
