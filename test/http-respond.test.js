import test from 'node:test';
import assert from 'node:assert/strict';
import { readJsonBody } from '../lib/http/respond.js';

test('readJsonBody rejects invalid JSON with 400', async () => {
  const request = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{ invalid', 'utf8');
    }
  };

  await assert.rejects(
    () => readJsonBody(request),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /JSON/i);
      return true;
    }
  );
});

test('readJsonBody returns empty object for empty body', async () => {
  const request = {
    async *[Symbol.asyncIterator]() {
      // empty
    }
  };
  const body = await readJsonBody(request);
  assert.deepEqual(body, {});
});
