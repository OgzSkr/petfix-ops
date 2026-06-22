import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveYemeksepetiVendorIds } from '../lib/channels/yemeksepeti-vendor-ids.js';

test('resolveYemeksepetiVendorIds merges vendor, store and extra ids', () => {
  const ids = resolveYemeksepetiVendorIds(
    { vendorId: 'jk2w', storeId: '7253942', externalPartnerConfigId: '147852147852' },
    { YEMEKSEPETI_VENDOR_IDS: '999, jk2w' }
  );

  assert.deepEqual(ids.sort(), ['147852147852', '7253942', '999', 'jk2w'].sort());
});
