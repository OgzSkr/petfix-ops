import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_SCRIPT = path.resolve(__dirname, '../../scripts/export-tariff-xlsx.py');

export function writeXlsxBuffer(rows) {
  const result = spawnSync('python3', [EXPORT_SCRIPT], {
    input: JSON.stringify({ rows }),
    maxBuffer: 32 * 1024 * 1024
  });

  if (result.error) {
    throw new Error(`Excel oluşturulamadı: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').toString().trim() || 'Excel export hatası';
    throw new Error(message);
  }

  return result.stdout;
}
