import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertNotRealChromeUserDataDir,
  CHROME_USER_DATA_DIR
} from '../lib/chrome-profile-guard.js';

test('assertNotRealChromeUserDataDir blocks real Chrome directory', () => {
  if (!fs.existsSync(CHROME_USER_DATA_DIR)) {
    return;
  }
  assert.throws(
    () => assertNotRealChromeUserDataDir(CHROME_USER_DATA_DIR),
    /GÜVENLİK/
  );
});

test('assertNotRealChromeUserDataDir allows temp automation dir', () => {
  const tempDir = path.join(os.tmpdir(), 'petfix-chrome-automation-test');
  assert.doesNotThrow(() => assertNotRealChromeUserDataDir(tempDir));
});
