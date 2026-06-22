#!/usr/bin/env node
/**
 * Personel kullanıcı yönetimi (CLI)
 *
 * Örnek:
 *   node scripts/ops-staff-user.js list
 *   node scripts/ops-staff-user.js add --username depo1 --name "Depo 1" --role picker --password 'Sifre123!'
 *   node scripts/ops-staff-user.js add --username kurye1 --name "Kurye 1" --role courier --password 'Sifre123!'
 *   node scripts/ops-staff-user.js reset-password --username depo1 --password 'YeniSifre123!'
 *   node scripts/ops-staff-user.js deactivate --username depo1
 */
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { ensureDefaultBranch } from '../lib/ops-hub/db/repository.js';
import { hashStaffPassword } from '../lib/ops-hub/staff/staff-auth-service.js';
import {
  getStaffUserByUsername,
  insertStaffUser,
  listStaffUsers,
  mapStaffUserRow,
  setStaffUserActive,
  updateStaffPassword
} from '../lib/ops-hub/staff/staff-user-repository.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[key] = value;
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const command = args._[0];
  if (!command) {
    console.error('Komut: list | add | reset-password | deactivate | activate');
    process.exit(1);
  }

  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  const pool = await createOpsPool(config.postgresUrl);
  await applyOpsMigrations(pool);

  const branch = await ensureDefaultBranch(pool);
  const branchId = branch.id;

  try {
    if (command === 'list') {
      const rows = await listStaffUsers(pool, { branchId });
      if (!rows.length) {
        console.log('Kayıtlı personel yok.');
        return;
      }
      for (const row of rows) {
        console.log(
          `${row.active ? '✓' : '✗'} ${row.username}\t${row.displayName}\t${row.role}\t${row.lastLoginAt || '-'}`
        );
      }
      return;
    }

    if (command === 'add') {
      const username = args.username;
      const displayName = args.name || username;
      const role = args.role || 'picker';
      const password = args.password;
      if (!username || !password) {
        console.error('--username ve --password gerekli');
        process.exit(1);
      }
      if (!['picker', 'courier', 'supervisor'].includes(role)) {
        console.error('--role picker | courier | supervisor');
        process.exit(1);
      }
      const existing = await getStaffUserByUsername(pool, { branchId, username });
      if (existing) {
        console.error(`Kullanıcı zaten var: ${username}`);
        process.exit(1);
      }
      const passwordHash = await hashStaffPassword(password);
      const user = await insertStaffUser(pool, {
        branchId,
        username,
        passwordHash,
        displayName,
        role
      });
      console.log('Oluşturuldu:', mapStaffUserRow(user));
      return;
    }

    if (command === 'reset-password') {
      const username = args.username;
      const password = args.password;
      if (!username || !password) {
        console.error('--username ve --password gerekli');
        process.exit(1);
      }
      const user = await getStaffUserByUsername(pool, { branchId, username });
      if (!user) {
        console.error('Kullanıcı bulunamadı');
        process.exit(1);
      }
      await updateStaffPassword(pool, user.id, await hashStaffPassword(password));
      console.log(`Şifre güncellendi: ${username}`);
      return;
    }

    if (command === 'deactivate' || command === 'activate') {
      const username = args.username;
      if (!username) {
        console.error('--username gerekli');
        process.exit(1);
      }
      const user = await getStaffUserByUsername(pool, { branchId, username });
      if (!user) {
        console.error('Kullanıcı bulunamadı');
        process.exit(1);
      }
      await setStaffUserActive(pool, user.id, command === 'activate');
      console.log(`${command === 'activate' ? 'Aktif' : 'Pasif'}: ${username}`);
      return;
    }

    console.error('Bilinmeyen komut:', command);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
