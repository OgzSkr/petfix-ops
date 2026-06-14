import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTgoCustomerFields,
  formatTgoCustomerName,
  isTgoMaskedField
} from '../lib/channels/tgo-customer.js';

test('formatTgoCustomerName joins first and last name', () => {
  assert.equal(
    formatTgoCustomerName({ firstName: 'mustafa', lastName: 's.' }),
    'mustafa s.'
  );
});

test('extractTgoCustomerFields keeps name and skips store phone when masked', async () => {
  const fields = await extractTgoCustomerFields({
    locationMasked: true,
    customer: { firstName: 'mustafa', lastName: 's.' },
    shipmentAddress: {
      city: 'TGO Hızlı Market',
      district: 'TGO Hızlı Market',
      cityCode: 34,
      phone: '0212 365 3403'
    }
  }, null);

  assert.equal(fields.customerName, 'mustafa s.');
  assert.equal(fields.customerPhone, null);
  assert.equal(fields.customerLocationMasked, true);
});

test('isTgoMaskedField detects Trendyol placeholder', () => {
  assert.equal(isTgoMaskedField('TGO Hızlı Market'), true);
  assert.equal(isTgoMaskedField('Fatih'), false);
});
