import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARSER = path.resolve(__dirname, '../../scripts/parse-tariff-xlsx.py');

export function parseXlsxBuffer(buffer) {
  const result = spawnSync('python3', [PARSER], {
    input: buffer,
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8'
  });

  if (result.error) {
    throw new Error(`Excel okunamadı: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim() || 'Excel parse hatası';
    throw new Error(message);
  }

  const payload = JSON.parse(result.stdout);
  if (!payload.ok) {
    throw new Error(payload.error || 'Excel parse hatası');
  }

  return payload.rows;
}

export async function parseXlsxFile(filePath) {
  const { readFile } = await import('node:fs/promises');
  return parseXlsxBuffer(await readFile(filePath));
}
