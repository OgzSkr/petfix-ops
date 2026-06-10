import fs from 'node:fs/promises';
import path from 'node:path';
import { paths, limits } from '../config.js';
import { archiveOldHistory } from './analytics.js';

export function buildHistoryRecord(snapshot, meta = {}) {
  return {
    id: `${snapshot.barcode}|${snapshot.updatedAt}|${meta.source || 'unknown'}`,
    barcode: String(snapshot.barcode || ''),
    buyboxOrder: snapshot.buyboxOrder ?? '',
    buyboxPrice: snapshot.buyboxPrice ?? '',
    secondBuyboxPrice: snapshot.secondBuyboxPrice ?? '',
    thirdBuyboxPrice: snapshot.thirdBuyboxPrice ?? '',
    sellerId: snapshot.sellerId ?? '',
    sellerName: snapshot.sellerName ?? '',
    source: meta.source || 'unknown',
    channel: meta.channel || 'trendyol',
    recordedAt: new Date().toISOString(),
    snapshotUpdatedAt: snapshot.updatedAt || null
  };
}

export async function appendBuyboxHistory(snapshots, meta = {}) {
  const items = (snapshots || []).filter((item) => item?.barcode);
  if (!items.length) {
    return { appended: 0 };
  }

  await fs.mkdir(path.dirname(paths.buyboxHistory), { recursive: true });
  const lines = items.map((snapshot) => JSON.stringify(buildHistoryRecord(snapshot, meta))).join('\n') + '\n';
  await fs.appendFile(paths.buyboxHistory, lines, 'utf8');
  await trimHistoryFile();

  return { appended: items.length };
}

async function trimHistoryFile() {
  try {
    const text = await fs.readFile(paths.buyboxHistory, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    if (lines.length <= limits.buyboxHistoryMaxLines) return;

    await archiveOldHistory();
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
}

export async function readBuyboxHistory({ barcode, limit = 100, since } = {}) {
  let text = '';

  try {
    text = await fs.readFile(paths.buyboxHistory, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { total: 0, rows: [] };
    }
    throw error;
  }

  const sinceMs = since ? new Date(since).getTime() : 0;
  const max = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  const rows = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (barcode && String(row.barcode) !== String(barcode)) continue;
      if (sinceMs && new Date(row.recordedAt).getTime() < sinceMs) continue;
      rows.push(row);
    } catch {
      // skip corrupt line
    }
  }

  rows.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));

  return {
    total: rows.length,
    rows: rows.slice(0, max)
  };
}
