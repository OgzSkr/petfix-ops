import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readPlatformConfigEnv,
  persistPlatformConfigUpdates,
  applyPlatformEnvToProcess
} from '../lib/env.js';

test('readPlatformConfigEnv merges runtime-secrets over base env file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'petfix-env-'));
  const basePath = path.join(dir, '.env.production');
  const prevRuntimePath = process.env.RUNTIME_SECRETS_PATH;
  const runtimePath = path.join(dir, 'runtime-secrets.env');

  process.env.RUNTIME_SECRETS_PATH = runtimePath;
  await fs.writeFile(basePath, 'FF_CHANNEL_STATUS_WRITE=false\nOPS_SHADOW_MODE_DEFAULT=true\n');
  await fs.writeFile(runtimePath, 'FF_CHANNEL_STATUS_WRITE=true\n');

  try {
    const merged = await readPlatformConfigEnv(basePath);
    assert.equal(merged.FF_CHANNEL_STATUS_WRITE, 'true');
    assert.equal(merged.OPS_SHADOW_MODE_DEFAULT, 'true');
  } finally {
    if (prevRuntimePath === undefined) delete process.env.RUNTIME_SECRETS_PATH;
    else process.env.RUNTIME_SECRETS_PATH = prevRuntimePath;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('persistPlatformConfigUpdates writes runtime file when base env is read-only', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'petfix-env-'));
  const basePath = path.join(dir, '.env.production');
  const prevRuntimePath = process.env.RUNTIME_SECRETS_PATH;
  const runtimePath = path.join(dir, 'runtime-secrets.env');
  const prevFlag = process.env.FF_STOCK_PUSH;

  process.env.RUNTIME_SECRETS_PATH = runtimePath;
  await fs.writeFile(basePath, 'FF_STOCK_PUSH=false\n');
  await fs.chmod(basePath, 0o444);

  try {
    const result = await persistPlatformConfigUpdates(basePath, { FF_STOCK_PUSH: 'true' });
    assert.equal(result.wrotePrimary, false);
    assert.equal(result.wroteRuntime, true);
    assert.equal(process.env.FF_STOCK_PUSH, 'true');

    const merged = await readPlatformConfigEnv(basePath);
    assert.equal(merged.FF_STOCK_PUSH, 'true');
  } finally {
    await fs.chmod(basePath, 0o644).catch(() => {});
    if (prevRuntimePath === undefined) delete process.env.RUNTIME_SECRETS_PATH;
    else process.env.RUNTIME_SECRETS_PATH = prevRuntimePath;
    if (prevFlag === undefined) delete process.env.FF_STOCK_PUSH;
    else process.env.FF_STOCK_PUSH = prevFlag;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('applyPlatformEnvToProcess updates process.env keys', () => {
  const prev = process.env.BENIMPOS_AUTO_SALE;
  applyPlatformEnvToProcess({ BENIMPOS_AUTO_SALE: 'true' });
  assert.equal(process.env.BENIMPOS_AUTO_SALE, 'true');
  if (prev === undefined) delete process.env.BENIMPOS_AUTO_SALE;
  else process.env.BENIMPOS_AUTO_SALE = prev;
});
