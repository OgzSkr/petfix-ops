/**
 * Tüm dış API çağrıları için timeout'lu fetch sarmalayıcı.
 * Asılı (hung) bir partner isteğinin poll timer'ını veya HTTP isteğini süresiz
 * bloke etmesini engeller. AbortController ile süre dolunca istek iptal edilir.
 */
const DEFAULT_TIMEOUT_MS = Number(process.env.OUTBOUND_FETCH_TIMEOUT_MS) || 25000;

export async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: rest.signal || controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`İstek zaman aşımına uğradı (${timeoutMs}ms): ${url}`);
      timeoutError.code = 'ETIMEDOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
