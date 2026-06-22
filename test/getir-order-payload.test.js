import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGetirExternalId, unwrapGetirOrderPayload } from '../lib/channels/getir-order-payload.js';

test('resolveGetirExternalId reads Mongo id and Getir webhook orderID', () => {
  assert.equal(resolveGetirExternalId({ id: 'a' }), 'a');
  assert.equal(resolveGetirExternalId({ _id: 'b' }), 'b');
  assert.equal(resolveGetirExternalId({ orderID: '6a355fa65fe50899ba8e9169' }), '6a355fa65fe50899ba8e9169');
  assert.equal(resolveGetirExternalId({ confirmationId: 'p757' }), '');
  assert.equal(resolveGetirExternalId({}), '');
});

test('unwrapGetirOrderPayload unwraps order and data.order envelopes', () => {
  assert.equal(unwrapGetirOrderPayload({ order: { id: 'x' } }).id, 'x');
  assert.equal(unwrapGetirOrderPayload({ data: { order: { _id: 'y' } } })._id, 'y');
  assert.equal(unwrapGetirOrderPayload({ id: 'z' }).id, 'z');
});
