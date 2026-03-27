/**
 * Smoke Test — M13 Phase 2: Breakage & Loss Report
 *
 * Filters used:
 *   dateFrom : 2024-01-01
 *   dateTo   : 2027-12-31
 *   user     : admin@test.com
 *   run at   : <timestamp printed below>
 *
 * documentCount definition: COUNT DISTINCT Ref No (referenceNo) — not row count.
 * Posting Date = inventoryLedger.createdAt (labeled "Posting Date" in UI/Excel).
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:4000';
const EMAIL = 'admin@grandhorizon.com';
const PASSWORD = 'Admin@123';
const TENANT_SLUG = 'grand-horizon';
const DATE_FROM = '2024-01-01';
const DATE_TO = '2027-12-31';

const timestamp = new Date().toISOString();
let token = '';
let allPassed = true;

function log(msg) { console.log(msg); }
function pass(msg) { console.log(`  ✅ PASS — ${msg}`); }
function fail(msg) { console.error(`  ❌ FAIL — ${msg}`); allPassed = false; }

// ── HTTP helpers ────────────────────────────────────────────────────────────────

function request(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'localhost',
            port: 4000,
            path,
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
        };
        const req = http.request(opts, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function get(path, headers = {}) {
    return request('GET', path, null, headers);
}

function authHeader() {
    return { Authorization: `Bearer ${token}` };
}

// ── Steps ───────────────────────────────────────────────────────────────────────

async function step1_auth() {
    log('\n── Step 1: Authenticate ─────────────────────────────────────────');
    log(`   User      : ${EMAIL}`);
    log(`   Timestamp : ${timestamp}`);
    log(`   dateFrom  : ${DATE_FROM}`);
    log(`   dateTo    : ${DATE_TO}`);

    const res = await request('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD, tenantSlug: TENANT_SLUG });
    if (res.status !== 200) {
        fail(`Login failed — HTTP ${res.status}: ${res.body.toString()}`);
        return false;
    }
    const parsed = JSON.parse(res.body);
    token = parsed.token || parsed.data?.token || '';
    if (!token) { fail('No token in login response'); return false; }
    pass(`Authenticated (token starts: ${token.substring(0, 20)}...)`);
    return true;
}

async function step2_getReport() {
    log('\n── Step 2: GET /api/reports/breakage ────────────────────────────');
    const qs = `?dateFrom=${DATE_FROM}&dateTo=${DATE_TO}`;
    const res = await get(`/api/reports/breakage${qs}`, authHeader());

    if (res.status !== 200) {
        fail(`HTTP ${res.status}: ${res.body.toString()}`);
        return null;
    }

    const json = JSON.parse(res.body);
    const { data, totals, filters } = json;

    log(`   Row count       : ${data.length}`);
    log(`   totalQty        : ${totals?.totalQty}`);
    log(`   totalAmount     : ${totals?.totalAmount}`);
    log(`   documentCount   : ${totals?.documentCount}  (= COUNT DISTINCT Ref No)`);
    log(`   filters echo    : ${JSON.stringify(filters)}`);

    // Save raw response
    fs.writeFileSync(path.join(__dirname, 'breakage_response.json'), JSON.stringify(json, null, 2));
    pass(`Received ${data.length} rows — breakage_response.json saved`);

    // Validate documentCount <= row count  (distinct can never exceed rows)
    if (totals?.documentCount > data.length) {
        fail(`documentCount (${totals.documentCount}) > row count (${data.length}) — impossible`);
    } else {
        pass(`documentCount (${totals?.documentCount}) ≤ row count (${data.length}) — consistent`);
    }

    // Validate total amount reconciles with row sum
    if (data.length > 0) {
        const rowSum = data.reduce((s, r) => s + (r.totalCost || 0), 0);
        const delta = Math.abs(rowSum - (totals?.totalAmount || 0));
        if (delta < 0.01) {
            pass(`totalAmount (${totals.totalAmount}) matches row-level sum (${rowSum.toFixed(4)})`);
        } else {
            fail(`totalAmount mismatch — API: ${totals?.totalAmount}, row sum: ${rowSum.toFixed(4)}`);
        }
    }

    // Validate first row has postingDate field (not "date")
    if (data.length > 0) {
        if ('postingDate' in data[0]) {
            pass(`Row[0] uses field "postingDate" — labeled "Posting Date" in UI ✓`);
        } else if ('date' in data[0]) {
            fail(`Row[0] uses field "date" instead of "postingDate" — label inconsistency`);
        }
    }

    return { data, totals, filters };
}

async function step3_export() {
    log('\n── Step 3: GET /api/reports/breakage/export ─────────────────────');
    // Uses SAME filters as step 2
    const qs = `?dateFrom=${DATE_FROM}&dateTo=${DATE_TO}`;
    const res = await get(`/api/reports/breakage/export${qs}`, authHeader());

    if (res.status !== 200) {
        fail(`HTTP ${res.status}: ${res.body.toString().substring(0, 200)}`);
        return;
    }

    const contentType = res.headers['content-type'] || '';
    const contentLength = parseInt(res.headers['content-length'] || res.body.length, 10);

    log(`   Content-Type   : ${contentType}`);
    log(`   Content-Length : ${contentLength} bytes`);

    if (contentType.includes('spreadsheetml')) {
        pass(`Content-Type is xlsx`);
    } else {
        fail(`Expected xlsx content-type, got: ${contentType}`);
    }

    if (contentLength > 0) {
        pass(`Content-Length = ${contentLength} bytes (non-empty)`);
    } else {
        fail(`Content-Length is 0 — export file is empty`);
    }

    // Save xlsx file
    const xlsxPath = path.join(__dirname, 'breakage.xlsx');
    fs.writeFileSync(xlsxPath, res.body);
    pass(`Saved breakage.xlsx (${res.body.length} bytes)`);
}

// ── Write note file ─────────────────────────────────────────────────────────────

function writeNote() {
    const note = [
        '# Smoke Test — M13 Phase 2 Breakage & Loss Report',
        '',
        `Run at      : ${timestamp}`,
        `User        : ${EMAIL}`,
        `dateFrom    : ${DATE_FROM}`,
        `dateTo      : ${DATE_TO}`,
        `locationId  : (all locations — no filter)`,
        '',
        '## Key Definitions',
        '- **Posting Date** = `inventoryLedger.createdAt` (moment of posting)',
        '- **documentCount** = COUNT DISTINCT `referenceNo` (not row count)',
        '',
        '## Environment',
        `Backend      : ${BASE_URL}`,
        `Tenant slug  : ${TENANT_SLUG}`,
    ].join('\n');
    fs.writeFileSync(path.join(__dirname, 'test_note.md'), note);
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
    log('══════════════════════════════════════════════════════════════════');
    log('  M13 Phase 2 — Breakage & Loss Report — Smoke Test');
    log('══════════════════════════════════════════════════════════════════');

    writeNote();

    const authed = await step1_auth();
    if (!authed) { process.exit(1); }

    await step2_getReport();
    await step3_export();

    log('\n══════════════════════════════════════════════════════════════════');
    if (allPassed) {
        log('  🏆  ALL STEPS PASSED — Phase 2 smoke test COMPLETE');
        log('══════════════════════════════════════════════════════════════════');
        process.exit(0);
    } else {
        log('  💥  ONE OR MORE STEPS FAILED — see above');
        log('══════════════════════════════════════════════════════════════════');
        process.exit(1);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
