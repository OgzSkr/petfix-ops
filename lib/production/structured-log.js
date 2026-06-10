const SECRET_PATTERNS = [
  /authorization/i,
  /secret/i,
  /password/i,
  /token/i,
  /api[_-]?key/i,
  /client_secret/i
];

const PII_KEYS = new Set(['phone', 'email', 'address', 'customer', 'name', 'full_name']);

function sanitizeValue(key, value) {
  if (value == null) return value;
  const keyLower = String(key).toLowerCase();
  if (SECRET_PATTERNS.some((re) => re.test(keyLower))) {
    return '[REDACTED]';
  }
  if (PII_KEYS.has(keyLower)) {
    return '[REDACTED]';
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeValue(k, v);
    }
    return out;
  }
  return value;
}

/**
 * JSON yapılandırılmış log — stdout'a tek satır yazar.
 */
export function logStructured(fields = {}) {
  const { meta, ...rest } = fields;
  const entry = {
    timestamp: new Date().toISOString(),
    level: rest.level || 'info',
    component: rest.component || 'APP'
  };
  for (const [key, value] of Object.entries(rest)) {
    if (key === 'level' || key === 'component') continue;
    entry[key] = sanitizeValue(key, value);
  }
  if (meta && typeof meta === 'object') {
    entry.meta = sanitizeValue('meta', meta);
  }

  const line = JSON.stringify(entry);
  if (entry.level === 'error') {
    console.error(line);
  } else if (entry.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
  return entry;
}

export function logWebhookEvent(fields) {
  return logStructured({
    component: fields.component || 'YS-WEBHOOK',
    level: fields.level || 'info',
    channel: fields.channel,
    order_id: fields.order_id || fields.orderId,
    event_id: fields.event_id || fields.eventId,
    source: fields.source,
    status: fields.status,
    duration_ms: fields.duration_ms ?? fields.durationMs,
    error_code: fields.error_code || fields.errorCode,
    ...fields
  });
}
