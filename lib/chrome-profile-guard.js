import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

export const CHROME_USER_DATA_DIR = path.join(
  os.homedir(),
  'Library/Application Support/Google/Chrome'
);

export function assertNotRealChromeUserDataDir(userDataDir) {
  const target = path.resolve(String(userDataDir || '').trim());
  if (!target) {
    throw new Error('user-data-dir boş olamaz.');
  }
  if (!fs.existsSync(CHROME_USER_DATA_DIR)) {
    return;
  }
  const real = fs.realpathSync(CHROME_USER_DATA_DIR);
  let resolved = target;
  try {
    resolved = fs.realpathSync(target);
  } catch {
    /* henüz oluşturulmamış temp dizin */
  }
  if (resolved === real || resolved.startsWith(`${real}${path.sep}`)) {
    throw new Error(
      'GÜVENLİK: Gerçek Chrome profil dizini otomasyon için kullanılamaz. ' +
      'Yalnızca /tmp altındaki kopya dizin kullanılmalı.'
    );
  }
}

export function isGoogleChromeRunning() {
  try {
    execSync('pgrep -x "Google Chrome"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function isGoogleChromeRunningAsync() {
  return isGoogleChromeRunning();
}

export function readLocalState(chromeDir = CHROME_USER_DATA_DIR) {
  const file = path.join(chromeDir, 'Local State');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function listChromeProfiles(chromeDir = CHROME_USER_DATA_DIR) {
  const localState = readLocalState(chromeDir);
  const cache = localState?.profile?.info_cache || {};
  const entries = Object.entries(cache).map(([dirName, info]) => ({
    dirName,
    name: info?.name || dirName,
    email: info?.user_name || '',
    folderPath: path.join(chromeDir, dirName),
    folderExists: fs.existsSync(path.join(chromeDir, dirName)),
    hasPreferences: fs.existsSync(path.join(chromeDir, dirName, 'Preferences'))
  }));
  entries.sort((a, b) => a.dirName.localeCompare(b.dirName, undefined, { numeric: true }));
  return {
    lastUsed: localState?.profile?.last_used || null,
    profiles: entries
  };
}

export function findOrphanProfileFolders(chromeDir = CHROME_USER_DATA_DIR) {
  const { profiles } = listChromeProfiles(chromeDir);
  const registered = new Set(profiles.map((p) => p.dirName));
  const orphans = [];
  if (!fs.existsSync(chromeDir)) return orphans;
  for (const entry of fs.readdirSync(chromeDir)) {
    if (entry === 'Default' || /^Profile \d+$/.test(entry)) {
      if (!registered.has(entry)) {
        orphans.push({
          dirName: entry,
          folderPath: path.join(chromeDir, entry),
          hasPreferences: fs.existsSync(path.join(chromeDir, entry, 'Preferences'))
        });
      }
    }
  }
  return orphans;
}

export function backupLocalState(options = {}) {
  const chromeDir = options.chromeDir || CHROME_USER_DATA_DIR;
  const backupRoot = options.backupRoot
    || path.join(process.cwd(), 'data/backups/chrome-local-state');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destDir = path.join(backupRoot, stamp);
  fs.mkdirSync(destDir, { recursive: true });

  const src = path.join(chromeDir, 'Local State');
  if (!fs.existsSync(src)) {
    throw new Error(`Local State bulunamadı: ${src}`);
  }
  const dest = path.join(destDir, 'Local State');
  fs.copyFileSync(src, dest);

  const manifest = {
    at: new Date().toISOString(),
    source: src,
    backup: dest,
    ...listChromeProfiles(chromeDir),
    orphans: findOrphanProfileFolders(chromeDir)
  };
  fs.writeFileSync(path.join(destDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const latest = path.join(backupRoot, 'latest-manifest.json');
  fs.writeFileSync(latest, `${JSON.stringify(manifest, null, 2)}\n`);

  return { destDir, manifest };
}
