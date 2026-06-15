import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIST_PAGE_SIZE,
  parseListPagination,
  paginateRows
} from '../lib/product-catalog.js';

test('parseListPagination defaults to page 1 and limit 10', () => {
  const params = new URLSearchParams();
  assert.deepEqual(parseListPagination(params), {
    page: 1,
    limit: DEFAULT_LIST_PAGE_SIZE,
    returnAll: false
  });
});

test('parseListPagination honors page and limit query params', () => {
  const params = new URLSearchParams('page=3&limit=25');
  assert.deepEqual(parseListPagination(params), {
    page: 3,
    limit: 25,
    returnAll: false
  });
});

test('parseListPagination treats limit=0 as return all', () => {
  const params = new URLSearchParams('page=5&limit=0');
  assert.deepEqual(parseListPagination(params), {
    page: 1,
    limit: 0,
    returnAll: true
  });
});

test('parseListPagination clamps invalid values', () => {
  const params = new URLSearchParams('page=-2&limit=999');
  assert.deepEqual(parseListPagination(params), {
    page: 1,
    limit: 100,
    returnAll: false
  });
});

test('paginateRows slices rows and reports metadata', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));
  const paged = paginateRows(rows, { page: 2, limit: 10 });

  assert.equal(paged.total, 25);
  assert.equal(paged.page, 2);
  assert.equal(paged.limit, 10);
  assert.equal(paged.totalPages, 3);
  assert.deepEqual(paged.rows.map((row) => row.id), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
});

test('paginateRows returns all rows when returnAll is true', () => {
  const rows = [{ id: 1 }, { id: 2 }];
  const paged = paginateRows(rows, { page: 99, limit: 0, returnAll: true });

  assert.equal(paged.total, 2);
  assert.equal(paged.page, 1);
  assert.equal(paged.totalPages, 1);
  assert.deepEqual(paged.rows, rows);
});
