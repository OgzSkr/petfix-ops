const PII_STRING_KEYS = new Set([
  'name',
  'firstName',
  'lastName',
  'fullName',
  'phone',
  'mobile',
  'email',
  'address',
  'addressLine',
  'addressDetail',
  'note',
  'customerNote'
]);

function maskString(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= 2) {
    return '*'.repeat(text.length);
  }
  if (text.length <= 4) {
    return `${text.slice(0, 1)}${'*'.repeat(text.length - 1)}`;
  }
  return `${text.slice(0, 2)}${'*'.repeat(Math.max(1, text.length - 4))}${text.slice(-2)}`;
}

function maskNode(node) {
  if (node == null || typeof node !== 'object') {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((item) => maskNode(item));
  }

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (PII_STRING_KEYS.has(key) && typeof value === 'string') {
      out[key] = maskString(value);
    } else if (typeof value === 'object' && value !== null) {
      out[key] = maskNode(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function maskCustomerPayload(payload) {
  if (payload == null) {
    return null;
  }
  if (typeof payload !== 'object') {
    return payload;
  }
  return maskNode(structuredClone(payload));
}
