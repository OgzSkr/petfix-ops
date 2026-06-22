import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCustomerAddress,
  extractCustomerName,
  extractCustomerPhone,
  buildOrderCustomerView
} from '../lib/ops-hub/customer/order-customer-view.js';
import {
  readMobileAuditHeaders,
  assertMobileAuditHeaders
} from '../lib/ops-hub/audit/mobile-audit.js';

test('readMobileAuditHeaders parses staff and device', () => {
  const audit = readMobileAuditHeaders({
    headers: {
      'x-staff-name': ' Ahmet ',
      'x-device-name': 'Depo Tablet 1'
    }
  });
  assert.equal(audit.staffName, 'Ahmet');
  assert.equal(audit.deviceName, 'Depo Tablet 1');
  assert.equal(audit.hasIdentity, true);
});

test('assertMobileAuditHeaders rejects missing headers', () => {
  assert.throws(
    () => assertMobileAuditHeaders({ headers: { 'x-staff-name': 'Ali' } }),
    /X-Staff-Name ve X-Device-Name/
  );
});

test('buildOrderCustomerView extracts delivery fields from raw payload', () => {
  const view = buildOrderCustomerView({
    customer_masked: { name: 'Me***et', phone: '53******67' },
    raw_payload: {
      yemeksepetiOrder: {
        customer: { name: 'Mehmet Yilmaz', phone: '5321112233' },
        delivery: {
          address: 'Cevizlibag Mah. Test Sok. No:1',
          note: 'Kapi zili calismiyor'
        }
      }
    }
  });
  assert.equal(view.customerName, 'Mehmet Yilmaz');
  assert.equal(view.customerPhone, '0532 111 22 33');
  assert.equal(view.deliveryAddress, 'Cevizlibag Mah. Test Sok. No:1');
  assert.equal(view.addressNote, 'Kapi zili calismiyor');
});

test('extractCustomerAddress falls back to shipment address parts', () => {
  const address = extractCustomerAddress({
    customer_masked: {},
    raw_payload: {
      shipmentAddress: {
        addressDescription: 'Depo kapi',
        district: 'Zeytinburnu',
        city: 'Istanbul'
      }
    }
  });
  assert.match(address, /Depo kapi/);
  assert.match(address, /Zeytinburnu/);
});

test('extractCustomerName prefers raw payload over masked', () => {
  assert.equal(
    extractCustomerName({
      customer_masked: { name: 'A***t' },
      raw_payload: { customer: { name: 'Ahmet' } }
    }),
    'Ahmet'
  );
});

test('extractCustomerPhone falls back to masked phone when raw is empty', () => {
  assert.equal(
    extractCustomerPhone({
      customer_masked: { phone: '53******67' },
      raw_payload: {}
    }),
    '53******67'
  );
});
