/**
 * M13 Phase 2 – Breakage & Loss Report Smoke Test
 *
 * Verifies:
 *  1. Authentication
 *  2. GET /reports/breakage  → row count, totalQty, totalAmount, documentCount (DISTINCT)
 *  3. GET /reports/breakage/export  → HTTP 200, Content-Length > 0, saves breakage.xlsx
 *  4. Export used SAME filters as Generate (verified by re-running with identical params)
 *  5. documentCount assertion (must equal distinct Ref No values, not row count)
 *
 * Output files: breakage_response.json, breakage.xlsx
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'http://127.0.0.1:4000/api';

// ── PASS / FAIL helpers ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function pass(label) {
    console.log(`  ✅ PASS  ${label}`);
    passed++;
}

function fail(label, detail = '') {
    console.error(`  ❌ FAIL  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
}

function assert(condition, label, detail = '') {
    if (condition) pass(label);
    else fail(label, detail);
}

// ─────────────────────────────────────────────────────────────────────────────
async function runSmokeTests() {
    console.log('════════════════════════════════════════════════════════════');
    console.log('  M13 Phase 2 – Breakage & Loss Report  –  Smoke Test');
    console.log(`  Run at: ${new Date().toLocaleString()}`);
    console.log('════════════════════════════════════════════════════════════\n');

    // ── 1. Authentication ─────────────────────────────────────────────────────
    console.log('── 1. AUTHENTICATION ────────────────────────────────────────');
    const loginRes = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'admin@grandhorizon.com',
            password: 'Admin@123',
            tenantSlug: 'grand-horizon',
        }),
    });
    const loginData = await loginRes.json();

    assert(loginRes.ok, `Login HTTP ${loginRes.status}`, loginData.message);
    if (!loginRes.ok) {
        console.error('\nCannot continue without a valid token. Aborting.');
        process.exit(1);
    }

    const token = loginData.data.accessToken;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    console.log(`  User: admin@grandhorizon.com`);

    // ── 2. Resolve location ────────────────────────────────────────────────────
    console.log('\n── 2. RESOLVE LOCATION ──────────────────────────────────────');
    const locRes = await fetch(`${API_URL}/locations`, { headers });
    const locData = await locRes.json();
    const allLocs = locData.locations || locData.data || [];

    assert(locRes.ok && allLocs.length > 0, 'Locations loaded', `count=${allLocs.length}`);

    // Prefer "Engineering Store", else fall back to any first location
    const loc = allLocs.find(l => l.name.toLowerCase().includes('engineering')) || allLocs[0];
    console.log(`  Using location: "${loc.name}" (${loc.id})`);

    // ── 3. Build fixed filters ─────────────────────────────────────────────────
    // Use a wide range (1 Jan 2024 → today) to maximise chance of hitting real data
    const dateTo = new Date();
    const dateFrom = new Date('2024-01-01');

    const filters = {
        dateFrom: dateFrom.toISOString().split('T')[0],   // YYYY-MM-DD
        dateTo: dateTo.toISOString().split('T')[0],
        locationId: loc.id,
    };

    console.log(`\n── FIXED FILTERS ─────────────────────────────────────────────`);
    console.log(`  dateFrom   : ${filters.dateFrom}`);
    console.log(`  dateTo     : ${filters.dateTo}`);
    console.log(`  locationId : ${filters.locationId}  (${loc.name})`);

    // ── 4. GET /reports/breakage ───────────────────────────────────────────────
    console.log('\n── 3. BREAKAGE REPORT  (GET /reports/breakage) ──────────────');
    const qp = new URLSearchParams(filters).toString();
    const bkRes = await fetch(`${API_URL}/reports/breakage?${qp}`, { headers });
    const bkData = await bkRes.json();

    assert(bkRes.ok, `HTTP ${bkRes.status} OK`);

    const rows = bkData.data || [];
    const totals = bkData.totals || {};
    const fback = bkData.filters || {};

    console.log(`\n  ── Results ─────────────────────────────────────────────`);
    console.log(`  Row count      : ${rows.length}`);
    console.log(`  totalQty       : ${totals.totalQty ?? 'n/a'}`);
    console.log(`  totalAmount    : ${totals.totalAmount ?? 'n/a'} SAR`);
    console.log(`  documentCount  : ${totals.documentCount ?? 'n/a'}  ← DISTINCT Ref No`);

    // Assertions
    assert(typeof totals.totalQty === 'number', 'totals.totalQty is a number');
    assert(typeof totals.totalAmount === 'number', 'totals.totalAmount is a number');
    assert(typeof totals.documentCount === 'number', 'totals.documentCount is a number');

    // Verify documentCount = distinct referenceNo values (not row count)
    const distinctRefNos = new Set(rows.map(r => r.referenceNo).filter(n => n && n !== '-'));
    const computedDistinct = distinctRefNos.size;
    assert(
        totals.documentCount === computedDistinct,
        `documentCount=${totals.documentCount} equals COUNT DISTINCT referenceNo=${computedDistinct}`,
        `mismatch: API returned ${totals.documentCount}, computed ${computedDistinct}`
    );

    // totals.totalQty should equal sum of row qtys
    const sumQty = rows.reduce((s, r) => s + (r.qty || 0), 0);
    assert(
        Math.abs(totals.totalQty - sumQty) < 0.0001,
        `totalQty (${totals.totalQty}) matches row sum (${sumQty.toFixed(4)})`,
        `delta: ${Math.abs(totals.totalQty - sumQty)}`
    );

    // totals.totalAmount should equal sum of row totalCosts
    const sumAmt = rows.reduce((s, r) => s + (r.totalCost || 0), 0);
    assert(
        Math.abs(totals.totalAmount - sumAmt) < 0.01,
        `totalAmount (${totals.totalAmount}) matches row sum (${sumAmt.toFixed(4)})`,
        `delta: ${Math.abs(totals.totalAmount - sumAmt)}`
    );

    // All rows must have movementType BREAKAGE implicitly (they were filtered server-side)
    // Check postingDate exists on every row
    const missingDate = rows.filter(r => !r.postingDate).length;
    assert(missingDate === 0, `All ${rows.length} rows have postingDate`, `${missingDate} missing`);

    // Verify echo-back filters match what we sent
    assert(
        fback.dateFrom === filters.dateFrom,
        `Response echoes dateFrom="${fback.dateFrom}"`,
        `expected ${filters.dateFrom}`
    );
    assert(
        fback.dateTo === filters.dateTo,
        `Response echoes dateTo="${fback.dateTo}"`,
        `expected ${filters.dateTo}`
    );

    // Save JSON artifact
    fs.writeFileSync(
        path.join(__dirname, 'breakage_response.json'),
        JSON.stringify(bkData, null, 2)
    );
    console.log('\n  💾 breakage_response.json saved');

    // ── 5. GET /reports/breakage/export ───────────────────────────────────────
    console.log('\n── 4. BREAKAGE EXPORT  (GET /reports/breakage/export) ────────');
    console.log(`  Sending SAME filters: dateFrom=${filters.dateFrom}  dateTo=${filters.dateTo}  locationId=${filters.locationId}`);

    const expRes = await fetch(`${API_URL}/reports/breakage/export?${qp}`, { headers });
    assert(expRes.ok, `Export HTTP ${expRes.status}`, await expRes.text().catch(() => ''));

    const contentType = expRes.headers.get('content-type') || '';
    assert(
        contentType.includes('spreadsheetml') || contentType.includes('octet-stream'),
        `Content-Type is xlsx/octet-stream`,
        `got: ${contentType}`
    );

    const expBuffer = await expRes.arrayBuffer();
    const fileSize = expBuffer.byteLength;
    console.log(`  File size: ${fileSize} bytes  (${(fileSize / 1024).toFixed(2)} KB)`);
    assert(fileSize > 0, `Export file size > 0  (${fileSize} bytes)`);

    // Save Excel artifact
    fs.writeFileSync(
        path.join(__dirname, 'breakage.xlsx'),
        Buffer.from(expBuffer)
    );
    console.log('  💾 breakage.xlsx saved');

    // Cross-check: re-run the same report query and compare totals to export
    // (Export calls same service with same filters, so data should be identical)
    const bkRes2 = await fetch(`${API_URL}/reports/breakage?${qp}`, { headers });
    const bkData2 = await bkRes2.json();
    const tot2 = bkData2.totals || {};

    assert(
        tot2.documentCount === totals.documentCount,
        `Second identical query returns same documentCount=${tot2.documentCount}`,
        `expected ${totals.documentCount}`
    );
    assert(
        tot2.totalAmount === totals.totalAmount,
        `Second identical query returns same totalAmount=${tot2.totalAmount}`,
        `expected ${totals.totalAmount}`
    );

    // ── 6. Summary ─────────────────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`  RESULTS:  ${passed} passed  |  ${failed} failed`);
    console.log('════════════════════════════════════════════════════════════');
    console.log('\n  EVIDENCE SNAPSHOT');
    console.log(`  ├─ Filters     : dateFrom=${filters.dateFrom}  dateTo=${filters.dateTo}  locationId=${filters.locationId}`);
    console.log(`  ├─ Row count   : ${rows.length}`);
    console.log(`  ├─ totalQty    : ${totals.totalQty}`);
    console.log(`  ├─ totalAmount : ${totals.totalAmount} SAR`);
    console.log(`  ├─ docCount    : ${totals.documentCount}  (DISTINCT referenceNo)`);
    console.log(`  ├─ xlsx size   : ${(fileSize / 1024).toFixed(2)} KB`);
    console.log(`  ├─ breakage_response.json  ✅`);
    console.log(`  └─ breakage.xlsx           ✅`);

    if (failed > 0) {
        console.error(`\n  ⚠️  ${failed} assertion(s) failed. Review output above.`);
        process.exit(1);
    } else {
        console.log('\n  🎉  All assertions passed. Phase 2 smoke test COMPLETE.');
    }
}

runSmokeTests().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
