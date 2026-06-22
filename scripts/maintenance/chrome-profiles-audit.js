#!/usr/bin/env node
/**
 * Chrome profil denetimi ve Local State yedeği.
 * Gerçek Chrome profillerini değiştirmez — yalnızca okur ve yedekler.
 *
 *   node scripts/chrome-profiles-audit.js
 *   node scripts/chrome-profiles-audit.js --backup
 */
import {
  backupLocalState,
  findOrphanProfileFolders,
  isGoogleChromeRunningAsync,
  listChromeProfiles,
  CHROME_USER_DATA_DIR
} from '../lib/chrome-profile-guard.js';

const doBackup = process.argv.includes('--backup') || process.argv.includes('-b');

console.log('=== Chrome profil denetimi ===\n');
console.log('Dizin:', CHROME_USER_DATA_DIR);

const chromeRunning = await isGoogleChromeRunningAsync();
console.log('Chrome çalışıyor:', chromeRunning ? 'evet' : 'hayır');

const { lastUsed, profiles } = listChromeProfiles();
console.log('Son kullanılan profil:', lastUsed || '—');
console.log('\nKayıtlı profiller:');
for (const p of profiles) {
  const flags = [
    p.folderExists ? 'klasör✓' : 'klasör✗',
    p.hasPreferences ? 'prefs✓' : 'prefs✗'
  ].join(' · ');
  console.log(`  • ${p.dirName}\t${p.name}\t${p.email || '—'}\t[${flags}]`);
}

const orphans = findOrphanProfileFolders();
if (orphans.length) {
  console.log('\nLocal State\'te kayıtsız klasörler:');
  for (const o of orphans) {
    console.log(`  • ${o.dirName} (${o.hasPreferences ? 'Preferences var' : 'Preferences yok'})`);
  }
} else {
  console.log('\nKayıtsız profil klasörü yok.');
}

if (doBackup) {
  const { destDir, manifest } = backupLocalState();
  console.log(`\nYedek alındı: ${destDir}`);
  console.log(`Profil sayısı: ${manifest.profiles.length}`);
}

console.log('\nNot: Otomasyon scriptleri gerçek Chrome dizinini --user-data-dir olarak kullanmamalı.');
console.log('YS webhook için: node scripts/ys-portal-webhook-cdp.js (yalnızca /tmp kopyası).');
