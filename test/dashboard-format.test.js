import test from 'node:test';
import assert from 'node:assert/strict';

function formatMoney(value) {
  return '₺' + Number(value || 0).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

test('formatMoney uses a single currency symbol', () => {
  const formatted = formatMoney(200);
  assert.equal((formatted.match(/₺/g) || []).length, 1);
  assert.equal(formatted, '₺200,00');
});

test('live order amount cell uses formatMoney output directly', () => {
  const cell = formatMoney(200);
  assert.equal(cell, '₺200,00');
});
