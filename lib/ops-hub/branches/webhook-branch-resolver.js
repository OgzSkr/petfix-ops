import { getOpsHubState } from '../bootstrap.js';
import { hydrateStoredChannelConfig } from '../integrations/channel-secrets-crypto.js';
import { resolveYemeksepetiWebhookSecret } from '../integrations/branch-config-resolver.js';
import { resolveGetirWebhookSecret } from '../integrations/branch-config-resolver.js';
import {
  resolveGetirApiKeyFromRequest,
  resolveWebhookSecretFromRequest,
  verifyWebhookSecret
} from '../webhooks/webhook-auth.js';
import { getBranchById, getBranchBySlug } from './branch-repository.js';

const LEGACY_CHANNEL_PATHS = new Set([
  '/webhooks/v1/yemeksepeti/orders',
  '/webhooks/v1/yemeksepeti/catalog',
  '/webhooks/v1/getir/orders/new',
  '/webhooks/v1/getir/orders/cancelled',
  '/webhooks/v1/getir/orders'
]);

export function parseBranchScopedWebhookPath(pathname) {
  const match = String(pathname || '').match(/^\/webhooks\/v1\/branches\/([^/]+)(\/.*)$/);
  if (!match) {
    return null;
  }
  const branchSlug = decodeURIComponent(match[1]);
  const subPath = `/webhooks/v1${match[2]}`;
  if (!LEGACY_CHANNEL_PATHS.has(subPath)) {
    return null;
  }
  return { branchSlug, subPath };
}

async function listBranchChannelRows(pool, channel) {
  const result = await pool.query(
    `SELECT b.id AS branch_id, b.slug, b.name, c.config_json, c.secrets_ciphertext
     FROM ops_branch_channel_config c
     JOIN ops_branches b ON b.id = c.branch_id
     WHERE c.channel = $1 AND b.active = TRUE`,
    [channel]
  );
  return result.rows;
}

async function findBranchByYsSecret(pool, provided, platformEnv) {
  if (!provided) return null;
  const rows = await listBranchChannelRows(pool, 'yemeksepeti');
  for (const row of rows) {
    const hydrated = hydrateStoredChannelConfig(row, platformEnv);
    const config = hydrated?.config_json || {};
    const secret = String(config.webhookSecret || '').trim();
    if (secret && verifyWebhookSecret(provided, secret)) {
      return { branchId: row.branch_id, branchSlug: row.slug, branchName: row.name };
    }
    const resolved = await resolveYemeksepetiWebhookSecret(pool, {
      branchId: row.branch_id,
      platformEnv
    });
    if (resolved && verifyWebhookSecret(provided, resolved)) {
      return { branchId: row.branch_id, branchSlug: row.slug, branchName: row.name };
    }
  }
  return null;
}

async function findBranchByGetirSecret(pool, provided, platformEnv) {
  if (!provided) return null;
  const rows = await listBranchChannelRows(pool, 'getir');
  for (const row of rows) {
    const hydrated = hydrateStoredChannelConfig(row, platformEnv);
    const config = hydrated?.config_json || {};
    const secret = String(config.webhookSecret || '').trim();
    if (secret && verifyWebhookSecret(provided, secret)) {
      return { branchId: row.branch_id, branchSlug: row.slug, branchName: row.name };
    }
    const resolved = await resolveGetirWebhookSecret(pool, {
      branchId: row.branch_id,
      platformEnv
    });
    if (resolved && verifyWebhookSecret(provided, resolved)) {
      return { branchId: row.branch_id, branchSlug: row.slug, branchName: row.name };
    }
  }
  return null;
}

function detectWebhookChannel(pathname) {
  if (pathname.includes('/yemeksepeti/')) return 'yemeksepeti';
  if (pathname.includes('/getir/')) return 'getir';
  return null;
}

/**
 * Webhook isteği için şube + normalize edilmiş kanal path'i çözer.
 * Öncelik: /webhooks/v1/branches/{slug}/... → ?branch= → secret eşleşmesi → varsayılan şube.
 */
export async function resolveWebhookBranch(pool, request, url, platformEnv) {
  const scoped = parseBranchScopedWebhookPath(url.pathname);
  if (scoped) {
    const branch = await getBranchBySlug(pool, scoped.branchSlug);
    if (!branch) {
      throw Object.assign(new Error('Webhook şube bulunamadı'), { statusCode: 404 });
    }
    return {
      branchId: branch.id,
      branchSlug: branch.slug,
      pathname: scoped.subPath,
      source: 'path'
    };
  }

  const branchParam = url.searchParams.get('branch') || url.searchParams.get('branchId');
  if (branchParam) {
    const branch =
      (await getBranchById(pool, branchParam)) ||
      (await getBranchBySlug(pool, branchParam));
    if (!branch) {
      throw Object.assign(new Error('Webhook şube bulunamadı'), { statusCode: 404 });
    }
    return {
      branchId: branch.id,
      branchSlug: branch.slug,
      pathname: url.pathname,
      source: 'query'
    };
  }

  const channel = detectWebhookChannel(url.pathname);
  if (channel === 'yemeksepeti' && request.method === 'POST') {
    const provided = resolveWebhookSecretFromRequest(request);
    const matched = await findBranchByYsSecret(pool, provided, platformEnv);
    if (matched) {
      return {
        branchId: matched.branchId,
        branchSlug: matched.branchSlug,
        pathname: url.pathname,
        source: 'secret'
      };
    }
  }

  if (channel === 'getir' && request.method === 'POST') {
    const provided = resolveGetirApiKeyFromRequest(request);
    const matched = await findBranchByGetirSecret(pool, provided, platformEnv);
    if (matched) {
      return {
        branchId: matched.branchId,
        branchSlug: matched.branchSlug,
        pathname: url.pathname,
        source: 'secret'
      };
    }
  }

  const fallback = getOpsHubState().branch;
  return {
    branchId: fallback?.id || null,
    branchSlug: fallback?.slug || 'main',
    pathname: url.pathname,
    source: 'default'
  };
}

export function branchWebhookBasePath(branchSlug) {
  const slug = String(branchSlug || 'main').trim();
  return `/webhooks/v1/branches/${encodeURIComponent(slug)}`;
}
