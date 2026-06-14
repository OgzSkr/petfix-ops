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
  isExcludedFromMarketNext,
  isMarketNextBuyboxChannel,
  MARKETNEXT_BUYBOX_CHANNEL_IDS
} from '../lib/marketnext/constants.js';
import { listMarketNextMatchingSalesChannels } from '../lib/channels/registry.js';

test('panel modules define hzlmrktops, marketplace, ecommerce and admin', () => {
  assert.ok(PANEL_MODULES.hzlmrktops);
  assert.ok(PANEL_MODULES.marketplace);
  assert.ok(PANEL_MODULES.ecommerce);
  assert.ok(PANEL_MODULES.admin);
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'products')?.href, '/hzlmrktops/urunler');
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'orders')?.href, '/hzlmrktops/siparisler');
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'picking'), undefined);
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'errors'), undefined);
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'integrations'), undefined);
  assert.equal(PANEL_MODULES.hzlmrktops.items.find((i) => i.id === 'health'), undefined);
  assert.equal(PANEL_MODULES.hzlmrktops.items.length, 3);
  assert.equal(PANEL_MODULES.ecommerce.items[0].href, '/ecommerce/woocommerce');
  assert.deepEqual([...MARKETPLACE_SIDEBAR_NAV_IDS], ['trendyol']);
});

test('marketplace sidebar shows only Trendyol Pazaryeri entry', () => {
  const html = renderPetfixShell({
    title: 'Buybox',
    activeModule: 'marketplace',
    activeItem: 'buybox',
    bodyHtml: '<p>test</p>'
  });
  const marketplaceNav = html.match(
    /aria-label="Pazaryeri &amp; Buybox">([\s\S]*?)<\/nav>/
  )?.[1] || '';
  assert.match(marketplaceNav, /Trendyol Pazaryeri/);
  assert.doesNotMatch(marketplaceNav, /data-nav="buybox"/);
  assert.doesNotMatch(marketplaceNav, /data-nav="products"/);
  assert.doesNotMatch(marketplaceNav, /data-nav="shipping"/);
  assert.match(marketplaceNav, /data-nav="trendyol"/);
  assert.match(marketplaceNav, /is-active/);
});

test('findNavItemByPath resolves legacy alias paths to hzlmrktops', () => {
  const hit = findNavItemByPath('/urun-havuzu');
  assert.equal(hit?.item.id, 'products');
  assert.equal(hit?.module.id, 'hzlmrktops');
  const urunler = findNavItemByPath('/urunler');
  assert.equal(urunler?.item.id, 'products');
  assert.equal(urunler?.module.id, 'marketplace');
  const uber = findNavItemByPath('/uber-eats');
  assert.equal(uber?.module.id, 'hzlmrktops');
  assert.equal(uber?.item.id, 'orders');
  const ys = findNavItemByPath('/yemeksepeti');
  assert.equal(ys?.item.id, 'orders');
  const woo = findNavItemByPath('/woocommerce');
  assert.equal(woo?.module.id, 'ecommerce');
});

test('redirectOpsLegacy maps /ops to hzlmrktops dashboard', () => {
  assert.equal(redirectOpsLegacy('/ops/', new URLSearchParams()), '/hzlmrktops/');
});

test('legacy /marketnext paths redirect target in nav config', () => {
  const hit = findNavItemByPath('/marketnext/urunler');
  assert.equal(hit?.item.id, 'products');
  assert.equal(hit?.module.id, 'hzlmrktops');
});

test('HzlMrktOps channel separation excludes marketplace and woocommerce matching', () => {
  for (const id of MARKETNEXT_BUYBOX_CHANNEL_IDS) {
    assert.ok(isMarketNextBuyboxChannel(id));
    assert.ok(!isExcludedFromMarketNext(id));
  }
  assert.ok(isExcludedFromMarketNext('trendyol-marketplace'));
  assert.ok(isExcludedFromMarketNext('woocommerce'));
  const matchingIds = listMarketNextMatchingSalesChannels().map((c) => c.id);
  assert.ok(matchingIds.includes('uber-eats'));
  assert.ok(matchingIds.includes('yemeksepeti'));
  assert.ok(!matchingIds.includes('woocommerce'));
  assert.ok(!matchingIds.includes('trendyol-marketplace'));
});
