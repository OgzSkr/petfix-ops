import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomerIdentityKey,
  buildCustomerPhoneDialUri,
  buildCustomerPhoneDisplay,
  extractCustomerEmail,
  extractCustomerName,
  extractCustomerPhone,
  isSharedRelayPhone,
  parseGetirMaskedPhoneNumber
} from '../lib/ops-hub/customer/order-customer-view.js';
import { stableCustomerDisplayId } from '../lib/ops-hub/customer/customer-id.js';
import { listOpsCustomers } from '../lib/ops-hub/customers/customer-index-service.js';

test('buildCustomerIdentityKey prefers normalized phone', () => {
  const key = buildCustomerIdentityKey('getir', { phone: '+90 532 111 22 33', name: 'Ali A.' });
  assert.equal(key, 'getir:tel:5321112233');
});

test('stableCustomerDisplayId is deterministic', () => {
  const key = 'getir:tel:5321112233';
  assert.equal(stableCustomerDisplayId(key), stableCustomerDisplayId(key));
  assert.ok(stableCustomerDisplayId(key) >= 0);
  assert.ok(stableCustomerDisplayId(key) < 100000);
});

test('extractCustomerEmail reads nested order customer', () => {
  const email = extractCustomerEmail({
    raw_payload: {
      order: {
        customer: { email: 'pf+test@trendyolmail.com' }
      }
    }
  });
  assert.equal(email, 'pf+test@trendyolmail.com');
});

test('extractCustomerPhone reads Getir client and masked fallback', () => {
  assert.equal(
    extractCustomerPhone({
      raw_payload: { client: { name: 'Ali', phone: '5321112233' } },
      customer_masked: {}
    }),
    '5321112233'
  );
  assert.equal(
    extractCustomerPhone({
      raw_payload: {},
      customer_masked: { phone: '53******33' }
    }),
    '53******33'
  );
  assert.equal(
    extractCustomerPhone({
      raw_payload: {
        shipmentAddress: { phone: '02125551234' },
        customer: { phone: '5329998877' }
      },
      customer_masked: {}
    }),
    '5329998877'
  );
});

test('isSharedRelayPhone detects marketplace call center lines', () => {
  assert.equal(isSharedRelayPhone('0212 365 3403'), true);
  assert.equal(isSharedRelayPhone('+90 (800) 606-0102'), true);
  assert.equal(isSharedRelayPhone('5321112233'), false);
});

test('parseGetirMaskedPhoneNumber splits relay phone and pin', () => {
  const parsed = parseGetirMaskedPhoneNumber('+90 (800) 606-0102 / 154091');
  assert.equal(parsed.phone, '+90 (800) 606-0102');
  assert.equal(parsed.pin, '154091');
});

test('buildCustomerIdentityKey ignores shared relay phone and groups by name', () => {
  const key = buildCustomerIdentityKey('trendyol_go', {
    phone: '0212 365 3403',
    name: 'aynül c.'
  });
  assert.equal(key, 'trendyol_go:name:aynul c.');
});

test('buildCustomerPhoneDisplay formats Getir relay dial string', () => {
  const display = buildCustomerPhoneDisplay(
    {
      channel: 'getir',
      raw_payload: {
        confirmationId: 'm040',
        customer: {
          name: 'emre ergin',
          clientMaskedPhoneNumber: '+90 (800) 606-0102 / 154091'
        }
      },
      customer_masked: {}
    },
    { displayId: 'm040' }
  );
  assert.equal(display, '+90 (800) 606 01 02,154091');
});

test('buildCustomerPhoneDisplay formats relay line with order pin', () => {
  const display = buildCustomerPhoneDisplay(
    {
      channel: 'trendyol_go',
      raw_payload: {
        orderNumber: '11334556904',
        shipmentAddress: { phone: '0212 365 3403' }
      },
      customer_masked: {}
    },
    { displayId: 'PKG-1' }
  );
  assert.equal(display, '0 (212) 365 34 03,11334556904');
});

test('buildCustomerPhoneDisplay uses TGO display_id when orderNumber missing', () => {
  const display = buildCustomerPhoneDisplay(
    {
      channel: 'trendyol_go',
      raw_payload: {
        orderId: '1011344588842',
        packageId: '1000256896030',
        shipmentAddress: { phone: '0212 365 3403' }
      },
      customer_masked: {}
    },
    { displayId: '11344588842', externalId: 'ext-1' }
  );
  assert.equal(display, '0 (212) 365 34 03,11344588842');
});

test('buildCustomerPhoneDialUri auto-dials Uber relay pin', () => {
  const uri = buildCustomerPhoneDialUri('trendyol_go', {
    phoneRaw: '0212 365 3403',
    phonePin: '11334556904',
    isRelayPhone: true
  });
  assert.equal(uri, 'tel:02123653403,,,11334556904');
});

