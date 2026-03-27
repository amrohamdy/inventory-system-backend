/**
 * Smoke Test — M13 Phase 2: Stock Count Variance Report
 *
 * Filters used:
 *   dateFrom : 2024-01-01
 *   dateTo   : 2027-12-31
 *   user     : admin@test.com
 *   run at   : <timestamp printed below>
 *
 * It tests /api/reports/variance and /api/reports/variance/export.
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
    token = parsed.data?.accessToken || parsed.token || parsed.data?.token || '';
    if (!token) { fail('No token in login response'); return false; }
    pass(`Authenticated (token starts: ${token.substring(0, 20)}...)`);
    return true;
}

async function step2_getReport() {
    log('\n── Step 2: GET /api/reports/variance ────────────────────────────');
    const qs = `?dateFrom=${DATE_FROM}&dateTo=${DATE_TO}`;
    const res = await get(`/api/reports/variance${qs}`, authHeader());

    if (res.status !== 200) {
        fail(`HTTP ${res.status}: ${res.body.toString()}`);
        return null;
    }

    const json = JSON.parse(res.body);
    const { data, totals, filters } = json;

    log(`   Row count          : ${data.length}`);
    log(`   totalBookQty       : ${totals?.totalBookQty}`);
    log(`   totalCountedQty    : ${totals?.totalCountedQty}`);
    log(`   totalVarianceQty   : ${totals?.totalVarianceQty}`);
    log(`   totalVarianceValue : ${totals?.totalVarianceValue}`);
    log(`   sessionCount       : ${totals?.sessionCount}`);
    log(`   filters echo       : ${JSON.stringify(filters)}`);

    // Validate totals computationally
    if (data.length > 0) {
        const rowBookSum = data.reduce((s, r) => s + r.bookQty, 0);
        const rowCountedSum = data.reduce((s, r) => s + r.countedQty, 0);
        const rowVarSum = data.reduce((s, r) => s + r.varianceQty, 0);

        if (Math.abs(rowBookSum - totals?.totalBookQty) < 0.01) pass(`totalBookQty reconciles with rows (${rowBookSum})`);
        else fail(`totalBookQty mismatch — API: ${totals?.totalBookQty}, Row: ${rowBookSum}`);

        if (Math.abs(rowCountedSum - totals?.totalCountedQty) < 0.01) pass(`totalCountedQty reconciles with rows (${rowCountedSum})`);
        else fail(`totalCountedQty mismatch — API: ${totals?.totalCountedQty}, Row: ${rowCountedSum}`);

        if (Math.abs(rowVarSum - totals?.totalVarianceQty) < 0.01) pass(`totalVarianceQty reconciles with rows (${rowVarSum})`);
        else fail(`totalVarianceQty mismatch — API: ${totals?.totalVarianceQty}, Row: ${rowVarSum}`);
    }

    // Save raw response
    fs.writeFileSync(path.join(__dirname, 'variance_response.json'), JSON.stringify(json, null, 2));
    pass(`Received ${data.length} rows — variance_response.json saved`);

    return { data, totals, filters };
}

async function step3_export() {
    log('\n── Step 3: GET /api/reports/variance/export ─────────────────────');
    const qs = `?dateFrom=${DATE_FROM}&dateTo=${DATE_TO}`;
    const res = await get(`/api/reports/variance/export${qs}`, authHeader());

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
    const xlsxPath = path.join(__dirname, 'variance.xlsx');
    fs.writeFileSync(xlsxPath, res.body);
    pass(`Saved variance.xlsx (${res.body.length} bytes)`);
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
    log('══════════════════════════════════════════════════════════════════');
    log('  M13 Phase 2 — Stock Count Variance Report — Smoke Test');
    log('══════════════════════════════════════════════════════════════════');

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
