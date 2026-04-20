#!/usr/bin/env node
/**
 * One-shot migration: upload legacy `uploads/*` files to the configured cloud
 * provider and rewrite the DB references to tenant-scoped keys.
 *
 * Usage:
 *   node scripts/migrate-uploads-to-r2.js            # dry-run (default)
 *   node scripts/migrate-uploads-to-r2.js --apply    # perform uploads + writes
 *
 * Safeguards:
 *   - dry-run is the default; --apply is mandatory to mutate anything.
 *   - state file `scripts/.migrate-state.json` tracks already-processed keys
 *     so repeated runs are idempotent (resume after partial failure).
 *   - each DB row is updated independently; one bad row doesn't abort the batch.
 *   - legacy disk files are NEVER deleted; operator removes them manually after
 *     verifying the new R2 keys work.
 *
 * Columns visited:
 *   - Tenant.logoUrl                       (scalar)
 *   - Item.imageUrl                        (scalar)
 *   - MovementDocument.attachmentUrl       (JSON array)
 *   - GrnImport.pdfAttachmentUrl           (scalar)
 *   - StoreIssue.attachmentUrl             (JSON array)
 *   - GetPassLine.damagePhotos             (JSON array of strings)
 */
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mime = require('path');

const prisma = require('../src/config/database');
const { getStorage, isLocalDriver } = require('../src/config/storage');

const APPLY = process.argv.includes('--apply');
const STATE_FILE = path.join(__dirname, '.migrate-state.json');
const UPLOADS_ROOT = path.join(__dirname, '../uploads');

const MIME_BY_EXT = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const loadState = () => {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
    catch { return { uploaded: {} }; }
};

const saveState = (state) => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

const isLegacyValue = (val) => typeof val === 'string' && val.startsWith('/uploads/');

