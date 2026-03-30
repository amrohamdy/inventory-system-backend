#!/usr/bin/env node
/**
 * One-time baseline for Prisma P3005: "The database schema is not empty"
 *
 * Use ONLY when production DB already matches prisma/schema.prisma + all migrations
 * (e.g. DB was synced earlier via `db push` or manual SQL), but `_prisma_migrations`
 * is missing or empty so `prisma migrate deploy` refuses to run.
 *
 * This marks every migration folder under prisma/migrations as applied WITHOUT re-running SQL.
 * Re-running is mostly safe: migrations already recorded are skipped.
 *
 * After success, runs `prisma migrate deploy` to verify (should be no pending migrations).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/baseline-migrations.js
 *
 * Railway (one-off): railway run npm run db:baseline
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const migrationsDir = path.join(root, 'prisma', 'migrations');

if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
}

const dirs = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(migrationsDir, name, 'migration.sql')))
    .sort();

if (dirs.length === 0) {
    console.error('No migration folders found in prisma/migrations');
    process.exit(1);
}

function resolveApplied(migrationName) {
    try {
        const out = execSync(`npx prisma migrate resolve --applied "${migrationName}"`, {
            encoding: 'utf8',
            env: process.env,
            cwd: root,
            stdio: ['inherit', 'pipe', 'pipe'],
        });
        if (out) process.stdout.write(out);
    } catch (err) {
        const stderr = err.stderr ? err.stderr.toString() : '';
        const stdout = err.stdout ? err.stdout.toString() : '';
        const combined = `${stderr}${stdout}${err.message || ''}`;
        process.stderr.write(stderr);
        if (stdout) process.stdout.write(stdout);
        const already =
            /already recorded|already been applied|P3008|is already marked as applied/i.test(combined);
        if (already) {
            console.log('   (already recorded — skipping)\n');
            return;
        }
        throw err;
    }
}

console.log(`Baselining ${dirs.length} migration(s) as already applied...\n`);

for (const migrationName of dirs) {
    console.log(`→ resolve --applied "${migrationName}"`);
    resolveApplied(migrationName);
}

console.log('\nVerifying with prisma migrate deploy...\n');
execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
    cwd: root,
});

console.log('\nDone. Use start:prod on Railway: prisma migrate deploy && node src/server.js');