test('buildCustomerPhoneDialUri dials Getir relay without auto pin', () => {
  const uri = buildCustomerPhoneDialUri('getir', {
    phoneRaw: '+90 (800) 606-0102',
    phonePin: '154091',
    isRelayPhone: true
  });
  assert.equal(uri, 'tel:908006060102');
});

test('listOpsCustomers does not merge different names on shared relay phone', async () => {
  const rows = [
    {
      id: 'o1',
      channel: 'trendyol_go',
      display_id: '111',
      external_id: 'ext-1',
      ordered_at: '2026-06-18T10:00:00.000Z',
      raw_payload: {
        orderNumber: '111',
        shipmentAddress: { phone: '0212 365 3403', firstName: 'aynül', lastName: 'c.' }
      },
      customer_masked: { name: 'aynül c.' }
    },
    {
      id: 'o2',
      channel: 'trendyol_go',
      display_id: '222',
      external_id: 'ext-2',
      ordered_at: '2026-06-17T10:00:00.000Z',
      raw_payload: {
        orderNumber: '222',
        shipmentAddress: { phone: '0212 365 3403', firstName: 'Ilayda', lastName: 'akay' }
      },
      customer_masked: { name: 'Ilayda akay' }
    }
  ];
  const pool = { query: async () => ({ rows }) };
  const result = await listOpsCustomers(pool, { branchId: 'branch-1', all: true });
  assert.equal(result.total, 2);
  assert.equal(result.items.find((row) => row.name === 'aynül c.')?.orderCount, 1);
  assert.equal(result.items.find((row) => row.name === 'Ilayda akay')?.orderCount, 1);
});

test('listOpsCustomers aggregates orders by mobile phone identity', async () => {
  const rows = [
    {
      id: 'o-new',
      channel: 'getir',
      display_id: 'g1',
      external_id: 'ext-g1',
      ordered_at: '2026-06-18T10:00:00.000Z',
      raw_payload: { customer: { name: 'Alaa R.', phone: '5321112233', email: 'a@test.com' } },
      customer_masked: {}
    },
    {
      id: 'o-old',
      channel: 'getir',
      display_id: 'g2',
      external_id: 'ext-g2',
      ordered_at: '2026-06-10T10:00:00.000Z',
      raw_payload: { customer: { name: 'Alaa R.', phone: '5321112233' } },
      customer_masked: {}
    },
    {
      id: 'o-other',
      channel: 'yemeksepeti',
      display_id: 'ys1',
      external_id: 'ext-ys1',
      ordered_at: '2026-06-17T10:00:00.000Z',
      raw_payload: { yemeksepetiOrder: { customer: { name: 'Anıl A.', phone: '5339998877' } } },
      customer_masked: {}
    }
  ];
  const pool = {
    query: async () => ({ rows })
  };

  const result = await listOpsCustomers(pool, { branchId: 'branch-1', limit: 50 });
  assert.equal(result.ok, true);
  assert.equal(result.total, 2);
  assert.equal(result.items[0].orderCount, 2);
  assert.equal(result.items[0].name, 'Alaa R.');
  assert.equal(result.items[0].phone, '0532 111 22 33');
  assert.equal(result.items[0].email, 'a@test.com');
  assert.equal(result.items[0].lastOrderId, 'o-new');
});

test('listOpsCustomers filters by search on name', async () => {
  const rows = [
    {
      id: 'o1',
      channel: 'getir',
      display_id: 'g1',
      external_id: 'ext-g1',
      ordered_at: '2026-06-18T10:00:00.000Z',
      raw_payload: { customer: { name: 'Alaa R.', phone: '5321112233' } },
      customer_masked: {}
    },
    {
      id: 'o2',
      channel: 'getir',
      display_id: 'g2',
      external_id: 'ext-g2',
      ordered_at: '2026-06-17T10:00:00.000Z',
      raw_payload: { customer: { name: 'Anıl A.', phone: '5339998877' } },
      customer_masked: {}
    }
  ];
  const pool = { query: async () => ({ rows }) };
  const result = await listOpsCustomers(pool, { branchId: 'branch-1', search: 'anil' });
  assert.equal(result.total, 1);
  assert.equal(extractCustomerName(rows[1]), 'Anıl A.');
  assert.equal(result.items[0].name, 'Anıl A.');
});

test('listOpsCustomers requires branchId', async () => {
  await assert.rejects(
    () => listOpsCustomers({ query: async () => ({ rows: [] }) }, {}),
    /branchId/
  );
});
