#!/usr/bin/env node
/**
 * Chrome profil adlarını ve bozuk dosyaları onarır.
 * Senkronizasyonu yeniden tetiklemek için sync bayraklarını düzeltir.
 *
 * Chrome KAPALI olmalı:
 *   node scripts/chrome-profiles-repair.js
 *   node scripts/chrome-profiles-repair.js --quit-chrome
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  backupLocalState,
  CHROME_USER_DATA_DIR,
  isGoogleChromeRunning,
  listChromeProfiles,
  readLocalState
} from '../lib/chrome-profile-guard.js';

const quitChrome = process.argv.includes('--quit-chrome');
const dryRun = process.argv.includes('--dry-run');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function backupFile(src, backupDir) {
  const name = src.replace(/[/\\]/g, '__');
  const dest = path.join(backupDir, name);
  fs.copyFileSync(src, dest);
  return dest;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function quitGoogleChrome() {
  try {
    execSync(`osascript -e 'tell application "Google Chrome" to quit'`, { stdio: 'ignore' });
  } catch {
    /* Chrome açık değil */
  }
}

async function waitForChromeExit(maxSec = 20) {
  for (let i = 0; i < maxSec; i += 1) {
    if (!isGoogleChromeRunning()) return true;
    await sleep(1000);
  }
  return !isGoogleChromeRunning();
}

function findNestedLocalStateFiles(chromeDir) {
  const hits = [];
  for (const entry of fs.readdirSync(chromeDir)) {
    if (entry === 'Default' || /^Profile \d+$/.test(entry)) {
      const nested = path.join(chromeDir, entry, 'Local State');
      if (fs.existsSync(nested)) hits.push(nested);
    }
  }
  return hits;
}

function repairProfilePreferences(chromeDir, dirName, displayName, backupDir, changes) {
  const prefPath = path.join(chromeDir, dirName, 'Preferences');
  if (!fs.existsSync(prefPath)) return;
  backupFile(prefPath, backupDir);
  const prefs = readJson(prefPath);
  const profile = prefs.profile || {};
  const sync = prefs.sync || {};

  if (profile.name !== displayName) {
    changes.push(`${dirName}: profile.name "${profile.name}" → "${displayName}"`);
    profile.name = displayName;
    profile.is_using_default_name = false;
    prefs.profile = profile;
  }

  if (!sync.requested) {
    changes.push(`${dirName}: sync.requested → true`);
    sync.requested = true;
  }
  if (sync.suppress_start) {
    changes.push(`${dirName}: sync.suppress_start kaldırıldı`);
    delete sync.suppress_start;
  }
  if (sync.has_setup_completed === false) {
    changes.push(`${dirName}: sync.has_setup_completed → true`);
    sync.has_setup_completed = true;
  }
  prefs.sync = sync;

  if (!dryRun) writeJson(prefPath, prefs);
}

function repairTopLevelLocalState(chromeDir, backupDir, changes) {
  const localStatePath = path.join(chromeDir, 'Local State');
  backupFile(localStatePath, backupDir);
  const localState = readLocalState(chromeDir);
  const cache = localState?.profile?.info_cache || {};
  let touched = false;

  for (const [dirName, info] of Object.entries(cache)) {
    const expectedName = info?.name;
    if (!expectedName || expectedName === 'Kişi 1') continue;
    if (info.is_using_default_name === true && dirName !== 'Default') {
      changes.push(`Local State: ${dirName} is_using_default_name → false`);
      info.is_using_default_name = false;
      touched = true;
    }
  }

  if (touched && !dryRun) writeJson(localStatePath, localState);
}

async function main() {
  console.log('=== Chrome profil onarımı ===\n');

  if (quitChrome) {
    console.log('Chrome kapatılıyor…');
    quitGoogleChrome();
    const exited = await waitForChromeExit();
    if (!exited) {
      console.error('Chrome hâlâ çalışıyor. Tüm pencereleri kapatıp tekrar deneyin.');
      process.exit(1);
    }
  } else if (isGoogleChromeRunning()) {
    console.error('Chrome açık. Onarım için kapatın veya --quit-chrome kullanın.');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), 'data/backups/chrome-repair', stamp);
  fs.mkdirSync(backupDir, { recursive: true });

  const { destDir } = backupLocalState({ backupRoot: path.join(process.cwd(), 'data/backups/chrome-local-state') });
  console.log('Local State yedeği:', destDir);

  const { profiles } = listChromeProfiles();
  const changes = [];

  for (const p of profiles) {
    if (!p.folderExists) continue;
    repairProfilePreferences(CHROME_USER_DATA_DIR, p.dirName, p.name, backupDir, changes);
  }

  repairTopLevelLocalState(CHROME_USER_DATA_DIR, backupDir, changes);

  const nested = findNestedLocalStateFiles(CHROME_USER_DATA_DIR);
  for (const file of nested) {
    const quarantine = path.join(backupDir, 'quarantine', file.replace(/[/\\]/g, '__'));
    fs.mkdirSync(path.dirname(quarantine), { recursive: true });
    changes.push(`Karantina: ${file}`);
    if (!dryRun) {
      fs.copyFileSync(file, quarantine);
      fs.unlinkSync(file);
    }
  }

  const report = {
    at: new Date().toISOString(),
    dryRun,
    changes,
    profiles: profiles.map((p) => ({ dirName: p.dirName, name: p.name, email: p.email }))
  };
  fs.writeFileSync(path.join(backupDir, 'repair-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  if (!changes.length) {
    console.log('\nOnarılacak bir şey bulunamadı.');
    return;
  }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Yapılan değişiklikler:`);
  for (const line of changes) console.log(' •', line);
  console.log(`\nYedek klasörü: ${backupDir}`);

  if (!dryRun) {
    console.log('\nChrome\'u açıp her profilde chrome://sync-internals adresini kontrol edin.');
    console.log('Senkronizasyon hâlâ durmuşsa: Ayarlar → Senkronizasyon → Oturumu kapat / tekrar aç.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
