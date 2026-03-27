/**
 * Comprehensive Report Smoke Test
 * Covers ALL report endpoints: JSON / Excel / PDF
 *
 * Reports tested:
 *  1. Stock Valuation
 *  2. Movement History
 *  3. Breakage & Loss
 *  4. Count Variances
 *  5. OMC Report
 *  6. Transfer History
 *  7. Breakage P&L
 *  8. Requisition Fill Rate
 *  9. Inventory Aging
 *
 * For each: tests GET (JSON), GET /export (Excel), GET /pdf (PDF)
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'http://127.0.0.1:4000/api';

// ── PASS / FAIL helpers ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;

function pass(label) { console.log(`  ✅ PASS  ${label}`); passed++; }
function fail(label, detail = '') { console.error(`  ❌ FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
function skip(label) { console.log(`  ⏭  SKIP  ${label}`); skipped++; }
function assert(condition, label, detail = '') { if (condition) pass(label); else fail(label, detail); }

// ── Test a single report endpoint ────────────────────────────────────────────
async function testReport(headers, name, endpoint, queryParams, expectations = {}) {
    const section = `── ${name} `;
    console.log(`\n${section}${'─'.repeat(Math.max(0, 60 - section.length))}`);

    const qp = new URLSearchParams(queryParams).toString();
    const url = `${API_URL}/reports/${endpoint}?${qp}`;

    // 1. JSON endpoint
    console.log(`  → GET /reports/${endpoint}`);
    try {
        const res = await fetch(url, { headers });
        if (res.ok) {
            const json = await res.json();
            const data = json.data || json;
            const rowCount = Array.isArray(data) ? data.length : 0;
            pass(`${name} JSON — HTTP ${res.status} (${rowCount} rows)`);

            if (expectations.checkTotals && json.totals) {
                console.log(`    totals: ${JSON.stringify(json.totals)}`);
            }
        } else {
            const errText = await res.text().catch(() => '');
            fail(`${name} JSON — HTTP ${res.status}`, errText.substring(0, 100));
        }
    } catch (e) {
        fail(`${name} JSON`, e.message);
    }

    // 2. Excel export
    console.log(`  → GET /reports/${endpoint}/export`);
    try {
        const res = await fetch(`${API_URL}/reports/${endpoint}/export?${qp}`, { headers });
        if (res.ok) {
            const buf = await res.arrayBuffer();
            const kb = (buf.byteLength / 1024).toFixed(2);
            pass(`${name} Excel — ${kb} KB`);
        } else {
            const errText = await res.text().catch(() => '');
            fail(`${name} Excel — HTTP ${res.status}`, errText.substring(0, 100));
        }
    } catch (e) {
        fail(`${name} Excel`, e.message);
    }

    // 3. PDF export
    console.log(`  → GET /reports/${endpoint}/pdf`);
    try {
        const res = await fetch(`${API_URL}/reports/${endpoint}/pdf?${qp}`, { headers });
        if (res.ok) {
            const buf = await res.arrayBuffer();
            const kb = (buf.byteLength / 1024).toFixed(2);
            const ct = res.headers.get('content-type') || '';
            assert(ct.includes('pdf'), `${name} PDF Content-Type`, `got: ${ct}`);
            pass(`${name} PDF — ${kb} KB`);
        } else {
            const errText = await res.text().catch(() => '');
            fail(`${name} PDF — HTTP ${res.status}`, errText.substring(0, 100));
        }
    } catch (e) {
        fail(`${name} PDF`, e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
async function runAllTests() {
    console.log('════════════════════════════════════════════════════════════════');
    console.log('  COMPREHENSIVE REPORT SMOKE TEST');
    console.log(`  Run at: ${new Date().toLocaleString()}`);
    console.log('════════════════════════════════════════════════════════════════\n');

    // ── 1. Authentication ──────────────────────────────────────────────────
    console.log('── AUTHENTICATION ──────────────────────────────────────────────');
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

    // ── 2. Resolve location ────────────────────────────────────────────────
    console.log('\n── RESOLVE LOCATIONS ───────────────────────────────────────────');
    const locRes = await fetch(`${API_URL}/locations`, { headers });
    const locData = await locRes.json();
    const locs = locData.locations || locData.data || [];
    assert(locs.length > 0, `Locations found: ${locs.length}`);

    const loc = locs.find(l => l.name?.toLowerCase().includes('engineering')) || locs[0];
    console.log(`  Using: "${loc.name}" (${loc.id})`);

    // Date range: wide (Jan 1 2024 → today)
    const dateFrom = '2024-01-01';
    const dateTo = new Date().toISOString().split('T')[0];

    // ── 3. Test Each Report ────────────────────────────────────────────────

    // 3a. Stock Valuation (no dates required)
    await testReport(headers, 'Stock Valuation', 'valuation',
        { locationId: loc.id }, { checkTotals: true });

    // 3b. Movement History (dates required)
    await testReport(headers, 'Movement History', 'movement',
        { dateFrom, dateTo, locationId: loc.id }, { checkTotals: true });

    // 3c. Breakage & Loss (dates required)
    await testReport(headers, 'Breakage & Loss', 'breakage',
        { dateFrom, dateTo, locationId: loc.id }, { checkTotals: true });

    // 3d. Count Variances (dates required)
    await testReport(headers, 'Count Variances', 'variance',
        { dateFrom, dateTo, locationId: loc.id }, { checkTotals: true });

    // 3e. OMC Report (dates + location required)
    await testReport(headers, 'OMC Report', 'omc',
        { dateFrom, dateTo, locationId: loc.id }, { checkTotals: true });

    // 3f. Transfer History
    await testReport(headers, 'Transfer History', 'transfers',
        { dateFrom, dateTo });

    // 3g. Breakage P&L
    await testReport(headers, 'Breakage P&L', 'breakage-pl',
        { dateFrom, dateTo });

    // 3h. Requisition Fill Rate
    await testReport(headers, 'Requisition Fill', 'requisition-fill',
        { dateFrom, dateTo });

    // 3i. Inventory Aging
    await testReport(headers, 'Inventory Aging', 'aging',
        { locationId: loc.id });

    // ── 4. Dashboard Endpoint ──────────────────────────────────────────────
    console.log('\n── DASHBOARD ───────────────────────────────────────────────────');
    try {
        const dashRes = await fetch(`${API_URL}/dashboard/summary`, { headers });
        if (dashRes.ok) {
            pass('Dashboard overview — HTTP 200');
        } else {
            fail(`Dashboard overview — HTTP ${dashRes.status}`);
        }
    } catch (e) {
        fail('Dashboard overview', e.message);
    }

    // ── 5. Health Check ────────────────────────────────────────────────────
    console.log('\n── HEALTH CHECK ────────────────────────────────────────────────');
    try {
        const healthRes = await fetch('http://127.0.0.1:4000/health');
        assert(healthRes.ok, `Health check — HTTP ${healthRes.status}`);
    } catch (e) {
        fail('Health check', e.message);
    }

    // ── Summary ────────────────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log(`  RESULTS:  ${passed} passed  |  ${failed} failed  |  ${skipped} skipped`);
    console.log('════════════════════════════════════════════════════════════════');

    if (failed > 0) {
        console.error(`\n  ⚠️  ${failed} assertion(s) failed. Review output above.`);
        process.exit(1);
    } else {
        console.log('\n  🎉  All smoke tests passed!');
    }
}

runAllTests().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