const legacyToDiskPath = (val) => path.join(UPLOADS_ROOT, val.replace(/^\/uploads\//, ''));

const extOf = (filename) => path.extname(filename || '').toLowerCase();

const newKeyFor = (tenantId, category, legacyValue) => {
    const ext = extOf(legacyValue);
    const filename = path.basename(legacyValue);
    return `tenants/${tenantId}/${category}/${filename}`;
};

const stats = {
    scanned: 0,
    toUpload: 0,
    uploaded: 0,
    skippedExisting: 0,
    missingOnDisk: 0,
    errors: [],
};

const uploadOne = async (storage, tenantId, category, legacyValue, state) => {
    stats.scanned++;

    if (state.uploaded[legacyValue]) {
        stats.skippedExisting++;
        return state.uploaded[legacyValue];
    }

    const diskPath = legacyToDiskPath(legacyValue);
    if (!fs.existsSync(diskPath)) {
        stats.missingOnDisk++;
        stats.errors.push({ legacyValue, reason: 'file not found on disk' });
        return null;
    }

    const newKey = newKeyFor(tenantId, category, legacyValue);
    stats.toUpload++;

    if (!APPLY) {
        console.log(`  [dry] ${legacyValue}  →  ${newKey}`);
        return newKey;
    }

    try {
        const buffer = fs.readFileSync(diskPath);
        await storage.put(newKey, buffer, {
            contentType: MIME_BY_EXT[extOf(legacyValue)] || 'application/octet-stream',
            originalName: path.basename(legacyValue),
        });
        state.uploaded[legacyValue] = newKey;
        saveState(state);
        stats.uploaded++;
        console.log(`  [ok]  ${legacyValue}  →  ${newKey}`);
        return newKey;
    } catch (err) {
        stats.errors.push({ legacyValue, reason: err.message });
        console.error(`  [err] ${legacyValue}: ${err.message}`);
        return null;
    }
};

const migrateScalarColumn = async ({ model, column, label, category, selectExtra = {} }) => {
    const storage = getStorage();
    const state = loadState();

    const where = { [column]: { startsWith: '/uploads/' } };
    const select = { id: true, tenantId: true, [column]: true, ...selectExtra };
    const rows = await prisma[model].findMany({ where, select });

    console.log(`\n== ${label} (${rows.length} row${rows.length === 1 ? '' : 's'})`);
    if (rows.length === 0) return;

    for (const row of rows) {
        const legacy = row[column];
        const newKey = await uploadOne(storage, row.tenantId, category, legacy, state);
        if (APPLY && newKey) {
            await prisma[model].update({ where: { id: row.id }, data: { [column]: newKey } });
        }
    }
};

const migrateJsonArrayColumn = async ({ model, column, label, category }) => {
    const storage = getStorage();
    const state = loadState();

    // JSON array stored as text: we can't use `startsWith` on the column, so
    // pull all non-null rows and filter in JS.
    const rows = await prisma[model].findMany({
        where: { [column]: { not: null } },
        select: { id: true, tenantId: true, [column]: true },
    });

    const rowsToProcess = rows.filter((r) => {
        const v = r[column];
        if (typeof v !== 'string') return false;
        try {
            const arr = JSON.parse(v);
            return Array.isArray(arr) && arr.some((a) => isLegacyValue(a?.url || a?.key || a));
        } catch { return false; }
    });

    console.log(`\n== ${label} (${rowsToProcess.length} row${rowsToProcess.length === 1 ? '' : 's'})`);
    if (rowsToProcess.length === 0) return;

    for (const row of rowsToProcess) {
        const parsed = JSON.parse(row[column]);
        const updated = [];
        let mutated = false;

        for (const item of parsed) {
            if (item && typeof item === 'object') {
                const legacy = item.url || item.key;
                if (isLegacyValue(legacy)) {
                    const newKey = await uploadOne(storage, row.tenantId, category, legacy, state);
                    if (newKey) {
                        updated.push({ ...item, key: newKey, url: newKey });
                        mutated = true;
                        continue;
                    }
                }
                updated.push(item);
            } else if (isLegacyValue(item)) {
                const newKey = await uploadOne(storage, row.tenantId, category, item, state);
                updated.push(newKey || item);
                if (newKey) mutated = true;
            } else {
                updated.push(item);
            }
        }

        if (APPLY && mutated) {
            await prisma[model].update({
                where: { id: row.id },
                data: { [column]: JSON.stringify(updated) },
            });
        }
    }
};

const migrateDamagePhotos = async () => {
    const storage = getStorage();
    const state = loadState();

    // `damagePhotos` is a `String[]` in Prisma → postgres text[]; each element
    // may be a legacy `/uploads/...` path. We can't do a LIKE on array elements,
    // so pull all rows with non-empty array and filter.
    const lines = await prisma.getPassLine.findMany({
        where: { damagePhotos: { isEmpty: false } },
        select: {
            id: true,
            damagePhotos: true,
            getPass: { select: { tenantId: true } },
        },
    });

    const rowsToProcess = lines.filter((l) =>
        Array.isArray(l.damagePhotos) && l.damagePhotos.some(isLegacyValue)
    );

    console.log(`\n== GetPassLine.damagePhotos (${rowsToProcess.length} row${rowsToProcess.length === 1 ? '' : 's'})`);
    if (rowsToProcess.length === 0) return;

    for (const line of rowsToProcess) {
        const tenantId = line.getPass?.tenantId;
        if (!tenantId) continue;

        const updated = [];
        let mutated = false;
        for (const photo of line.damagePhotos) {
            if (isLegacyValue(photo)) {
                const newKey = await uploadOne(storage, tenantId, 'damage-photos', photo, state);
                updated.push(newKey || photo);
                if (newKey) mutated = true;
            } else {
                updated.push(photo);
            }
        }
        if (APPLY && mutated) {
            await prisma.getPassLine.update({
                where: { id: line.id },
                data: { damagePhotos: updated },
            });
        }
    }
};

const main = async () => {
    console.log('──────────────────────────────────────────────────────────────');
    console.log(` migrate-uploads-to-r2  mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    console.log(` storage driver=${getStorage().driver}`);
    console.log('──────────────────────────────────────────────────────────────');

    if (isLocalDriver() && APPLY) {
        console.error('Refusing to run --apply while STORAGE_DRIVER=local. Set STORAGE_DRIVER=r2 and R2_* creds first.');
        process.exit(2);
    }

    await migrateScalarColumn({ model: 'tenant', column: 'logoUrl', label: 'Tenant.logoUrl', category: 'branding' });
    await migrateScalarColumn({ model: 'item', column: 'imageUrl', label: 'Item.imageUrl', category: 'items' });
    await migrateScalarColumn({ model: 'grnImport', column: 'pdfAttachmentUrl', label: 'GrnImport.pdfAttachmentUrl', category: 'grn' });

    await migrateJsonArrayColumn({ model: 'movementDocument', column: 'attachmentUrl', label: 'MovementDocument.attachmentUrl', category: 'attachments/BREAKAGE' });
    await migrateJsonArrayColumn({ model: 'storeIssue', column: 'attachmentUrl', label: 'StoreIssue.attachmentUrl', category: 'attachments/ISSUE' });

    await migrateDamagePhotos();

    console.log('\n──────────────────────────────────────────────────────────────');
    console.log(' Summary');
    console.log(`   scanned:           ${stats.scanned}`);
    console.log(`   planned upload:    ${stats.toUpload}`);
    console.log(`   uploaded:          ${stats.uploaded}`);
    console.log(`   already migrated:  ${stats.skippedExisting}`);
    console.log(`   missing on disk:   ${stats.missingOnDisk}`);
    console.log(`   errors:            ${stats.errors.length}`);
    if (stats.errors.length > 0) {
        console.log('\n   first 10 errors:');
        stats.errors.slice(0, 10).forEach((e) => console.log(`     - ${e.legacyValue}: ${e.reason}`));
    }
    console.log('──────────────────────────────────────────────────────────────');
    if (!APPLY) {
        console.log('\nDry-run complete. Re-run with --apply to perform uploads + DB updates.');
    } else {
        console.log('\nMigration complete. Verify a few keys via GET /api/files/signed-url, then manually clean uploads/ on disk.');
    }
};

main()
    .catch((err) => {
        console.error('FATAL:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
