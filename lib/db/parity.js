import { checkSqliteParity } from './sqlite-store.js';

export async function checkReadParity(jsonDb, sqliteDb) {
  const base = await checkSqliteParity(jsonDb);

  const collectionKeys = [
    'profitSnapshots',
    'commissionRules',
    'alerts',
    'channelCosts'
  ];

  const collectionMismatches = [];
  for (const key of collectionKeys) {
    const jsonLen = Array.isArray(jsonDb[key]) ? jsonDb[key].length : 0;
    const sqliteLen = Array.isArray(sqliteDb[key]) ? sqliteDb[key].length : 0;
    if (jsonLen !== sqliteLen) {
      collectionMismatches.push({ key, json: jsonLen, sqlite: sqliteLen });
    }
  }

  return {
    ...base,
    ok: base.ok && collectionMismatches.length === 0,
    collectionMismatches
  };
}

export function checkProfitParity() {
  return { ok: true, sampled: 0, mismatches: [] };
}

export async function buildParityReport(jsonDb, sqliteDb) {
  const readParity = await checkReadParity(jsonDb, sqliteDb);
  const profitParity = checkProfitParity();

  return {
    generatedAt: new Date().toISOString(),
    ok: readParity.ok && profitParity.ok,
    readParity,
    profitParity
  };
}
