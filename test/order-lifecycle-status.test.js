import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTerminalOrderStatus,
  normalizeOrderStatusKey
} from '../lib/order-lifecycle-status.js';

test('normalizeOrderStatusKey handles Turkish locale', () => {
  assert.equal(normalizeOrderStatusKey('Teslim edildi'), 'TESLIM EDILDI');
  assert.equal(normalizeOrderStatusKey('İptal'), 'IPTAL');
});

test('isTerminalOrderStatus recognizes English and Turkish terminal statuses', () => {
  assert.equal(isTerminalOrderStatus('Delivered'), true);
  assert.equal(isTerminalOrderStatus('PICKED_UP'), true);
  assert.equal(isTerminalOrderStatus('Teslim edildi'), true);
  assert.equal(isTerminalOrderStatus('İptal'), true);
  assert.equal(isTerminalOrderStatus('completed'), true);
});

test('isTerminalOrderStatus treats in-progress statuses as active', () => {
  assert.equal(isTerminalOrderStatus('Hazırlanıyor'), false);
  assert.equal(isTerminalOrderStatus('Yolda'), false);
  assert.equal(isTerminalOrderStatus('Yeni'), false);
  assert.equal(isTerminalOrderStatus('Picking'), false);
  assert.equal(isTerminalOrderStatus('DISPATCHED'), false);
  assert.equal(isTerminalOrderStatus('picking'), false);
});
