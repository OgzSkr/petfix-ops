import test from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_MODULES, findNavItemByPath } from '../lib/panel/nav-config.js';
import { redirectOpsLegacy } from '../lib/platform/routes/panel-routes.js';

test('panel modules define four bounded contexts', () => {
  assert.ok(PANEL_MODULES.products);
  assert.ok(PANEL_MODULES.marketplace);
  assert.ok(PANEL_MODULES.quickCommerce);
  assert.ok(PANEL_MODULES.admin);
  assert.equal(PANEL_MODULES.products.items[0].href, '/products');
  assert.equal(PANEL_MODULES.quickCommerce.items.find((i) => i.id === 'picking')?.href, '/quick-commerce/picking');
});

test('findNavItemByPath resolves legacy alias paths', () => {
  const hit = findNavItemByPath('/urun-havuzu');
  assert.equal(hit?.item.id, 'pool');
  assert.equal(hit?.alias, true);
  const urunler = findNavItemByPath('/urunler');
  assert.equal(urunler?.item.id, 'products');
  assert.equal(urunler?.module.id, 'marketplace');
  const costs = findNavItemByPath('/kanal-maliyetleri');
  assert.equal(costs?.item.id, 'channel-costs');
  assert.equal(costs?.module.id, 'products');
  const uber = findNavItemByPath('/uber-eats');
  assert.equal(uber?.item.id, 'uber-eats');
  assert.equal(uber?.module.id, 'general');
});

test('redirectOpsLegacy maps /ops to quick-commerce picking', () => {
  assert.equal(redirectOpsLegacy('/ops/', new URLSearchParams()), '/quick-commerce/picking/');
});
