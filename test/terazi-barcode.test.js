import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTeraziBarcode,
  parseOrderLineWeightGrams,
  resolveTeraziSaleBarcode,
  resolveTeraziSaleQuantity,
  resolveTeraziSaleUnitPrice
} from '../lib/benimpos/terazi-barcode.js';

test('buildTeraziBarcode pads grams to 4 digits', () => {
  assert.equal(buildTeraziBarcode('2900052', 500), '29000520500');
  assert.equal(buildTeraziBarcode('2900052', 1000), '29000521000');
  assert.equal(buildTeraziBarcode('2900052', 2000), '29000522000');
});

test('parseOrderLineWeightGrams skips multipack lines', () => {
  assert.equal(parseOrderLineWeightGrams('Purina Felix 4 x 85 g'), null);
  assert.equal(parseOrderLineWeightGrams('Royal Canin Sterilised 500 g'), 500);
  assert.equal(parseOrderLineWeightGrams('Felicia Yavru Kedi Maması 2 kg'), 2000);
});

test('resolveTeraziSaleBarcode uses base barcode and cost ratio for partial weight', () => {
  const master = { name: 'Royal Canin Sterilised 1 kg', benimposBarcode: '2900052' };
  const result = resolveTeraziSaleBarcode({
    baseBarcode: '2900052',
    master,
    orderLineName: 'Royal Canin Sterilised 500 g'
  });
  assert.equal(result.saleBarcode, '2900052');
  assert.equal(result.teraziApplied, true);
  assert.equal(result.costRatio, 0.5);
  assert.equal(result.suffixBarcode, '29000520500');
  assert.equal(resolveTeraziSaleQuantity(result, 1), 0.5);
});

test('resolveTeraziSaleBarcode keeps base when order matches master unit', () => {
  const master = { name: 'Royal Canin Sterilised 1 kg', benimposBarcode: '2900052' };
  const result = resolveTeraziSaleBarcode({
    baseBarcode: '2900052',
    master,
    orderLineName: 'Royal Canin Sterilised 1 kg'
  });
  assert.equal(result.saleBarcode, '2900052');
  assert.equal(result.teraziApplied, false);
  assert.equal(resolveTeraziSaleQuantity(result, 1), 1);
});

test('resolveTeraziSaleBarcode skips when master has no weight', () => {
  const result = resolveTeraziSaleBarcode({
    baseBarcode: '123',
    master: { name: 'Pet Brush Tarağı' },
    orderLineName: 'Pet Brush 500 g'
  });
  assert.equal(result.saleBarcode, '123');
  assert.equal(result.teraziApplied, false);
});

test('resolveTeraziSaleBarcode uses explicit orderGrams over product name', () => {
  const master = { name: 'ENJOY TAVUK ETLİ YETİŞKİN KEDİ MAMASI AÇIK', benimposBarcode: '2900710' };
  const result = resolveTeraziSaleBarcode({
    baseBarcode: '2900710',
    master,
    orderLineName: 'Enjoy Tavuk Etli Açık Yetişkin Kedi Maması',
    orderGrams: 2000
  });
  assert.equal(result.saleBarcode, '2900710');
  assert.equal(result.teraziApplied, true);
  assert.equal(result.costRatio, 2);
  assert.equal(resolveTeraziSaleQuantity(result, 1), 2);
});

test('resolveTeraziSaleUnitPrice keeps line total when scaling quantity', () => {
  const master = { name: 'ENJOY AÇIK', benimposBarcode: '2900710', normalizedWeightG: 1000 };
  const terazi = resolveTeraziSaleBarcode({
    baseBarcode: '2900710',
    master,
    orderGrams: 2000
  });
  const unit = resolveTeraziSaleUnitPrice(320, terazi);
  const qty = resolveTeraziSaleQuantity(terazi, 1);
  assert.equal(unit, 160);
  assert.equal(qty, 2);
  assert.equal(unit * qty, 320);
});

test('PTFX027 2x500g discounted channel price maps to 600 TL BenimPOS total', () => {
  const master = {
    name: 'SOMONLU KISIRLAŞTIRILMIŞ KEDI MAMASI AÇIK',
    benimposBarcode: '2900058',
    normalizedWeightG: 1000
  };
  const terazi = resolveTeraziSaleBarcode({
    baseBarcode: '2900058',
    master,
    orderLineName: 'Somonlu Kısırlaştırılmış Kedi Maması Açık 500 Gr'
  });
  const listUnit = 300;
  const qty = resolveTeraziSaleQuantity(terazi, 2);
  const unit = resolveTeraziSaleUnitPrice(listUnit, terazi);
  assert.equal(qty, 1);
  assert.equal(unit, 600);
  assert.equal(unit * qty, 600);
});
