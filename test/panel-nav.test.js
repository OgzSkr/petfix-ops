import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PANEL_MODULES,
  MARKETPLACE_SIDEBAR_NAV_IDS,
  findNavItemByPath
} from '../lib/panel/nav-config.js';
import { renderPetfixShell } from '../lib/panel/shell/petfix-shell.js';
import { redirectOpsLegacy } from '../lib/platform/routes/panel-routes.js';
import {
  isExcludedFromHzlmrktops,
  isHzlmrktopsBuyboxChannel,
  HZLMRKTOPS_BUYBOX_CHANNEL_IDS
} from '../lib/hzlmrktops/constants.js';
import { listHzlMrktOpsMatchingSalesChannels } from '../lib/channels/registry.js';

test('panel modules define hzlmrktops and admin only', () => {
  assert.ok(PANEL_MODULES.hzlmrktops);
  assert.ok(PANEL_MODULES.admin);
  assert.equal(PANEL_MODULES.marketplace, undefined);
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'products')?.href, '/hzlmrktops/urunler');
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'orders')?.href, '/hzlmrktops/siparisler');
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'picking'), undefined);
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'errors'), undefined);
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'integrations')?.href, '/hzlmrktops/integrations');
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'system')?.href, '/hzlmrktops/sistem');
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'reports')?.href, '/hzlmrktops/raporlar');
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'customers')?.href, '/hzlmrktops/musteriler');
  assert.equal(PANEL_MODULES.hzlmrktops.items.length, 7);
  assert.equal(MARKETPLACE_SIDEBAR_NAV_IDS.size, 0);
});

test('ops shell renders without marketplace sidebar block', () => {
  const html = renderPetfixShell({
    title: 'Ana Panel',
    activeModule: 'hzlmrktops',
    activeItem: 'dashboard',
    bodyHtml: '<p>test</p>'
  });
  assert.doesNotMatch(html, /Pazaryeri &amp; Buybox/);
  assert.doesNotMatch(html, /data-nav="trendyol"/);
  assert.match(html, /data-nav="dashboard"/);
  assert.match(html, /pf-nav-rail-link/);
  assert.match(html, /pf-sidebar-rail/);
  assert.match(html, /<svg[^>]*viewBox="0 0 24 24"/);
});

test('findNavItemByPath resolves legacy alias paths to hzlmrktops', () => {
  const hit = findNavItemByPath('/urun-havuzu');
  assert.equal(hit?.item.id, 'products');
  assert.equal(hit?.module.id, 'hzlmrktops');
  const urunler = findNavItemByPath('/urunler');
  assert.equal(urunler?.item.id, 'products');
  assert.equal(urunler?.module.id, 'hzlmrktops');
  const uber = findNavItemByPath('/uber-eats');
  assert.equal(uber?.module.id, 'hzlmrktops');
  assert.equal(uber?.item.id, 'orders');
  const ys = findNavItemByPath('/yemeksepeti');
  assert.equal(ys?.item.id, 'orders');
});

test('redirectOpsLegacy maps /ops to hzlmrktops dashboard', () => {
  assert.equal(redirectOpsLegacy('/ops/', new URLSearchParams()), '/hzlmrktops/');
});

test('redirectOpsLegacy maps /ops/integrations to hzlmrktops integrations', () => {
  assert.equal(redirectOpsLegacy('/ops/integrations', new URLSearchParams()), '/hzlmrktops/integrations');
  assert.equal(
    redirectOpsLegacy('/ops/integrations/', new URLSearchParams('channel=getir')),
    '/hzlmrktops/integrations/?channel=getir'
  );
});

test('HzlMrktOps channel separation excludes marketplace matching', () => {
  for (const id of HZLMRKTOPS_BUYBOX_CHANNEL_IDS) {
    assert.ok(isHzlmrktopsBuyboxChannel(id));
    assert.ok(!isExcludedFromHzlmrktops(id));
  }
  assert.ok(isExcludedFromHzlmrktops('trendyol-marketplace'));
  const matchingIds = listHzlMrktOpsMatchingSalesChannels().map((c) => c.id);
  assert.ok(matchingIds.includes('uber-eats'));
  assert.ok(matchingIds.includes('yemeksepeti'));
  assert.ok(!matchingIds.includes('trendyol-marketplace'));
});
