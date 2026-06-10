import { randomBytes } from 'node:crypto';

export function generatePlatformToken() {
  return randomBytes(32).toString('hex');
}

export function validateSecurityConfig(config) {
  const errors = [];

  if (config.authRequired && !config.platformApiToken) {
    errors.push('PLATFORM_API_TOKEN zorunlu (AUTH_REQUIRED=true). .env dosyasına token ekleyin veya geliştirme için AUTH_ALLOW_INSECURE=true kullanın.');
  }

  const isProduction = String(config.nodeEnv || '').toLowerCase() === 'production';
  if (isProduction && config.platformApiToken && config.platformApiToken.length < 24) {
    errors.push('PLATFORM_API_TOKEN çok kısa — production için en az 24 karakter kullanın.');
  }

  if (errors.length) {
    const error = new Error(errors.join(' '));
    error.code = 'SECURITY_CONFIG';
    throw error;
  }
}
