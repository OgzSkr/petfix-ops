import { createHash } from 'node:crypto';

/** Market Next benzeri sabit sayısal müşteri kimliği. */
export function stableCustomerDisplayId(identityKey) {
  const hex = createHash('sha256').update(String(identityKey)).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16) % 100000;
}
